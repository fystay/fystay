import { HostNavIfHost } from "@/components/host/HostNavIfHost";

// Every hosting page (not the public /host page) shares the hosting menu.
// Each page still checks sign-in and role itself - this layout only adds
// the menu when the visitor is a host.
export default function HostManageLayout({ children }: LayoutProps<"/host">) {
  return (
    <>
      <HostNavIfHost />
      {children}
    </>
  );
}
