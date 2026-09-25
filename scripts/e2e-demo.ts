/**
 * End-to-end check against the live site: the reference EHR sends a request
 * to a web wallet from the event registry, the wallet shares everything, and
 * the EHR shows the verified outcome.
 *
 *   bun scripts/e2e-demo.ts [request-file] [wallet-id]
 */
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";

const requestFile = process.argv[2] ?? "requests/baseline-1.json";
const walletId = process.argv[3] ?? "smart-demo-wallet";
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
  await wallet.waitForSelector("#share", { visible: true, timeout: 20000 });
  const origin = await wallet.$eval("#requester-origin", (e) => e.textContent);
  console.log("wallet shows requester:", origin);
  await wallet.click("#share");
  await page.waitForFunction(() => !document.getElementById("outcome-section")?.hidden, { timeout: 20000 });
  const outcome = await page.$eval("#outcome-section", (e) => (e as HTMLElement).innerText);
  console.log(outcome.split("\n").slice(0, 12).join("\n"));
  const ok = origin === "https://smart-health-checkin.org" && /complete|shared|received/i.test(outcome);
  console.log(ok ? "E2E PASS" : "E2E CHECK OUTPUT ABOVE");
  process.exit(ok ? 0 : 1);
} finally {
  await browser.close();
}
