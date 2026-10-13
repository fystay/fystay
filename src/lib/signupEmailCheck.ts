import { emailFormatError, suggestEmailCorrection } from "@/lib/emailValidation";
import { checkEmailDomain, emailDnsCheckEnabled, type EmailDomainCheck } from "@/lib/emailDomainDns";

export type NewEmailCheck =
  | { ok: true }
  | { ok: false; status: 400; error: string }
  | { ok: false; status: 422; error: string; suggestion: string };

/**
 * The server's checks on an address someone is about to sign up (or switch
 * their account) with. In order: its shape; a likely typo, which needs the
 * person to confirm the address as typed (`acceptedAsTyped`) before it's
 * used; and, on deployed sites, whether its domain can take mail at all. A
 * DNS lookup that can't answer never blocks anyone.
 */
export async function checkNewEmail(
  email: string,
  options: { acceptedAsTyped?: boolean; checkDomain?: (domain: string) => Promise<EmailDomainCheck>; dnsEnabled?: boolean } = {},
): Promise<NewEmailCheck> {
  const formatError = emailFormatError(email);
  if (formatError) return { ok: false, status: 400, error: formatError };

  if (!options.acceptedAsTyped) {
    const suggestion = suggestEmailCorrection(email);
    if (suggestion) return { ok: false, status: 422, error: `Did you mean ${suggestion}?`, suggestion };
  }

  if (options.dnsEnabled ?? emailDnsCheckEnabled()) {
    const domain = email.trim().toLowerCase().split("@")[1];
    const result = await (options.checkDomain ?? checkEmailDomain)(domain);
    if (result === "no_domain") {
      return { ok: false, status: 400, error: `We can't find the email domain "${domain}". Check the part after the @.` };
    }
    if (result === "no_mail") {
      return { ok: false, status: 400, error: `"${domain}" doesn't accept email. Check the address, or use a different one.` };
    }
  }
  return { ok: true };
}
