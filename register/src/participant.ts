// The participant file format, shared by the registration form, the build, and the tests.
// participants/schema.json is the source of truth; this adds labels, readable messages,
// and the checks a schema can't express.

export type Role = "verifier" | "web-wallet" | "native-wallet";
export type Access = "install" | "invite" | "team-device";
export type Contact = { name: string; github?: string; slack?: string; email?: string };
export type Component = {
  id: string; role: Role; name: string; status: string; description?: string;
  url?: string; walletUrl?: string; iconUrl?: string; homepage?: string; target?: "tab" | "popup";
  platforms?: string[]; access?: Access; installUrl?: string; requirements?: string; largeResponses?: boolean;
  testPatient?: string; notes?: string;
};
export type Participant = { organization: string; homepage?: string; contacts?: Contact[]; components: Component[] };
export type Validate = ((v: unknown) => boolean) & { errors?: any[] | null };

/** A component that is a phone app: every native wallet, and a Verifier registered with platforms. */
export const isApp = (c: Partial<Component>) => c.role === "native-wallet" || (c.role === "verifier" && !!c.platforms);
/** How testers get a phone app; install when left out. */
export const accessOf = (c: Partial<Component>): Access => c.access ?? "install";

export const ROLE_LABEL: Record<Role, string> = {
  verifier: "Verifier",
  "web-wallet": "Web wallet",
  "native-wallet": "Native wallet",
};
export const PLATFORM_LABEL: Record<string, string> = { android: "Android", ios: "iOS" };
export const ACCESS_LABEL: Record<Access, string> = {
  install: "Anyone installs it from a link",
  invite: "Testers ask us for an invite",
  "team-device": "Testers try it with us, on our phone",
};

export const FIELD_LABEL: Record<string, string> = {
  organization: "Organization name", homepage: "Home page", contacts: "Contacts", components: "Components",
  name: "Name", github: "GitHub username", slack: "Slack display name", email: "Email",
  id: "Short id", role: "Role", status: "Status", description: "Description",
  url: "Check-in page URL", walletUrl: "Wallet URL", iconUrl: "Icon URL", target: "Open as",
  platforms: "Platforms", access: "How testers get it", installUrl: "Install link", requirements: "Phone needs",
  largeResponses: "Large responses", testPatient: "Test patient", notes: "Notes for testers",
};
const URL_FIELDS = ["url", "walletUrl", "installUrl", "iconUrl", "homepage"] as const;

/** One readable line per problem, or [] when the file is valid. */
export function participantProblems(data: any, validate: Validate): string[] {
  const out: string[] = [];
  if (!validate(data)) {
    for (const e of validate.errors ?? []) {
      const msg = describeError(e, data);
      if (msg) out.push(msg);
    }
  }
  const comps: Component[] = Array.isArray(data?.components) ? data.components : [];
  const seen = new Set<string>();
  comps.forEach((c, i) => {
    if (c?.id && seen.has(c.id)) out.push(`${where(data, `/components/${i}`)}: short id "${c.id}" is used twice in this file`);
    if (c?.id) seen.add(c.id);
    for (const k of URL_FIELDS) {
      const v = (c as any)?.[k];
      if (typeof v === "string" && v && !v.startsWith("https://")) out.push(`${where(data, `/components/${i}`)}: ${FIELD_LABEL[k]} must start with https://`);
    }
  });
  if (typeof data?.homepage === "string" && data.homepage && !data.homepage.startsWith("https://")) out.push("Organization: Home page must start with https://");
  return [...new Set(out)];
}

function where(data: any, path: string): string {
  let m = /^\/components\/(\d+)/.exec(path);
  if (m) {
    const c = data?.components?.[+m[1]];
    return c?.name ? `${c.name}` : `Component ${+m[1] + 1}`;
  }
  m = /^\/contacts\/(\d+)/.exec(path);
  if (m) return `Contact ${+m[1] + 1}`;
  return "Organization";
}

function describeError(e: any, data: any): string | null {
  const path: string = e.instancePath ?? "";
  const field = path.split("/").filter((s) => !/^\d+$/.test(s)).pop() ?? "";
  const label = FIELD_LABEL[field] ?? field;
  const at = where(data, path);
  switch (e.keyword) {
    case "if":
      return null; // the failing "then" reports the real problem
    case "anyOf":
      if (/^\/contacts\/\d+$/.test(path)) return `${at}: add a GitHub username, Slack display name, or email, so testers can reach them`;
      if (/^\/components\/\d+$/.test(path)) return `${at}: a Verifier needs a check-in page URL, or platforms if it is a phone app`;
      return `${at}: doesn't match any allowed form`;
    case "required": {
      if (String(e.schemaPath).includes("/anyOf/")) return null; // reported by the anyOf message
      const missing = e.params.missingProperty as string;
      if (missing === "installUrl") return `${at}: add an Install link (installUrl), or set How testers get it (access) to an invite or testing with you`;
      if (missing === "contacts") return "Contacts: add at least one contact";
      return `${at}: ${FIELD_LABEL[missing] ?? missing} is required`;
    }
    case "minLength":
      return `${at}: ${label} is required`;
    case "minItems":
      if (field === "platforms") return `${at}: pick at least one platform`;
      if (field === "components") return "Components: add at least one component";
      if (field === "contacts") return "Contacts: add at least one contact";
      return `${at}: ${label} needs at least ${e.params.limit}`;
    case "format":
      return e.params.format === "email" ? `${at}: ${label} must be an email address` : `${at}: ${label} must be a full URL starting with https://`;
    case "pattern":
      if (field === "id") return `${at}: Short id may use only lowercase letters, digits, and hyphens, starting with a letter or digit`;
      if (field === "github") return `${at}: GitHub username only, without @ or a URL`;
      return `${at}: ${label} has the wrong form`;
    case "enum":
      return `${at}: ${label} must be one of ${e.params.allowedValues.map((v: string) => `"${v}"`).join(", ")}`;
    case "additionalProperties":
      return `${at}: unknown field "${e.params.additionalProperty}"`;
    case "type":
      return `${at}: ${label || "the file"} must be ${e.params.type === "array" ? "a list" : `a ${e.params.type}`}`;
    case "uniqueItems":
      return `${at}: ${label} lists the same value twice`;
    default:
      return `${at}: ${label ? label + " " : ""}${e.message}`;
  }
}
