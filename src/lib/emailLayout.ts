import { SUPPORT_EMAIL } from "@/lib/seo";

/**
 * FYStay's one email design, shared by every message in notificationEmails.ts
 * so a guest or host gets the same look as the site: the wordmark, a cream
 * page, one white card, a short heading, a details table, and a single
 * clear button. Table-based with inline styles - the only layout email
 * clients render reliably - and no images, so nothing breaks when images
 * are blocked.
 *
 * Every message answers the same three questions: what happened (heading
 * and intro), what you need to do (the button, if anything), and what
 * happens next (the paragraphs). Callers pass already-escaped HTML; plain
 * values in `details` are escaped here.
 */

const COLORS = {
  page: "#f7f3ef",
  card: "#ffffff",
  border: "#ece4dd",
  ink: "#301a13",
  text: "#4a3b34",
  muted: "#7c6c64",
  brand: "#bc522f",
  button: "#954328",
} as const;

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailDetail = { label: string; value: string };

export type EmailContent = {
  /** The inbox preview line after the subject. Plain text. */
  preheader: string;
  /** What happened, in a few words. Plain text. */
  heading: string;
  /** The first paragraph - already-escaped HTML. */
  intro: string;
  /** A label/value table, e.g. dates and reference. Plain text, escaped here. */
  details?: EmailDetail[];
  /** Further paragraphs (what happens next) - already-escaped HTML each. */
  paragraphs?: string[];
  cta?: { label: string; url: string };
  /** Who the email is for, for the footer. */
  audience?: "guest" | "host" | "partner";
};

export function renderEmail(content: EmailContent): string {
  const { preheader, heading, intro, details = [], paragraphs = [], cta, audience = "guest" } = content;
  const paragraph = (html: string) =>
    `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.6;color:${COLORS.text};">${html}</p>`;

  const detailRows = details
    .map(
      ({ label, value }) => `
        <tr>
          <td style="padding:8px 0;border-top:1px solid ${COLORS.border};font-family:${SANS};font-size:14px;color:${COLORS.muted};">${escapeHtml(label)}</td>
          <td align="right" style="padding:8px 0;border-top:1px solid ${COLORS.border};font-family:${SANS};font-size:14px;font-weight:600;color:${COLORS.ink};">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");

  const button = cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px;">
        <tr>
          <td style="border-radius:12px;background:${COLORS.button};">
            <a href="${cta.url}" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(cta.label)}</a>
          </td>
        </tr>
      </table>`
    : "";

  const footerLine =
    audience === "host"
      ? "You're receiving this because you host on FYStay."
      : audience === "partner"
        ? "You're receiving this as a FYStay service partner."
        : "You're receiving this because you booked on FYStay.";

  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${COLORS.page};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.page};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
            <tr>
              <td style="padding:0 4px 20px;font-family:${SERIF};font-size:26px;font-weight:700;letter-spacing:-0.5px;">
                <span style="color:${COLORS.brand};">FY</span><span style="color:${COLORS.ink};">Stay</span>
              </td>
            </tr>
            <tr>
              <td style="background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px;padding:28px 28px 20px;">
                <h1 style="margin:0 0 14px;font-family:${SERIF};font-size:24px;line-height:1.25;font-weight:700;color:${COLORS.ink};">${escapeHtml(heading)}</h1>
                ${paragraph(intro)}
                ${
                  detailRows
                    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border-bottom:1px solid ${COLORS.border};">${detailRows}</table>`
                    : ""
                }
                ${paragraphs.map(paragraph).join("")}
                ${button}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 4px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${COLORS.muted};">
                Questions? Write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${COLORS.button};">${SUPPORT_EMAIL}</a>.<br>
                ${footerLine} Local stays on the Fylde Coast.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
