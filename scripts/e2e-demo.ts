/**
 * End-to-end check against the live site: the reference EHR sends a request
 * to a web wallet from the event registry, the wallet shares everything, and
 * the EHR shows the verified outcome.
 *
 *   bun scripts/e2e-demo.ts [request-file] [wallet-id] [wallet-fragment]
 *
 * wallet-id: smart-testing-wallet (default) or smart-demo-wallet.
 * wallet-settings: testing wallet settings applied after the request arrives, for example "patient=large".
 */
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";

const requestFile = process.argv[2] ?? "requests/baseline-1.json";
const walletId = process.argv[3] ?? "smart-testing-wallet";
const walletFragment = process.argv[4] ?? "";
const request = JSON.parse(readFileSync(requestFile, "utf8"));
request.id = `e2e-${Date.now()}`;
const registry = "https://smart-health-checkin.org/connectathon/wallets.json";
const url = `https://smart-health-checkin.org/client/demo/#request=${Buffer.from(JSON.stringify(request)).toString("base64url")}&wallets=${encodeURIComponent(registry)}&wallet=${walletId}`;

const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && console.log("[ehr console]", m.text()));
  await page.goto(url, { waitUntil: "networkidle0" });
  const walletTarget = browser.waitForTarget((t) => t.opener() === page.target(), { timeout: 20000 });
  await page.click("#start");
  const wallet = await (await walletTarget).page();
  if (!wallet) throw new Error("wallet tab did not open");
  wallet.on("console", (m) => m.type() === "error" && console.log("[wallet console]", m.text()));
  wallet.on("pageerror", (e) => console.log("[wallet error]", e.message));
  await wallet.waitForSelector("#share", { visible: true, timeout: 30000 });
  // Settings that can change after the request arrives, e.g. "patient=large".
  const patientKey = new URLSearchParams(walletFragment).get("patient");
  if (patientKey) {
    await wallet.select("#patient", patientKey);
    await wallet.waitForFunction(() => document.querySelectorAll(".item").length > 0, { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));
  }
  const origin = await wallet.$eval(walletId === "smart-testing-wallet" ? "#origin" : "#requester-origin", (e) => e.textContent);
  console.log("wallet shows requester:", origin);
  if (walletId === "smart-testing-wallet") {
    const previews = await wallet.$$eval(".item", (els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ").slice(0, 160)));
    console.log(previews.map((p) => `  item: ${p}`).join("\n"));
    // Answer the first option of every single-choice question, so forms carry answers.
    // Re-query after each click: the form re-renders on every answer.
    for (let i = 0; i < 50; i++) {
      const clicked = await wallet.evaluate(() => {
        for (const g of document.querySelectorAll(".q-choice .q-options")) {
          const radios = [...g.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
          if (radios.length && !radios.some((r) => r.checked)) { radios[0]!.click(); return true; }
        }
        return false;
      });
      if (!clicked) break;
    }
  }
  await wallet.$eval("#share", (b) => (b as HTMLButtonElement).click());
  try {
    await page.waitForFunction(() => !document.getElementById("outcome-section")?.hidden, { timeout: 30000 });
  } catch {
    const walletText = await wallet.evaluate(() => document.body.innerText).catch(() => "(wallet tab closed)");
    const ehrText = await page.evaluate(() => document.body.innerText);
    console.log("--- wallet tab\n" + walletText.slice(0, 1500) + "\n--- EHR tab\n" + ehrText.slice(0, 1500));
    console.log("E2E FAIL: no outcome");
    process.exit(1);
  }
  const outcome = await page.$eval("#outcome-section", (e) => (e as HTMLElement).innerText);
  console.log(outcome.split("\n").slice(0, 16).join("\n"));
  const ok = origin === "https://smart-health-checkin.org" && /checked in|complete/i.test(outcome);
  console.log(ok ? "E2E PASS" : "E2E CHECK OUTPUT ABOVE");
  process.exit(ok ? 0 : 1);
} finally {
  await browser.close();
}
