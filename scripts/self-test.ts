/**
 * Self-test (plan step 5.4): drives the live testing EHR against the live
 * SMART Testing Wallet for every web-path scenario and every injected fault,
 * and checks that each run gets the expected verdict.
 *
 *   bun scripts/self-test.ts [base-url] [--only substring]
 */
import puppeteer, { type Browser } from "puppeteer-core";

const args = process.argv.slice(2);
const onlyAt = args.indexOf("--only");
const ONLY = onlyAt >= 0 ? args.splice(onlyAt, 2)[1] : undefined;
const BASE = args[0] ?? "https://smart-health-checkin.org/connectathon/";
const WALLET = "smart-testing-wallet";

type Run = { name: string; caseId: string; faults?: string[]; patient?: string; decline?: string[]; expectFail?: string[] };
// expectFail: check ids (or id prefixes) that must fail. Everything else must not fail.
const ALL_RUNS: Run[] = [
  { name: "M1 baseline 1", caseId: "M1" },
  { name: "M3 insurance", caseId: "M3" },
  { name: "M4 PHQ-2 inline", caseId: "M4" },
  { name: "M5 decline immunizations", caseId: "M5", decline: ["immunizations"] },
  { name: "L1 USCDI small", caseId: "L1" },
  { name: "L2 USCDI large", caseId: "L2", patient: "large" },
  { name: "O1 by reference", caseId: "O1" },
  { name: "O2 versioned canonical", caseId: "O2" },
  { name: "O3 semaglutide", caseId: "O3" },
  { name: "O4 narrowed family", caseId: "O4" },
  { name: "O5 no selector", caseId: "O5" },
  { name: "O6 health card", caseId: "O6" },
  { name: "O7 combined artifact", caseId: "O7", faults: ["combine-allergies-meds"] },
  { name: "O12 unknown selector", caseId: "O12" },
  { name: "fault wrong-canonical", caseId: "M4", faults: ["wrong-canonical"], expectFail: ["canonical-", "cross"] },
  { name: "fault missing-status", caseId: "M1", faults: ["missing-status"], expectFail: ["one-status", "cross"] },
  { name: "fault duplicate-status", caseId: "M1", faults: ["duplicate-status"], expectFail: ["one-status", "shape", "cross"] },
  { name: "fault wrong-request-id", caseId: "M1", faults: ["wrong-request-id"], expectFail: ["request-id", "cross"] },
  { name: "fault unaccepted-media-type", caseId: "M1", faults: ["unaccepted-media-type"], expectFail: ["media", "cross"] },
  { name: "fault oversized", caseId: "M1", faults: ["oversized"], expectFail: [] },
  { name: "fault bad-signature", caseId: "M1", faults: ["bad-signature"], expectFail: ["issuer-sig"] },
  { name: "fault bad-encryption", caseId: "M1", faults: ["bad-encryption"], expectFail: ["hpke"] },
  { name: "fault wrong-origin", caseId: "M1", faults: ["wrong-origin"], expectFail: ["hpke"] },
  { name: "fault bad-shc-signature", caseId: "O6", faults: ["bad-shc-signature"], expectFail: ["shc-"] },
];

const RUNS = ONLY ? ALL_RUNS.filter((r) => r.name.includes(ONLY)) : ALL_RUNS;

async function runOne(browser: Browser, run: Run) {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push((e as Error).message));
  await page.goto(`${BASE}testing-ehr/#case=${run.caseId}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => (document.getElementById("case") as HTMLSelectElement).options.length > 0);
  await page.select("#case", run.caseId);
  // Pick the wallet, then its faults (real clicks, so the page updates), then Send.
  const radio = `input[name="wallet"][value="${WALLET}"]`;
  await page.waitForSelector(radio, { timeout: 20000 });
  await page.click(radio);
  if (run.faults?.length) await page.$eval("#fault-box", (d) => ((d as HTMLDetailsElement).open = true));
  for (const f of run.faults ?? []) await page.click(`#faults input[value="${f}"]`);
  const walletTarget = browser.waitForTarget((t) => t.opener() === page.target(), { timeout: 20000 });
  await page.click("#send");
  const wallet = (await (await walletTarget).page())!;
  await wallet.waitForFunction(() => { const b = document.getElementById("share") as HTMLButtonElement | null; return !!b && !b.disabled && !document.getElementById("consent")!.hidden; }, { timeout: 60000 });
  if (run.patient) {
    await wallet.select("#patient", run.patient);
    await wallet.waitForFunction(() => !(document.getElementById("share") as HTMLButtonElement).disabled, { timeout: 60000 });
  }
  for (const id of run.decline ?? []) {
    await wallet.evaluate((itemId) => {
      const cards = [...document.querySelectorAll(".item")];
      const card = cards.find((c) => c.querySelector("b")?.textContent && (c as HTMLElement).innerText.toLowerCase().includes(itemId));
      (card?.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.click();
    }, id);
  }
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
  await wallet.$eval("#share", (b) => (b as HTMLButtonElement).click());
  await page.waitForFunction(() => /passed|failed|Error|declined/.test(document.getElementById("status")!.textContent ?? ""), { timeout: 120000 });
  const status = await page.$eval("#status", (e) => e.textContent ?? "");
  const log = await page.$eval("#log", (e) => e.textContent ?? "");
  await page.close();
  const failedIds = [...log.matchAll(/^\[FAIL\] (.+?)(?: — |$)/gm)].map((m) => m[1]!);
  return { status, log, failedIds, errors };
}

// Map check titles in the log back to their ids via a title fragment table.
const TITLE_TO_ID: Array<[RegExp, string]> = [
  [/decrypts with this page/, "hpke"], [/Issuer signature/, "issuer-sig"], [/Device signature/, "device-sig"],
  [/Value digests/, "digests"], [/requestId echoes/, "request-id"], [/Exactly one status/, "one-status"],
  [/consistent with the request/, "cross"], [/media type is accepted/, "media"], [/echoes the canonical/, "canonical-"],
  [/SMART Health Card signature/, "shc-"], [/well formed/, "shape"],
];
const idFor = (title: string) => TITLE_TO_ID.find(([re]) => re.test(title))?.[1] ?? title;

const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
let bad = 0;
try {
  for (const run of RUNS) {
    try {
      const r = await runOne(browser, run);
      const failed = r.failedIds.map(idFor);
      const expected = run.expectFail ?? [];
      const missing = expected.filter((e) => !failed.some((f) => f.startsWith(e)));
      const unexpected = failed.filter((f) => !expected.some((e) => f.startsWith(e)));
      const ok = !missing.length && !unexpected.length && !r.errors.length;
      if (!ok) bad++;
      console.log(`${ok ? "ok  " : "FAIL"} ${run.name}: ${r.status}${missing.length ? ` | expected to fail: ${missing.join(", ")}` : ""}${unexpected.length ? ` | unexpected failures: ${unexpected.join(", ")}` : ""}${r.errors.length ? ` | page errors: ${r.errors.join("; ")}` : ""}`);
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
