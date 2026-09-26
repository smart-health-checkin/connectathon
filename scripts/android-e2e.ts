/**
 * Native-path check on an Android emulator or phone: the live testing EHR in
 * the device's Chrome asks for credentials through the Digital Credentials
 * API, the installed reference wallet answers, and the testing EHR checks it.
 *
 *   bun scripts/android-e2e.ts [--serial emulator-5554] [--apk path|--release] [M1 M3 ...]
 *
 * Needs adb, a device with Chrome and Google Play services new enough for the
 * Digital Credentials API (the android-37 google_apis_playstore image works),
 * and the reference wallet installed (or --apk / --release to install it).
 * System dialogs are driven through uiautomator, the page through DevTools.
 *
 * Per case, the script picks the wallet's reference patient (L2 uses the large
 * record), answers every choice question in a form with its first option, and
 * checks that the answers and the payload size reached the testing EHR.
 */
import puppeteer, { type Page } from "puppeteer-core";
import { $ } from "bun";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? (args.splice(i, 1), true) : false; };
const SERIAL = opt("--serial") ?? "emulator-5554";
const APK = opt("--apk");
const RELEASE = flag("--release");
const BASE = opt("--base") ?? "https://smart-health-checkin.org/connectathon/";
const PORT = Number(opt("--port") ?? 9477);
const OUT = opt("--out"); // also append every result line to this file
const CASES = args.length ? args : ["M1", "M3", "M4", "O6"];
if (OUT) {
  const { appendFileSync, writeFileSync } = await import("node:fs");
  writeFileSync(OUT, "");
  const log = console.log;
  console.log = (...a: unknown[]) => { log(...a); appendFileSync(OUT, a.join(" ") + "\n"); };
}
const ADB = `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Android/Sdk`}/platform-tools/adb`;
const WALLET_PKG = "org.smarthealthit.checkin.wallet";
const RELEASE_APK = "https://github.com/smart-health-checkin/spec/releases/latest/download/smart-checkin-wallet-debug.apk";

const adb = (...a: string[]) => $`${ADB} -s ${SERIAL} ${a}`.quiet().nothrow();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Node = { text: string; desc: string; cls: string; checked: boolean; left: number; top: number; bottom: number; x: number; y: number };
async function screen(): Promise<Node[]> {
  await adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
  const xml = (await adb("shell", "cat", "/sdcard/ui.xml")).stdout.toString();
  return [...xml.matchAll(/<node ([^>]*)>/g)].map((m) => {
    const a = Object.fromEntries([...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const [l, t, r, b] = (a.bounds ?? "[0,0][0,0]").match(/\d+/g)!.map(Number);
    return { text: a.text ?? "", desc: a["content-desc"] ?? "", cls: a.class ?? "", checked: a.checked === "true", left: l!, top: t!, bottom: b!, x: (l! + r!) >> 1, y: (t! + b!) >> 1 };
  });
}
async function tapIfShown(re: RegExp): Promise<boolean> {
  const n = (await screen()).find((n) => re.test(n.text) || re.test(n.desc));
  if (!n) return false;
  await adb("shell", "input", "tap", String(n.x), String(n.y));
  return true;
}

// Choose the patient the wallet answers as. The released APK is debuggable, so
// run-as can write its preferences; the wallet is stopped first so it rereads them.
async function choosePatient(patient: "aria" | "large") {
  await adb("shell", "am", "force-stop", WALLET_PKG);
  const xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    <string name="patient">${patient}</string>\n</map>\n`;
  const b64 = Buffer.from(xml).toString("base64"); // survives adb's shell quoting
  const r = await adb("shell", `run-as ${WALLET_PKG} sh -c 'mkdir -p shared_prefs && echo ${b64} | base64 -d > shared_prefs/reference-patients.xml'`);
  if (r.exitCode) throw new Error(`could not set the wallet's patient: ${r.stderr}`);
}

