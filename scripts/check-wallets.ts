/**
 * Fetches every walletUrl in the built registry and prints the ones that fail.
 * Exits 1 when any fail. Used by the registry-liveness workflow.
 */
const registryUrl = process.argv[2] ?? "https://smart-health-checkin.org/connectathon/wallets.json";
const registry = await (await fetch(registryUrl)).json();
const failures: string[] = [];
for (const w of registry.wallets) {
  try {
    const res = await fetch(w.walletUrl, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!res.ok) failures.push(`- \`${w.id}\` ${w.walletUrl}: HTTP ${res.status}`);
  } catch (e) {
    failures.push(`- \`${w.id}\` ${w.walletUrl}: ${(e as Error).message}`);
  }
}
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
console.log(`all ${registry.wallets.length} wallet URLs load`);
