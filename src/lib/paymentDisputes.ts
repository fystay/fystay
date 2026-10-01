/**
 * Pure mapping from Stripe's own dispute.status string to this app's
 * DisputeStatus enum - kept separate from the webhook route so the
 * mapping itself is directly unit-testable (the same reason
 * connectFlagsFromV2Account in stripeConnect.ts exists as its own function).
 */
export type MappedDisputeStatus =
  | "WARNING_NEEDS_RESPONSE"
  | "WARNING_UNDER_REVIEW"
  | "WARNING_CLOSED"
  | "NEEDS_RESPONSE"
  | "UNDER_REVIEW"
  | "WON"
  | "LOST"
  | "PREVENTED";

const STATUS_MAP: Record<string, MappedDisputeStatus> = {
  warning_needs_response: "WARNING_NEEDS_RESPONSE",
  warning_under_review: "WARNING_UNDER_REVIEW",
  warning_closed: "WARNING_CLOSED",
  needs_response: "NEEDS_RESPONSE",
  under_review: "UNDER_REVIEW",
  won: "WON",
  lost: "LOST",
  prevented: "PREVENTED",
};

/**
 * Falls back to NEEDS_RESPONSE (the safest "someone should look at this"
 * state) for a status Stripe sends that this app doesn't recognize, rather
 * than throwing and dropping the webhook event - a new Stripe status value
 * showing up should still create a visible, actionable dispute record.
 */
export function mapStripeDisputeStatus(stripeStatus: string): MappedDisputeStatus {
  return STATUS_MAP[stripeStatus] ?? "NEEDS_RESPONSE";
}

/**
 * Stripe reports the evidence deadline as a Unix timestamp, or null/0 when
 * there's no response window for this particular dispute (see the Stripe
 * API's own doc comment on evidence_details.due_by) - both are "no
 * deadline", not "epoch, i.e. 1970".
 */
export function evidenceDueByDate(dueBy: number | null | undefined): Date | null {
  if (!dueBy) return null;
  return new Date(dueBy * 1000);
}

/**
 * Whether a dispute still needs a human response before its evidence
 * deadline - used by the admin dashboard to surface urgency. A dispute
 * with no deadline (evidenceDueBy null) is never "urgent" by this
 * definition, since there's nothing to miss.
 */
export function isDisputeActionable(status: MappedDisputeStatus, evidenceDueBy: Date | null): boolean {
  const respondableStatuses: MappedDisputeStatus[] = [
    "WARNING_NEEDS_RESPONSE",
    "NEEDS_RESPONSE",
  ];
  return respondableStatuses.includes(status) && evidenceDueBy !== null;
}
