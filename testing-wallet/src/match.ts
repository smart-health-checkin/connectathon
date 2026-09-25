// Selector matching for selection.fhir items (spec §5.4.1, §5.5).

export type Resource = { resourceType: string; meta?: { profile?: string[] }; [k: string]: unknown };
export type Entry = { fullUrl: string; resource: Resource };

export type SelectionContent = {
  kind: "selection.fhir";
  profiles?: string[];
  profilesFrom?: string[];
  resourceTypes?: string[];
};

const splitCanonical = (c: string) => {
  const bar = c.indexOf("|");
  return bar < 0 ? { url: c, version: undefined } : { url: c.slice(0, bar), version: c.slice(bar + 1) };
};

/** Does a resource's declared profile satisfy one requested exact profile? */
function profileMatches(declared: string, requested: string): boolean {
  const want = splitCanonical(requested);
  const have = splitCanonical(declared);
  if (want.url !== have.url) return false;
  // Unversioned request: any version. Versioned request: exact version only.
  return want.version === undefined || want.version === have.version;
}

/** Is a declared profile a member of a requested profile family? */
function inFamily(declared: string, family: string): boolean {
  const base = family.replace(/\/+$/, "");
  const { url } = splitCanonical(declared);
  return url.startsWith(base + "/StructureDefinition/");
}

export function selects(content: SelectionContent, r: Resource): boolean {
  const profiles = r.meta?.profile ?? [];
  const hasProfileSelector = !!(content.profiles?.length || content.profilesFrom?.length);
  const typeOk = !content.resourceTypes?.length || content.resourceTypes.includes(r.resourceType);
  if (!hasProfileSelector) return typeOk;
  const byProfile =
    (content.profiles ?? []).some((p) => profiles.some((d) => profileMatches(d, p))) ||
    (content.profilesFrom ?? []).some((f) => profiles.some((d) => inFamily(d, f)));
  return byProfile && typeOk;
}

/** Entries matching the selector, plus the resources they reference so references resolve. */
export function selectEntries(content: SelectionContent, entries: Entry[], patientFullUrl: string): Entry[] {
  const noSelector = !content.profiles?.length && !content.profilesFrom?.length && !content.resourceTypes?.length;
  const primary = noSelector ? entries : entries.filter((e) => selects(content, e.resource));
  const byUrl = new Map(entries.map((e) => [e.fullUrl, e]));
  const out = new Map(primary.map((e) => [e.fullUrl, e]));
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === "reference" && typeof v === "string" && v !== patientFullUrl && byUrl.has(v) && !out.has(v)) {
          out.set(v, byUrl.get(v)!);
          visit(byUrl.get(v)!.resource);
        } else visit(v);
      }
    }
  };
  if (primary.length) primary.forEach((e) => visit(e.resource));
  return [...out.values()];
}

export function describeEntries(entries: Entry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.resource.resourceType, (counts.get(e.resource.resourceType) ?? 0) + 1);
  return [...counts.entries()].map(([t, n]) => `${n} ${t}`).join(", ") || "nothing";
}
