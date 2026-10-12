import type { ListingReviewEventType, Role } from "@prisma/client";
import { formatDateTime } from "@/lib/format";

const EVENT_LABEL: Record<ListingReviewEventType, string> = {
  PREPARED: "Draft started by FYStay",
  INVITATION_SENT: "Invitation sent to the owner",
  HOST_ACCESS_GRANTED: "Owner accepted the invitation and got access",
  SENT_FOR_REVIEW: "Sent to the host for review",
  CHANGES_REQUESTED: "Host asked for changes",
  APPROVED: "Host approved",
  APPROVAL_INVALIDATED: "Approval reset after FYStay changed the listing",
  PUBLISHED: "Published - live for guests",
  UNPUBLISHED: "Hidden from guests",
};

type Event = {
  id: string;
  type: ListingReviewEventType;
  revision: number;
  note: string | null;
  createdAt: Date;
  actorRole: Role | null;
  actor: { name: string } | null;
};

/** The review audit trail, newest first: who did what, to which revision. */
export function ReviewTimeline({ events }: { events: Event[] }) {
  if (events.length === 0) return <p className="mt-3 text-sm text-stone-600">Nothing yet.</p>;
  return (
    <ol className="mt-3 flex flex-col gap-3 border-l border-border-subtle pl-4">
      {events.map((event) => (
        <li key={event.id} className="text-sm">
          <p className="font-medium text-foreground">
            {EVENT_LABEL[event.type]} <span className="font-normal text-stone-500">· revision {event.revision}</span>
          </p>
          <p className="text-xs text-stone-500">
            {formatDateTime(event.createdAt)}
            {event.actor ? ` · ${event.actor.name}${event.actorRole === "ADMIN" ? " (FYStay)" : ""}` : ""}
          </p>
          {event.note && <p className="mt-1 whitespace-pre-line text-stone-700">{event.note}</p>}
        </li>
      ))}
    </ol>
  );
}
