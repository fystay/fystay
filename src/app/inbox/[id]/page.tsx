import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isConversationParticipant, otherParticipant } from "@/lib/messaging";
import { MessageComposer } from "@/components/MessageComposer";
import { RefreshOnMount } from "@/components/RefreshOnMount";
import { cn } from "@/lib/cn";

// When each message was sent, in UK time (where every stay and host is).
const messageTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // Only a participant's own conversation gets the names in its title: this
  // runs before the page's participant check.
  const session = await auth();
  const conversation = session?.user
    ? await prisma.conversation.findFirst({
        where: { id, OR: [{ guestId: session.user.id }, { hostId: session.user.id }] },
        include: { guest: { select: { name: true } }, host: { select: { name: true } } },
      })
    : null;
  return {
    title: conversation ? `${conversation.guest.name} & ${conversation.host.name}` : "Conversation",
    robots: { index: false },
  };
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=/inbox/${id}`);

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      listing: { select: { id: true, title: true } },
      guest: { select: { id: true, name: true } },
      host: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, createdAt: true, senderId: true },
      },
    },
  });
  if (!conversation) notFound();
  if (!isConversationParticipant(conversation, session.user.id)) redirect("/inbox");

  // Opening the thread is the only "mark as read" action in this app - the
  // same way opening an email marks it read, with no separate button for it.
  await prisma.message.updateMany({
    where: { conversationId: id, senderId: { not: session.user.id }, readAt: null },
    data: { readAt: new Date() },
  });

  const counterparty = otherParticipant(conversation, session.user.id);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-8">
      <RefreshOnMount />
      <Link
        href="/inbox"
        className="focus-ring -ml-1 inline-flex items-center gap-1 self-start rounded-lg py-1 pr-2 text-sm font-medium text-stone-600 hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to messages
      </Link>

      <div className="mt-3">
        <h1 className="text-xl font-bold text-foreground">{counterparty.name}</h1>
        <Link
          href={`/listings/${conversation.listing.id}`}
          className="text-sm text-stone-500 hover:text-brand-700 hover:underline"
        >
          {conversation.listing.title}
        </Link>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3">
        {conversation.messages.map((message) => {
          const fromMe = message.senderId === session.user.id;
          return (
            <li key={message.id} className={cn("flex flex-col", fromMe ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-line",
                  fromMe
                    ? "bg-brand-700 text-white"
                    : "border border-border-subtle bg-surface text-foreground",
                )}
              >
                {message.body}
              </div>
              <time dateTime={message.createdAt.toISOString()} className="mt-1 px-1 text-xs text-stone-500">
                {messageTime.format(message.createdAt)}
              </time>
            </li>
          );
        })}
      </ul>

      <div className="mt-6">
        <MessageComposer conversationId={conversation.id} />
      </div>
    </div>
  );
}
