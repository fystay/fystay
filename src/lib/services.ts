import { Car, Home, LifeBuoy, type LucideIcon } from "lucide-react";

export type FyStayService = {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  cta: string;
  /** Brand-gradient art for the homepage's large Services card (no real photography yet). */
  gradient: string;
};

// Only services that already exist in the app, each linking to its real
// page. Shared by the /services hub and the homepage's Services rail; new
// services (see src/lib/siteSections.ts) get added here as they launch.
export const FYSTAY_SERVICES: FyStayService[] = [
  {
    icon: Car,
    title: "Trip extras",
    description: "Add extras such as transport to a confirmed FYStay booking.",
    href: "/travel-extras",
    cta: "See trip extras",
    gradient: "from-brand-600 via-brand-800 to-ink",
  },
  {
    icon: Home,
    title: "Hosting",
    description: "List your property and manage bookings, calendars and payouts from one dashboard.",
    href: "/host-guide",
    cta: "Read the host guide",
    gradient: "from-amber-700 via-brand-800 to-ink",
  },
  {
    icon: LifeBuoy,
    title: "Help & support",
    description: "Answers to common questions, and a way to contact the FYStay team.",
    href: "/help",
    cta: "Go to the help centre",
    gradient: "from-brand-500 via-brand-700 to-brand-950",
  },
];
