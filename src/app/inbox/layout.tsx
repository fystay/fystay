import { HostNavIfHost } from "@/components/host/HostNavIfHost";

// Hosts reach Messages from the hosting menu; keep it on screen for them.
export default function InboxLayout({ children }: LayoutProps<"/inbox">) {
  return (
    <>
      <HostNavIfHost />
      {children}
    </>
  );
}
