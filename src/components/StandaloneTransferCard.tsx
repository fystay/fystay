import { CarFront } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { formatDateTime, formatPrice } from "@/lib/format";

export type StandaloneTransfer = {
  id: string;
  offeringName: string;
  providerName: string;
  priceCents: number;
  status: string;
  fulfillmentStatus: string;
  travelAt: Date | null;
  guestNotes: string | null;
};

/** A transfer bought without a stay, in My trips. */
export function StandaloneTransferCard({ transfer }: { transfer: StandaloneTransfer }) {
  const refunded = transfer.status === "REFUNDED" || transfer.status === "CANCELLED";
  const handedOver = transfer.fulfillmentStatus === "SENT" || transfer.fulfillmentStatus === "CONFIRMED";
  const badge = refunded
    ? { label: "Refunded", variant: "neutral" as const }
    : transfer.fulfillmentStatus === "CONFIRMED"
      ? { label: `Confirmed by ${transfer.providerName}`, variant: "success" as const }
      : handedOver
        ? { label: `Sent to ${transfer.providerName}`, variant: "brand" as const }
        : { label: "Booking with provider", variant: "warning" as const };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <CarFront className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="font-semibold text-foreground">{transfer.offeringName}</p>
              <p className="text-sm text-stone-500">
                {transfer.travelAt ? `Pickup ${formatDateTime(transfer.travelAt)}` : "Pickup time to be confirmed"}
              </p>
            </div>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        {transfer.guestNotes && <p className="whitespace-pre-line text-sm text-stone-600">{transfer.guestNotes}</p>}
        <p className="text-sm text-stone-500">
          {formatPrice(transfer.priceCents)} · {transfer.providerName} will contact you to confirm the details. To
          change or cancel, contact FYStay support.
        </p>
      </CardContent>
    </Card>
  );
}
