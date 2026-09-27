/**
 * Self-test (plan step 5.4): drives the live Testing EHR against the live
 * SMART Testing Wallet, and checks that each run gets the expected verdict:
 * the checks that fail and the checks that warn (spec §8.5: mdoc-layer
 * problems are warnings), and for a test case, every one of its expectations
 * met. Runs with a response size set check that the EHR receives about that
 * many characters of base64url.
 *
 * - Test cases (catalog.json): the run chooses the case in the EHR, whose
 *   "Testing Wallet options" do the case's step for the person using the
 *   wallet through the wallet's config URL.
 * - Faults and sizes: the run chooses a request (no case) and sets them in
 *   "Testing Wallet options", as a tester does; runs with `byUrl` add a config
 *   URL with "Add a wallet by URL", as on any Verifier page.
 * - Every run checks the wallet opened at the URL testing-wallet/src/config.ts
 *   gives, the documented format (testing-wallet/FEATURES.md#config-urls),
 *   and that the wallet's approval screen shows the options as on.
 *
 * The expected outcome of every fault lives here, not in the EHR or the wallet.
 *
 *   bun scripts/self-test.ts [base-url] [--only substring]
 */
import puppeteer, { type Browser } from "puppeteer-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configUrl, type WalletConfig } from "../testing-wallet/src/config.ts";
import type { TestCase } from "../testing-ehr/src/cases.ts";

const args = process.argv.slice(2);
const onlyAt = args.indexOf("--only");
const ONLY = onlyAt >= 0 ? args.splice(onlyAt, 2)[1] : undefined;
const BASE = args[0] ?? "https://smart-health-checkin.org/connectathon/";
const WALLET = "smart-testing-wallet";
const CATALOG: TestCase[] = JSON.parse(readFileSync(join(import.meta.dir, "..", "catalog.json"), "utf8")).testCases;

type Run = {
  name: string;
  /** A test case, or a request file with no case. */
  caseId?: string; request?: string;
  faults?: string[]; size?: string; byUrl?: boolean; rawUrl?: string; declineAll?: boolean;
  /** Leave the case's step undone (untick it in "Testing Wallet options"). */
  skipStep?: boolean;
  /** Check ids (or id prefixes) that must fail or warn. No other check may fail or warn. */
  expectFail?: string[]; expectWarn?: string[]; expectText?: RegExp;
};
const ALL_RUNS: Run[] = [
  // Every test case with a web path that this EHR and wallet can run on their own.
  ...["M1", "M3", "M4", "M5", "M6", "L1", "L2", "O1", "O2", "O3", "O4", "O5", "O6", "O7", "O10", "O12"].map((caseId) => ({ name: caseId, caseId })),
  // A case whose step isn't done: its expectation is not met, and the run fails.
  { name: "M5 without its step", caseId: "M5", skipStep: true, expectFail: ["expect-1"] },
  { name: "decline all (HOLD-4)", request: "baseline-1.json", declineAll: true, expectText: /declined/i },
  // The Testing Wallet's response size setting: valid responses, only larger.
  { name: "size 512 KB", request: "baseline-1.json", size: "512k" },
  { name: "size 5 MB", request: "baseline-4.json", size: "5m" },
  { name: "fault wrong-canonical", request: "baseline-3.json", faults: ["wrong-canonical"], expectFail: ["artifact-"], expectWarn: ["fulfilled-"] },
  { name: "fault missing-status", request: "baseline-1.json", faults: ["missing-status"], expectFail: ["status-"] },
  { name: "fault duplicate-status", request: "baseline-1.json", faults: ["duplicate-status"], expectFail: ["status-"] },
  { name: "fault wrong-request-id", request: "baseline-1.json", faults: ["wrong-request-id"], expectFail: ["request-id"], expectText: /Response rejected/ },
  { name: "fault unaccepted-media-type", request: "baseline-1.json", faults: ["unaccepted-media-type"], expectFail: ["artifact-"], expectWarn: ["fulfilled-"] },
  { name: "fault bad-signature", request: "baseline-1.json", faults: ["bad-signature"], expectWarn: ["issuer-sig"], expectText: /Passed with 1 warning/ },
  { name: "fault bad-encryption", request: "baseline-1.json", faults: ["bad-encryption"], expectFail: ["hpke"], expectText: /Response rejected/ },
  { name: "fault wrong-origin", request: "baseline-1.json", faults: ["wrong-origin"], expectFail: ["hpke"], expectText: /Likely cause[\s\S]*trailing slash/ },
  { name: "fault bad-shc-signature", request: "o6-smart-health-card.json", faults: ["bad-shc-signature"], expectFail: ["shc-"], expectWarn: ["fulfilled-"] },
  // Config URLs added by hand, as on any Verifier page: a combination, and one the wallet can't read (it says so and answers normally).
  { name: "config URL bad-signature + 512 KB", request: "baseline-1.json", faults: ["bad-signature"], size: "512k", byUrl: true, expectWarn: ["issuer-sig"] },
  { name: "config URL unreadable", request: "baseline-1.json", rawUrl: "bm90LWpzb24/", byUrl: true },
];

