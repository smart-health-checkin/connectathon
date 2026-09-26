// The wire view: every layer of a run as bytes, what each failing wire check
// points at, and a guess at why decryption or the device signature failed.
import {
  base64UrlDecodeBytes,
  base64UrlEncodeBytes,
  CborTag,
  cborDecode,
  cborEncode,
  hex,
  mapGet,
  openWalletResponse,
  sha256,
  verifyDeviceResponseSignatures,
} from "@smart-health-checkin/client/wire";
import { esc } from "./readable.ts";
import { renderJson } from "../../shared/smart-json.ts";

/** One layer, kept as base64url so a run can be stored and downloaded. */
export type Layer = { id: LayerId; b64u: string; kind: "cbor" | "json" };
export type LayerId = "navigator" | "device-request" | "encryption-info" | "session-transcript" | "dcapi-response" | "device-response";

export type DigestRow = { namespace: string; digestId: number | null; element: string; expected?: string; computed: string; match: boolean };

export type WireLayers = {
  origin: string;
  /** The inputs to SessionTranscript, shown as a derivation. */
  transcript: { encryptionInfoB64u: string; handoverHash: string };
  layers: Layer[];
  digests?: DigestRow[];
  /** Plain-language findings from retrying with likely mistakes. */
  diagnosis?: string[];
};

export const LAYER_INFO: Record<LayerId, { title: string; side: "Sent" | "Received"; about: string }> = {
  navigator: { title: "navigator.credentials.get argument", side: "Sent", about: "What this page passed to the browser." },
  "device-request": { title: "DeviceRequest", side: "Sent", about: "The mdoc request. The SMART request travels in ItemsRequest.requestInfo." },
  "encryption-info": { title: "encryptionInfo", side: "Sent", about: "[\"dcapi\", {nonce, recipientPublicKey}]. The wallet encrypts to this key." },
  "session-transcript": { title: "SessionTranscript", side: "Sent", about: "Computed here, never sent. The wallet must compute the same bytes: it is the HPKE info and part of what the device key signs." },
  "dcapi-response": { title: "Encrypted response", side: "Received", about: "data.response decoded: [\"dcapi\", {enc, cipherText}]." },
  "device-response": { title: "DeviceResponse", side: "Received", about: "The decrypted mdoc response: issuerSigned items, issuerAuth over the MSO, and deviceSigned." },
};

/** Which layer a failing or warning check is about. */
export function layerFor(checkId: string): LayerId | "digests" | undefined {
  if (/^(protocol|wrapper|dcapi)/.test(checkId)) return "dcapi-response";
  if (/^hpke/.test(checkId)) return "session-transcript";
  if (/^device-sig/.test(checkId)) return "session-transcript";
  if (/^digests/.test(checkId)) return "digests";
  if (/^(dr-|document|issuer-sig|mso|alg-|validity|element)/.test(checkId)) return "device-response";
  return undefined;
}

const b64 = (bytes: Uint8Array) => base64UrlEncodeBytes(bytes);

export async function captureRequest(input: {
  origin: string;
  navigatorArgument: unknown;
  deviceRequestBytes?: Uint8Array;
  encryptionInfoBytes: Uint8Array;
  sessionTranscript: Uint8Array;
}): Promise<WireLayers> {
  const encryptionInfoB64u = b64(input.encryptionInfoBytes);
  const handover = mapGetIndex(cborDecode(input.sessionTranscript), 2);
  const hash = Array.isArray(handover) && handover[1] instanceof Uint8Array ? hex(handover[1]) : "";
  const deviceRequestB64u = input.deviceRequestBytes ? b64(input.deviceRequestBytes)
    : findString(input.navigatorArgument, "deviceRequest") ?? "";
  return {
    origin: input.origin,
    transcript: { encryptionInfoB64u, handoverHash: hash },
    layers: [
      { id: "navigator", kind: "json", b64u: b64(new TextEncoder().encode(JSON.stringify(input.navigatorArgument, null, 2))) },
      ...(deviceRequestB64u ? [{ id: "device-request" as const, kind: "cbor" as const, b64u: deviceRequestB64u }] : []),
      { id: "encryption-info", kind: "cbor", b64u: encryptionInfoB64u },
      { id: "session-transcript", kind: "cbor", b64u: b64(input.sessionTranscript) },
    ],
  };
}

