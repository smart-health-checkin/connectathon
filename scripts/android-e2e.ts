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
const CASES = args.length ? args : ["M1", "M3", "M4", "O6"];
const ADB = `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Android/Sdk`}/platform-tools/adb`;
const WALLET_PKG = "org.smarthealthit.checkin.wallet";
const RELEASE_APK = "https://github.com/smart-health-checkin/spec/releases/latest/download/smart-checkin-wallet-debug.apk";

const adb = (...a: string[]) => $`${ADB} -s ${SERIAL} ${a}`.quiet().nothrow();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Node = { text: string; desc: string; x: number; y: number };
async function screen(): Promise<Node[]> {
  await adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
  const xml = (await adb("shell", "cat", "/sdcard/ui.xml")).stdout.toString();
  return [...xml.matchAll(/<node [^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)].map((m) => ({
    text: m[1]!, desc: m[2]!, x: (Number(m[3]) + Number(m[5])) >> 1, y: (Number(m[4]) + Number(m[6])) >> 1,
  }));
}
async function tapIfShown(re: RegExp): Promise<boolean> {
  const n = (await screen()).find((n) => re.test(n.text) || re.test(n.desc));
  if (!n) return false;
  await adb("shell", "input", "tap", String(n.x), String(n.y));
  return true;
}

// Taps through whatever system or wallet screen is in front until the page has a verdict.
const STEPS: Array<[RegExp, string]> = [
  [/^No thanks$/, "dismissed a Chrome prompt"],
  [/^Continue$/, "trusted the site"],
  [/^Agree and continue$/, "picked the wallet in the system sheet"],
  [/^Share selected data$/, "shared from the wallet"],
];

async function ehrPage(): Promise<Page> {
  const browser = await puppeteer.connect({ browserURL: `http://localhost:${PORT}`, defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().includes("/testing-ehr/"));
  if (!page) throw new Error("the testing EHR tab is not open in Chrome");
  return page;
}

async function setup() {
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
  await adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'${BASE}testing-ehr/#case=M1&wallet=platform'`, "com.android.chrome");
  await sleep(6000);
  await tapIfShown(/^No thanks$/);
  await adb("forward", `tcp:${PORT}`, "localabstract:chrome_devtools_remote");
}

async function runCase(caseId: string) {
  const page = await ehrPage();
  await page.goto(`${BASE}testing-ehr/#case=${caseId}&wallet=platform`, { waitUntil: "networkidle0" });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(() => (document.getElementById("case") as HTMLSelectElement).options.length > 0);
  await page.select("#case", caseId);
  await page.select("#wallet", "platform");
  await page.click("#run"); // a real input event, so the page has user activation
  const steps: string[] = [];
  for (let i = 0; i < 40; i++) {
    const status = await page.$eval("#status", (e) => e.textContent ?? "").catch(() => "");
    if (/passed|failed|Error|declined/.test(status)) break;
    for (const [re, what] of STEPS) if (await tapIfShown(re)) { steps.push(what); break; }
    await sleep(1500);
  }
  const status = await page.$eval("#status", (e) => e.textContent ?? "");
  const log = await page.$eval("#log", (e) => e.textContent ?? "");
  page.browser().disconnect();
  return { status, log, steps };
}

await setup();
let bad = 0;
for (const c of CASES) {
  try {
    const r = await runCase(c);
    const ok = /All checks passed/.test(r.status);
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${c}: ${r.status}  [${r.steps.join(" → ")}]`);
    if (!ok || process.env.VERBOSE) console.log(r.log.split("\n").map((l) => "     " + l).join("\n"));
  } catch (e) {
    bad++;
    console.log(`FAIL ${c}: ${(e as Error).message}`);
  }
}
console.log(bad ? `${bad} of ${CASES.length} cases failed` : `all ${CASES.length} cases passed`);
process.exit(bad ? 1 : 0);