// In the wallet's consent screen: scroll through, and for each question whose
// radio buttons are all unchecked, tap the first one. A question starts at a
// text line on the left margin; its options are the radio buttons after it.
async function answerForms(): Promise<number> {
  const answered = new Set<string>();
  let last = "";
  for (let pass = 0; pass < 30; pass++) {
    const nodes = await screen();
    const signature = nodes.map((n) => n.text + n.checked).join("|");
    if (signature === last) break; // scrolled to the end
    last = signature;
    const viewBottom = Math.max(...nodes.filter((n) => /Share selected data/.test(n.text)).map((n) => n.top), 0) || 2000;
    let question = "";
    let group: Node[] = [];
    const flush = async () => {
      if (question && group.length && !group.some((r) => r.checked) && !answered.has(question) && group[0]!.bottom < viewBottom) {
        await adb("shell", "input", "tap", String(group[0]!.x), String(group[0]!.y));
        answered.add(question);
      }
      group = [];
    };
    for (const n of nodes) {
      if (n.cls.endsWith("RadioButton")) group.push(n);
      else if (n.cls.endsWith("TextView") && n.text && n.left <= 110) { await flush(); question = n.text; }
    }
    await flush();
    await adb("shell", "input", "swipe", "540", "1500", "540", "700", "300");
    await sleep(500);
  }
  return answered.size;
}

// Taps through whatever system or wallet screen is in front until the page has a verdict.
const STEPS: Array<[RegExp, string]> = [
  [/^No thanks$/, "dismissed a Chrome prompt"],
  [/^Continue$/, "trusted the site"],
  [/^Agree and continue$/, "picked the wallet in the system sheet"],
];

const EHR_URL = (caseId: string) => `${BASE}testing-ehr/#case=${caseId}`;
const devtoolsUp = () => fetch(`http://localhost:${PORT}/json/version`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);

// Chrome in front with DevTools reachable. A cold emulator can take a minute
// to start Chrome, and Play services updates sometimes kill it, so this polls,
// relaunches, and taps through Chrome's first-run prompts.
async function ensureChrome(caseId: string) {
  await adb("forward", `tcp:${PORT}`, "localabstract:chrome_devtools_remote");
  let launch = "";
  for (let i = 0; i < 80; i++) {
    const running = (await adb("shell", "pidof", "com.android.chrome")).stdout.toString().trim() !== "";
    if (running && (await devtoolsUp())) {
      // Already up: bring it to the front without opening or navigating a tab.
      await adb("shell", "am", "start", "-n", "com.android.chrome/com.google.android.apps.chrome.Main");
      return;
    }
    if (!running || (i > 0 && i % 10 === 0)) {
      const r = await adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", `'${EHR_URL(caseId)}'`, "com.android.chrome");
      launch = (r.stdout.toString() + r.stderr.toString()).trim().replace(/\s+/g, " ");
    }
    await tapIfShown(/^(No thanks|Accept & continue|Use without an account|Got it)$/);
    await sleep(3000);
  }
  const pid = (await adb("shell", "pidof", "com.android.chrome")).stdout.toString().trim();
  const sockets = (await adb("shell", "cat", "/proc/net/unix")).stdout.toString().split("\n").filter((l) => /devtools/.test(l)).join("; ");
  const user = (await adb("shell", "am", "get-started-user-state", "0")).stdout.toString().trim();
  throw new Error(`Chrome's DevTools never became reachable (chrome pid ${pid || "none"}; devtools sockets: ${sockets || "none"}; user 0: ${user}; last launch: ${launch})`);
}

async function ehrPage(caseId: string): Promise<Page> {
  await ensureChrome(caseId);
  const browser = await puppeteer.connect({ browserURL: `http://localhost:${PORT}`, defaultViewport: null });
  let page = (await browser.pages()).filter((p) => p.url().includes("/testing-ehr/")).at(-1);
  if (!page) {
    page = await browser.newPage();
    await page.goto(EHR_URL(caseId), { waitUntil: "networkidle0" });
  }
  return page;
}