export function addLayer(wire: WireLayers, id: LayerId, bytes: Uint8Array | string) {
  wire.layers = wire.layers.filter((l) => l.id !== id);
  wire.layers.push({ id, kind: "cbor", b64u: typeof bytes === "string" ? bytes : b64(bytes) });
}

/** Recompute every value digest and compare with the MSO. */
export async function digestRows(deviceResponseBytes: Uint8Array): Promise<DigestRow[]> {
  const rows: DigestRow[] = [];
  const doc = (mapGet(cborDecode(deviceResponseBytes), "documents") as unknown[] | undefined)?.[0];
  const issuerSigned = mapGet(doc, "issuerSigned");
  const cose = mapGet(issuerSigned, "issuerAuth");
  let valueDigests: unknown;
  if (Array.isArray(cose) && cose[2] instanceof Uint8Array) {
    const tag = cborDecode(cose[2]);
    if (tag instanceof CborTag && tag.value instanceof Uint8Array) valueDigests = mapGet(cborDecode(tag.value), "valueDigests");
  }
  const nameSpaces = mapGet(issuerSigned, "nameSpaces");
  if (!(nameSpaces instanceof Map)) return rows;
  for (const [namespace, items] of nameSpaces) {
    if (!Array.isArray(items)) continue;
    const expectedMap = valueDigests instanceof Map ? valueDigests.get(namespace) : undefined;
    for (const item of items) {
      if (!(item instanceof CborTag) || !(item.value instanceof Uint8Array)) continue;
      const inner = cborDecode(item.value);
      const digestId = mapGet(inner, "digestID");
      const expected = expectedMap instanceof Map && typeof digestId === "number" ? expectedMap.get(digestId) : undefined;
      const computed = hex(await sha256(cborEncode(item)));
      rows.push({
        namespace: String(namespace),
        digestId: typeof digestId === "number" ? digestId : null,
        element: String(mapGet(inner, "elementIdentifier") ?? "?"),
        expected: expected instanceof Uint8Array ? hex(expected) : undefined,
        computed,
        match: expected instanceof Uint8Array && hex(expected) === computed,
      });
    }
  }
  return rows;
}

/**
 * Rebuild SessionTranscript with the usual mistakes and see which one the
 * wallet made. `test` returns true when a candidate transcript works.
 */
