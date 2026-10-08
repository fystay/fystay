import { HostNavIfHost } from "@/components/host/HostNavIfHost";

// Hosts reach Account from the hosting menu; keep it on screen for them.
export default function AccountLayout({ children }: LayoutProps<"/account">) {
  return (
    <>
      <HostNavIfHost />
      {children}
    </>
  );
}
