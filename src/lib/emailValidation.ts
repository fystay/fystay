/**
 * Catching mistyped email addresses before an account is created. Pure -
 * no network - so the sign-up form and the server run the same rules. It
 * only ever *suggests*: an address is never rewritten, and passing these
 * checks says nothing about whether the mailbox exists. Only clicking the
 * confirmation link proves that (see src/lib/emailVerification.ts).
 */

const MAX_EMAIL_LENGTH = 254;
const LOCAL_PART = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i;

/** Why an address isn't a usable email address, or null when its shape is fine. */
export function emailFormatError(raw: string): string | null {
  const email = raw.trim();
  const generic = "Please enter a valid email address, like name@example.com.";
  if (!email || email.length > MAX_EMAIL_LENGTH) return generic;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@")) return generic;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return generic;
  }
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) {
    return "That email address's domain doesn't look right - check the part after the @.";
  }
  if (!TLD.test(labels[labels.length - 1])) {
    return "That email address's ending doesn't look right - check the part after the last dot.";
  }
  return null;
}

/**
 * Domains people most often mean. A domain one or two keystrokes away from
 * one of these (gmial.com, hotmial.co.uk, fystay.couk) gets a suggestion;
 * anything else - however unusual - is left alone.
 */
export const KNOWN_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "live.co.uk",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "btinternet.com",
  "sky.com",
  "virginmedia.com",
  "talktalk.net",
  "ntlworld.com",
  "protonmail.com",
  "proton.me",
  "fystay.co.uk",
] as const;

// Endings that are almost always a slip for a real one. Only endings that
// aren't themselves real top-level domains (".cm", ".om" and ".co" are real
// countries, so they're not here).
const ENDING_FIXES: ReadonlyArray<[RegExp, string]> = [
  [/\.couk$/, ".co.uk"],
  [/\.co\.uk\.$/, ".co.uk"],
  [/\.uk\.co$/, ".co.uk"],
  [/\.co\.k$/, ".co.uk"],
  [/\.co\.ukk$/, ".co.uk"],
  [/\.con$/, ".com"],
  [/\.cmo$/, ".com"],
  [/\.ocm$/, ".com"],
  [/\.comm$/, ".com"],
  [/\.coom$/, ".com"],
  [/\.c0m$/, ".com"],
  [/\.cpm$/, ".com"],
  [/\.vom$/, ".com"],
  [/\.xom$/, ".com"],
  [/\.nett$/, ".net"],
  [/\.ent$/, ".net"],
];

/** Optimal string alignment distance (Levenshtein plus adjacent swaps). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * The address the person probably meant, or null. Never applied
 * automatically - the form asks "Did you mean …?" and the person decides.
 */
export function suggestEmailCorrection(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain || (KNOWN_EMAIL_DOMAINS as readonly string[]).includes(domain)) return null;

  let fixed = domain;
  for (const [pattern, replacement] of ENDING_FIXES) {
    if (pattern.test(fixed)) {
      fixed = fixed.replace(pattern, replacement);
      break;
    }
  }
  if ((KNOWN_EMAIL_DOMAINS as readonly string[]).includes(fixed)) return `${local}@${fixed}`;

  let best: { domain: string; distance: number } | null = null;
  for (const known of KNOWN_EMAIL_DOMAINS) {
    const distance = editDistance(fixed, known);
    // Longer names tolerate more slips; very short ones (me.com, aol.com)
    // none, so real short domains like "mo.com" aren't second-guessed.
    const allowed = known.length >= 11 ? 2 : known.length >= 8 ? 1 : 0;
    if (distance > 0 && distance <= allowed && (!best || distance < best.distance)) best = { domain: known, distance };
  }
  if (best) return `${local}@${best.domain}`;
  return fixed !== domain ? `${local}@${fixed}` : null;
}