/** The Testing Wallet's response sizes, in characters of base64url. */
const SIZES: Record<string, number> = { "512k": 512 * 1024, "5m": 5 * 1024 * 1024 };

const RUNS = ONLY ? ALL_RUNS.filter((r) => r.name.includes(ONLY)) : ALL_RUNS;

async function runOne(browser: Browser, run: Run) {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push((e as Error).message));
  const tc = CATALOG.find((t) => t.id === run.caseId);
  if (run.caseId && !tc) throw new Error(`no test case ${run.caseId} in catalog.json`);
  await page.goto(`${BASE}testing-ehr/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => (document.getElementById("case") as HTMLSelectElement).options.length > 1);
  // What to send, then the test case (which selects its request).
  if (tc) await page.select("#case", tc.id);
  else await page.select("#request-file", run.request!);
  // Pick the wallet (a real click, so the page updates), set any Testing Wallet options, then Send.
  const plain = `${BASE}testing-wallet/`;
  const step: WalletConfig = (!run.skipStep && tc?.walletStep?.testingWallet) || {};
  const config: WalletConfig = { ...step, faults: [...(step.faults ?? []), ...(run.faults ?? [])], size: run.size ?? step.size };
  const expectUrl = run.rawUrl ? plain + run.rawUrl : configUrl(plain, config);
  let radio = `input[name="wallet"][value="${WALLET}"]`;
  if (run.byUrl) {
    await page.waitForSelector("#wallet-url", { timeout: 20000 });
    await page.type("#wallet-url", expectUrl);
    await page.click('#add-wallet button[type="submit"]');
    radio = `input[name="wallet"][value="url:${expectUrl}"]`;
  }
  await page.waitForSelector(radio, { timeout: 20000 });
  await page.click(radio);
  if (!run.byUrl && (run.faults?.length || run.size || run.skipStep)) {
    await page.$eval("#tw-options", (d) => ((d as HTMLDetailsElement).open = true));
    if (run.skipStep) await page.click("#tw-step");
    for (const f of run.faults ?? []) await page.click(`#tw-faults input[value="${f}"]`);
    if (run.size) await page.select("#tw-size", run.size);
  }
  const walletTarget = browser.waitForTarget((t) => t.opener() === page.target(), { timeout: 20000 });
  await page.click("#send");
  const wallet = (await (await walletTarget).page())!;
  if (wallet.url() !== expectUrl) errors.push(`the wallet opened at ${wallet.url()}, not ${expectUrl}`);
  await wallet.waitForFunction(() => { const b = document.getElementById("share") as HTMLButtonElement | null; return !!b && !b.disabled && !document.getElementById("consent")!.hidden; }, { timeout: 60000 });
  let walletChars: number | undefined;
  if (run.size) {
    await wallet.waitForFunction(() => document.getElementById("size-line")!.dataset.state === "ready", { timeout: 60000 });
    walletChars = Number(await wallet.$eval("#size-line", (e) => (e as HTMLElement).dataset.chars));
  }
  // The approval screen shows what the URL turned on, or why it couldn't.
  const banner = await wallet.$eval("#options-text", (e) => e.textContent ?? "");
  for (const f of run.faults ?? []) if (!banner.includes(f)) errors.push(`the wallet's approval screen doesn't show fault ${f} as on`);
  if (run.size && !banner.includes("response size")) errors.push("the wallet's approval screen doesn't show the response size as on");
  const configError = await wallet.$eval("#config-error", (e) => ((e as HTMLElement).hidden ? "" : e.textContent ?? ""));
  if (!!run.rawUrl !== !!configError) errors.push(run.rawUrl ? "the wallet didn't say it couldn't read the config" : `the wallet reported a config error: ${configError}`);
  for (let i = 0; i < 60; i++) {
    const clicked = await wallet.evaluate(() => {
      for (const g of document.querySelectorAll(".q-choice .q-options")) {
        const radios = [...g.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
        if (radios.length && !radios.some((r) => r.checked)) { radios[0]!.click(); return true; }
      }
      return false;
    });
    if (!clicked) break;
  }
  const started = Date.now();
  await wallet.$eval(run.declineAll ? "#decline" : "#share", (b) => (b as HTMLButtonElement).click());
  await page.waitForFunction(() => /passed|Passed|failed|Error|declined/.test(document.getElementById("status")!.textContent ?? ""), { timeout: 120000 });
  const status = await page.$eval("#status", (e) => e.textContent ?? "");
  const log = await page.$eval("#log", (e) => e.textContent ?? "");
  const result = await page.$eval("#result", (e) => (e as HTMLElement).innerText);
  const ms = Date.now() - started;
  await page.close();
  // Log lines read "[FAIL] <id> (<rule>): <title> — <detail>".
  const idsWith = (outcome: string) => [...log.matchAll(new RegExp(`^\\[${outcome}\\] ([^\\s:(]+)`, "gm"))].map((m) => m[1]!);
  if (run.size) {
    const want = SIZES[run.size]!;
    const kb = Number(/Response size[^\n]*?([\d.]+) KB/.exec(log)?.[1]);
    if (!(kb * 1024 >= want * 0.95 && kb * 1024 <= want * 1.05)) errors.push(`the EHR received ${kb} KB, not about ${want / 1024} KB`);
    if (walletChars && Math.abs(walletChars - kb * 1024) > 1024) errors.push(`the wallet showed ${walletChars} characters, the EHR ${kb} KB`);
  }
  // A test case: every expectation evaluated, each one met (a miss is a [FAIL] expect-n line, so it's unexpected).
  if (tc) {
    const evaluated = [...log.matchAll(/^\[(PASS|FAIL)\] expect-\d+ /gm)].length;
    if (evaluated !== tc.expect.length) errors.push(`the EHR evaluated ${evaluated} of the case's ${tc.expect.length} expectations`);
  }
  const note = run.size ? ` (${log.match(/Response size[^\n]*?([\d.]+ KB)/)?.[1]}, ${(ms / 1000).toFixed(1)} s from Share to verdict)` : "";
  return { status: status + note, log, failedIds: idsWith("FAIL"), warnedIds: idsWith("WARN"), errors, result };
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
let bad = 0;
try {
  for (const run of RUNS) {
    try {
      const r = await runOne(browser, run);
      const compare = (got: string[], want: string[]) => ({
        missing: want.filter((e) => !got.some((f) => f.startsWith(e))),
        unexpected: got.filter((f) => !want.some((e) => f.startsWith(e))),
      });
      const fails = compare(r.failedIds, run.expectFail ?? []);
      const warns = compare(r.warnedIds, run.expectWarn ?? []);
      const missing = [...fails.missing, ...warns.missing.map((w) => `${w} (warn)`)];
      const unexpected = [...fails.unexpected, ...warns.unexpected.map((w) => `${w} (warn)`)];
      if (run.expectText && !run.expectText.test(r.result)) r.errors.push(`result doesn't match ${run.expectText}`);
      const ok = !missing.length && !unexpected.length && !r.errors.length;
      if (!ok) bad++;
      console.log(`${ok ? "ok  " : "FAIL"} ${run.name}: ${r.status}${missing.length ? ` | expected but absent: ${missing.join(", ")}` : ""}${unexpected.length ? ` | unexpected: ${unexpected.join(", ")}` : ""}${r.errors.length ? ` | page errors: ${r.errors.join("; ")}` : ""}`);
      if (!ok) console.log(r.log.split("\n").map((l) => "     " + l).join("\n"));
    } catch (e) {
      bad++;
      console.log(`FAIL ${run.name}: ${(e as Error).message}`);
    }
  }
} finally {
  await browser.close();
}
console.log(bad ? `${bad} of ${RUNS.length} runs did not behave as expected` : `all ${RUNS.length} runs behaved as expected`);
process.exit(bad ? 1 : 0);