// Evidence for a failed case: screenshot, UI tree, and logcat.
const EVIDENCE = opt("--evidence") ?? "android-e2e-evidence";
async function saveEvidence(caseId: string) {
  await $`mkdir -p ${EVIDENCE}`.quiet();
  await Bun.write(`${EVIDENCE}/${caseId}.png`, (await adb("exec-out", "screencap", "-p")).stdout);
  await adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
  await Bun.write(`${EVIDENCE}/${caseId}.ui.xml`, (await adb("shell", "cat", "/sdcard/ui.xml")).stdout);
  await Bun.write(`${EVIDENCE}/${caseId}.logcat.txt`, (await adb("logcat", "-d", "-t", "3000")).stdout);
}

// Apps can't be launched until the user's storage is unlocked, which on a
// slow emulator can lag well behind sys.boot_completed.
async function waitForUnlock() {
  for (let i = 0; i < 100; i++) {
    const state = (await adb("shell", "am", "get-started-user-state", "0")).stdout.toString();
    if (/RUNNING_UNLOCKED/.test(state)) return;
    await sleep(3000);
  }
  throw new Error(`user 0 never unlocked: ${(await adb("shell", "am", "get-started-user-state", "0")).stdout.toString().trim()}`);
}

async function setup() {
  await waitForUnlock();
  if (APK || RELEASE) {
    let path = APK;
    if (RELEASE) { path = "/tmp/smart-checkin-wallet.apk"; await $`curl -sL -o ${path} ${RELEASE_APK}`; }
    const r = await adb("install", "-r", path!);
    if (!/Success/.test(r.stdout.toString())) {
      // A different signing key: replace the app.
      await adb("uninstall", WALLET_PKG);
      const again = await adb("install", path!);
      if (!/Success/.test(again.stdout.toString())) throw new Error(`install failed: ${again.stderr}`);
    }
  }
  // Launching the wallet once registers it with Credential Manager.
  await adb("shell", "monkey", "-p", WALLET_PKG, "-c", "android.intent.category.LAUNCHER", "1");
  await sleep(4000);
  await adb("shell", "sh", "-c", "'echo \"_ --disable-fre --no-default-browser-check --no-first-run\" > /data/local/tmp/chrome-command-line'");
  await adb("shell", "am", "set-debug-app", "--persistent", "com.android.chrome");
  await adb("shell", "am", "force-stop", "com.android.chrome"); // so the flags above apply
  await ensureChrome("M1");
}

async function runCase(caseId: string) {
  await choosePatient(caseId === "L2" ? "large" : "aria");
  const page = await ehrPage(caseId);
  await page.bringToFront();
  await page.goto(EHR_URL(caseId), { waitUntil: "networkidle0" });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(() => (document.getElementById("case") as HTMLSelectElement).options.length > 0);
  await page.select("#case", caseId);
  const choice = 'smart-checkin-picker >>> [data-id="platform"]';
  await page.waitForSelector(choice, { timeout: 20000 });
  await page.click(choice); // a real input event, so the page has user activation
  const steps: string[] = [];
  for (let i = 0; i < 40; i++) {
    const status = await page.$eval("#status", (e) => e.textContent ?? "").catch(() => "");
    if (/passed|failed|Error|declined/.test(status)) break;
    const nodes = await screen();
    if (nodes.some((n) => n.text === "Share selected data")) {
      const n = await answerForms();
      if (n) steps.push(`answered ${n} question(s)`);
      if (await tapIfShown(/^Share selected data$/)) steps.push("shared from the wallet");
    } else {
      for (const [re, what] of STEPS) if (await tapIfShown(re)) { steps.push(what); break; }
      if (steps.includes("shared from the wallet") && steps.at(-1) === "picked the wallet in the system sheet") {
        steps.push("the system sheet came back after sharing: the response never reached the page");
        break;
      }
    }
    await sleep(1500);
  }
  const status = await page.$eval("#status", (e) => e.textContent ?? "");
  const log = await page.$eval("#log", (e) => e.textContent ?? "");
  // What arrived: answers in any QuestionnaireResponse, and the response size.
  const arrived = await page.$eval("#smart-response", (e) => {
    const qrAnswers = (e.textContent ?? "").match(/"answer"/g)?.length ?? 0;
    return { qrAnswers };
  });
  const sizeKb = Number(log.match(/Response size — ([\d.]+) KB/)?.[1] ?? log.match(/Response size — ([\d.]+) MB/)?.[1] ?? 0) * (/Response size — [\d.]+ MB/.test(log) ? 1024 : 1);
  page.browser().disconnect();
  return { status, log, steps, ...arrived, sizeKb };
}

