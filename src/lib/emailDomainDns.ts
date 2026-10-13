import { promises as dns } from "node:dns";

/**
 * Whether an email address's domain can receive mail at all, from its DNS.
 * A signal, never proof: a domain that takes mail says nothing about one
 * particular mailbox, and only the confirmation link proves that.
 *
 *   ok        - MX records, or (no MX but) an address record mail can fall back to
 *   no_mail   - the domain exists but publishes nowhere to deliver mail
 *   no_domain - the domain doesn't exist
 *   unknown   - DNS couldn't answer in time; never treated as a failure
 */
export type EmailDomainCheck = "ok" | "no_mail" | "no_domain" | "unknown";

type Resolver = Pick<typeof dns, "resolveMx" | "resolve4" | "resolve6">;

const TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), TIMEOUT_MS)),
  ]);
}

const MISSING = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);
const code = (error: unknown) => (error as { code?: string } | null)?.code ?? "";

async function hasRecords(lookup: () => Promise<unknown[]>): Promise<boolean | "missing-domain" | "error"> {
  try {
    const records = await withTimeout(lookup());
    return records.length > 0;
  } catch (error) {
    if (code(error) === "ENOTFOUND") return "missing-domain";
    if (MISSING.has(code(error))) return false;
    return "error";
  }
}

export async function checkEmailDomain(domain: string, resolver: Resolver = dns): Promise<EmailDomainCheck> {
  const mx = await hasRecords(() => resolver.resolveMx(domain));
  if (mx === true) return "ok";
  if (mx === "missing-domain") return "no_domain";
  if (mx === "error") return "unknown";
  // No MX: mail can still go to the domain's own address (RFC 5321 §5.1).
  const [a, aaaa] = await Promise.all([hasRecords(() => resolver.resolve4(domain)), hasRecords(() => resolver.resolve6(domain))]);
  if (a === true || aaaa === true) return "ok";
  if (a === "error" || aaaa === "error") return "unknown";
  return "no_mail";
}

/**
 * Deployed sites check DNS; local runs and CI don't, where test addresses
 * use made-up domains and DNS may be blocked. EMAIL_DNS_CHECK=on|off overrides.
 */
export function emailDnsCheckEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const setting = env.EMAIL_DNS_CHECK?.trim().toLowerCase();
  if (setting === "on") return true;
  if (setting === "off") return false;
  return Boolean(env.VERCEL);
}