export async function diagnoseTranscript(input: {
  origin: string;
  walletOrigin?: string;
  pageUrl: string;
  encryptionInfoBytes: Uint8Array;
  test: (transcript: Uint8Array) => Promise<boolean>;
}): Promise<string | undefined> {
  const encB64u = b64(input.encryptionInfoBytes);
  const origins: [string, string][] = [
    [`${input.origin}/`, "the origin with a trailing slash"],
    [input.pageUrl, "the full page URL instead of the origin"],
    [input.pageUrl.replace(/[?#].*$/, ""), "the page URL without query or fragment instead of the origin"],
    ...(input.walletOrigin && input.walletOrigin !== input.origin ? [[input.walletOrigin, "the wallet's own origin instead of the EHR's"] as [string, string]] : []),
    ["null", "the string \"null\" as origin"],
  ];
  const infos: [unknown, string][] = [
    [encB64u, ""],
    [input.encryptionInfoBytes, "the encryptionInfo bytes instead of its base64url string"],
    [encB64u + "=".repeat((4 - (encB64u.length % 4)) % 4), "padded base64url for encryptionInfo"],
  ];
  const build = async (info: unknown, origin: string, hashed = true) => {
    const dcapiInfo = cborEncode([info, origin]);
    return cborEncode([null, null, ["dcapi", hashed ? await sha256(dcapiInfo) : dcapiInfo]]);
  };
  for (const [info, infoWhy] of infos) {
    for (const [origin, originWhy] of [[input.origin, ""] as [string, string], ...origins]) {
      if (!infoWhy && !originWhy) continue;
      if (await input.test(await build(info, origin))) {
        return `It works if the transcript uses ${[originWhy, infoWhy].filter(Boolean).join(" and ")}${originWhy ? ` (${JSON.stringify(origin)})` : ""}. The origin must be exactly ${JSON.stringify(input.origin)}, from the browser, and encryptionInfo must be the base64url string from the request.`;
      }
    }
  }
  if (await input.test(await build(encB64u, input.origin, false))) {
    return "It works if the handover holds CBOR([encryptionInfo, origin]) itself. The handover must hold the SHA-256 of those bytes.";
  }
  return undefined;
}

export const hpkeTester = (response: string, keyPair: CryptoKeyPair, jwk: JsonWebKey) => async (t: Uint8Array) => {
  try {
    await openWalletResponse({ response, recipientPrivateKey: keyPair.privateKey, recipientPublicJwk: jwk, sessionTranscript: t });
    return true;
  } catch { return false; }
};

export const deviceSigTester = (deviceResponseBytes: Uint8Array) => async (t: Uint8Array) => {
  try {
    const [v] = await verifyDeviceResponseSignatures({ deviceResponseBytes, sessionTranscript: t });
    return !!v?.deviceSignature.signatureValid;
  } catch { return false; }
};

// ---------------------------------------------------------------- rendering

const size = (n: number) => (n < 1024 ? `${n} bytes` : `${(n / 1024).toFixed(1)} KB`);

export function wireHtml(w: WireLayers, flagged: { id: string; title: string; outcome?: string }[]): string {
  const byLayer = new Map<string, { title: string; warn: boolean }[]>();
  for (const c of flagged) {
    const l = layerFor(c.id);
    if (l) byLayer.set(l, [...(byLayer.get(l) ?? []), { title: c.title, warn: c.outcome === "warn" }]);
  }
  const flags = (id: string) => (byLayer.get(id) ?? []).map((f) => `<span class="layer-fail${f.warn ? " warn" : ""}">${f.warn ? "!" : "✕"} ${esc(f.title)}</span>`).join("");
  const layer = (l: Layer) => {
    const info = LAYER_INFO[l.id];
    const n = base64UrlDecodeBytes(l.b64u).length;
    const derivation = l.id === "session-transcript" ? `<dl class="derive smart-fields">
        <dt>origin</dt><dd><code>${esc(w.origin)}</code></dd>
        <dt>encryptionInfo</dt><dd><code class="clip">${esc(w.transcript.encryptionInfoB64u)}</code></dd>
        <dt>handover</dt><dd><code>["dcapi", SHA-256(CBOR([encryptionInfo, origin]))]</code></dd>
        <dt>SHA-256</dt><dd><code class="clip">${esc(w.transcript.handoverHash)}</code></dd>
        <dt>transcript</dt><dd><code>[null, null, handover]</code></dd></dl>` : "";
    return `<details class="group layer smart-details" id="layer-${l.id}" data-layer="${l.id}" ${byLayer.has(l.id) ? "open" : ""}>
      <summary><span class="side ${info.side.toLowerCase()}">${info.side}</span> ${esc(info.title)}<span class="n">${size(n)}</span></summary>
      <div class="pad">${flags(l.id)}<p class="small">${esc(info.about)}</p>${derivation}
        <div class="layer-tools">
          <button type="button" class="smart-btn sm" data-layer-act="copy-hex">Copy hex</button>
          <button type="button" class="smart-btn sm" data-layer-act="download">Download ${l.kind === "json" ? ".json" : ".cbor"}</button>
        </div>
        <div class="tree smart-code tall" data-tree></div>
      </div></details>`;
  };
  const digests = w.digests?.length ? `<details class="group layer smart-details" id="layer-digests" ${byLayer.has("digests") ? "open" : ""}>
      <summary><span class="side received">Received</span> Value digests<span class="n">${w.digests.filter((d) => d.match).length} of ${w.digests.length} match</span></summary>
      <div class="pad">${flags("digests")}<p class="small">SHA-256 of each Tag 24 IssuerSignedItem, recomputed here, next to the value the MSO signs.</p>
      <div class="digests">${w.digests.map((d) => `<div class="digest ${d.match ? "ok" : "bad"}"><b>${d.match ? "✓" : "✕"} ${esc(d.element)}</b><span class="small">${esc(d.namespace)} · digestID ${d.digestId ?? "missing"}</span>
        <span class="small">MSO</span><code class="clip">${esc(d.expected ?? "(no digest for this digestID)")}</code>
        <span class="small">computed</span><code class="clip">${esc(d.computed)}</code></div>`).join("")}</div></div></details>` : "";
  const diagnosis = w.diagnosis?.length ? `<div class="diagnosis smart-callout warn"><b>Likely cause</b>${w.diagnosis.map((d) => `<p>${esc(d)}</p>`).join("")}</div>` : "";
  return `<section class="card wire" id="wire"><h2>Wire layers <span>${w.layers.length + (w.digests?.length ? 1 : 0)}</span></h2>
    ${diagnosis}
    ${w.layers.map(layer).join("")}${digests}
    <div class="actions"><button type="button" class="smart-btn sm" data-wire-act="inspector">Open in the capture inspector</button></div>
  </section>`;
}

/** Wire up copy, download, lazy CBOR trees, and the inspector hand-off. */
export function bindWire(root: HTMLElement, w: WireLayers, runLabel: string) {
  for (const el of root.querySelectorAll<HTMLDetailsElement>("details.layer[data-layer]")) {
    const l = w.layers.find((x) => x.id === el.dataset.layer)!;
    const bytes = () => base64UrlDecodeBytes(l.b64u);
    const fill = () => {
      const tree = el.querySelector<HTMLElement>("[data-tree]")!;
      if (tree.childElementCount) return;
      try {
        tree.append(l.kind === "json" ? pre(new TextDecoder().decode(bytes())) : node(cborDecode(bytes()), "", 0));
      } catch (e) {
        tree.append(pre(`Could not decode: ${(e as Error).message}\n\n${hex(bytes()).slice(0, 4000)}`));
      }
    };
    if (el.open) fill();
    el.addEventListener("toggle", () => el.open && fill());
    el.querySelector('[data-layer-act="copy-hex"]')!.addEventListener("click", (e) => copy(e.currentTarget as HTMLButtonElement, hex(bytes())));
    el.querySelector('[data-layer-act="download"]')!.addEventListener("click", () =>
      save(bytes(), `${l.id}.${l.kind === "json" ? "json" : "cbor"}`));
  }
  root.querySelector('[data-wire-act="inspector"]')?.addEventListener("click", () => openInspector(w, runLabel));
}

function pre(text: string) {
  const p = document.createElement("pre");
  renderJson(p, text);
  return p;
}

function copy(button: HTMLButtonElement, text: string) {
  navigator.clipboard.writeText(text).then(() => {
    const was = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = was), 1500);
  }, () => {});
}

function save(bytes: Uint8Array, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// A CBOR value as a tree. Maps and arrays open on demand, so a multi-megabyte
// DeviceResponse costs nothing until someone looks. Tag 24 is decoded in place.
function node(value: unknown, key: string, depth: number): HTMLElement {
  const label = key ? `<span class="k">${esc(key)}</span> ` : "";
  if (value instanceof CborTag) {
    if (value.tag === 24 && value.value instanceof Uint8Array) {
      let inner: unknown;
      try { inner = cborDecode(value.value); } catch { inner = value.value; }
      return branch(`${label}<span class="t">24(&lt;&lt; ${size(value.value.length)} &gt;&gt;)</span>`, [["", inner]], depth, true);
    }
    return branch(`${label}<span class="t">tag ${value.tag}</span>`, [["", value.value]], depth, true);
  }
  if (value instanceof Map) return branch(`${label}<span class="t">map · ${value.size}</span>`, [...value].map(([k, v]) => [typeof k === "string" ? k : String(k), v]), depth);
  if (Array.isArray(value)) return branch(`${label}<span class="t">array · ${value.length}</span>`, value.map((v, i) => [String(i), v]), depth);
  const leaf = document.createElement("div");
  leaf.className = "leaf";
  if (value instanceof Uint8Array) {
    const tagged = value[0] === 0xd8 && value[1] === 0x18;
    if (tagged) {
      try { return node(cborDecode(value), key ? `${key} (bstr)` : "bstr", depth); } catch { /* show as bytes */ }
    }
    const h = hex(value);
    leaf.innerHTML = `${label}<span class="b">h'${esc(h.slice(0, 64))}${h.length > 64 ? "…" : ""}'</span> <span class="t">${size(value.length)}</span>`;
  } else if (typeof value === "string") {
    const s = value.length > 300 ? value.slice(0, 300) + "…" : value;
    leaf.innerHTML = `${label}<span class="s">${esc(JSON.stringify(s))}</span>${value.length > 300 ? ` <span class="t">${value.length.toLocaleString()} chars</span>` : ""}`;
  } else {
    leaf.innerHTML = `${label}<span class="v">${esc(value === null ? "null" : value === undefined ? "undefined" : String(value))}</span>`;
  }
  return leaf;
}

function branch(head: string, children: [string, unknown][], depth: number, openByDefault = false): HTMLElement {
  const d = document.createElement("details");
  d.className = "br";
  d.innerHTML = `<summary>${head}</summary>`;
  const body = document.createElement("div");
  body.className = "kids";
  d.append(body);
  const fill = () => {
    if (body.childElementCount) return;
    const shown = children.slice(0, 200);
    for (const [k, v] of shown) body.append(node(v, k, depth + 1));
    if (children.length > shown.length) body.append(Object.assign(document.createElement("div"), { className: "leaf t", textContent: `… ${children.length - shown.length} more` }));
  };
  if (depth < 3 || openByDefault) { d.open = true; fill(); }
  d.addEventListener("toggle", () => d.open && fill());
  return d;
}

function mapGetIndex(v: unknown, i: number) {
  return Array.isArray(v) ? v[i] : undefined;
}

function findString(v: unknown, key: string): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  for (const [k, x] of Object.entries(v)) {
    if (k === key && typeof x === "string") return x;
    const found = findString(x, key);
    if (found) return found;
  }
  return undefined;
}

// ------------------------------------------------------ capture inspector

const INSPECTOR = "https://smart-health-checkin.org/spec/wire-protocol-inspector.html#from-opener";

/** Hand this run's bytes to the capture inspector, which asks for them once it loads. */
function openInspector(w: WireLayers, label: string) {
  const inspector = window.open(INSPECTOR, "_blank");
  if (!inspector) return;
  const bytes = (id: LayerId) => w.layers.find((l) => l.id === id);
  const files: [string, Uint8Array][] = [];
  const add = (path: string, id: LayerId) => { const l = bytes(id); if (l) files.push([path, base64UrlDecodeBytes(l.b64u)]); };
  add("analysis/request/navigator-credentials-get.arg.json", "navigator");
  add("analysis/request/device-request.cbor", "device-request");
  add("analysis/request/encryption-info.cbor", "encryption-info");
  add("analysis/request/session-transcript.cbor", "session-transcript");
  add("dcapi-response.cbor", "dcapi-response");
  add("device-response.cbor", "device-response");
  const dcapi = bytes("dcapi-response");
  if (dcapi) {
    files.push(["credential.json", new TextEncoder().encode(JSON.stringify({ protocol: "org-iso-mdoc", data: { response: dcapi.b64u } }, null, 2))]);
    try {
      const fields = (cborDecode(base64UrlDecodeBytes(dcapi.b64u)) as unknown[])[1];
      const enc = mapGet(fields, "enc"), ct = mapGet(fields, "cipherText");
      if (enc instanceof Uint8Array) files.push(["hpke-enc.bin", enc]);
      if (ct instanceof Uint8Array) files.push(["hpke-ciphertext.bin", ct]);
    } catch { /* the inspector shows what it has */ }
  }
  const transcript = bytes("session-transcript");
  files.push(["manifest.json", new TextEncoder().encode(JSON.stringify({
    runId: label, origin: w.origin, originSource: "Testing EHR", protocol: "org-iso-mdoc",
    sessionTranscriptByteSize: transcript ? base64UrlDecodeBytes(transcript.b64u).length : undefined,
  }))]);
  const onReady = (e: MessageEvent) => {
    if (e.source !== inspector || e.data?.type !== "smart-capture-ready") return;
    window.removeEventListener("message", onReady);
    inspector.postMessage({ type: "smart-capture", label: `Testing EHR run: ${label}`, files }, new URL(INSPECTOR).origin);
  };
  window.addEventListener("message", onReady);
}
