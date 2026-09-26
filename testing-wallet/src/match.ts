// Types for the wallet's records, and a summary for the consent screen.
// Matching itself is the library's: selectEntries from @smart-health-checkin/client/wallet.

export type Resource = { resourceType: string; meta?: { profile?: string[] }; [k: string]: unknown };
export type Entry = { fullUrl: string; resource: Resource };

export function describeEntries(entries: Entry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.resource.resourceType, (counts.get(e.resource.resourceType) ?? 0) + 1);
  return [...counts.entries()].map(([t, n]) => `${n} ${t}`).join(", ") || "nothing";
}