// Extra expectations beyond "all checks passed", per case.
const EXPECT: Record<string, (r: Awaited<ReturnType<typeof runCase>>) => string | undefined> = {
  L2: (r) => (r.sizeKb > 512 ? undefined : `expected a response over 512 KB, got ${r.sizeKb} KB`),
};
const FORM_CASES = new Set(["M4", "O1", "O2", "O3", "O8", "O9", "O10"]);

// Responses over about 500 KB only reach the page when Chrome offers the
// large-payload channel (Chrome 150 and later); older Chrome drops them silently.
async function chromeMajor(): Promise<number> {
  const out = (await adb("shell", "dumpsys", "package", "com.android.chrome")).stdout.toString();
  return Number(out.match(/versionName=(\d+)/)?.[1] ?? 0);
}
const LARGE_CASES = new Set(["L2"]);

try {
  await setup();
} catch (e) {
  console.log(`FAIL setup: ${(e as Error).message}`);
  await saveEvidence("setup").catch(() => {});
  process.exit(1);
}
const chrome = await chromeMajor();
console.log(`device ${SERIAL}: Chrome ${chrome}`);
let bad = 0;
let skipped = 0;
for (const c of CASES) {
  if (LARGE_CASES.has(c) && chrome < 150) {
    skipped++;
    console.log(`skip ${c}: Chrome ${chrome} can't receive responses over about 500 KB from an Android wallet (needs Chrome 150 or later)`);
    continue;
  }
  console.log(`...  ${c}: running`);
  try {
    const r = await runCase(c).catch(async (e) => {
      if (!/detached|Target closed|Session closed|socket|ECONNRESET|webSocket/i.test((e as Error).message)) throw e;
      console.log(`     retrying ${c} after: ${(e as Error).message}`);
      return runCase(c);
    });
    const extra = EXPECT[c]?.(r) ?? (FORM_CASES.has(c) && !r.qrAnswers ? "the QuestionnaireResponse arrived with no answers" : undefined);
    const ok = /All checks passed/.test(r.status) && !extra;
    if (!ok) { bad++; await saveEvidence(c); }
    console.log(`${ok ? "ok  " : "FAIL"} ${c}: ${r.status}${extra ? ` | ${extra}` : ""}  [${r.steps.join(" → ")}]${r.qrAnswers ? ` (${r.qrAnswers} answer(s) received)` : ""}${c === "L2" ? ` (${r.sizeKb} KB)` : ""}`);
    if (!ok || process.env.VERBOSE) console.log(r.log.split("\n").map((l) => "     " + l).join("\n"));
  } catch (e) {
    bad++;
    console.log(`FAIL ${c}: ${(e as Error).message}`);
    await saveEvidence(c).catch(() => {});
  }
}
const ran = CASES.length - skipped;
console.log(`${bad ? `${bad} of ${ran} cases failed` : `all ${ran} cases passed`}${skipped ? `, ${skipped} skipped` : ""}`);
process.exit(bad ? 1 : 0);
