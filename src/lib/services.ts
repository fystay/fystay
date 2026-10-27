import { Car, Compass, Home, LifeBuoy, type LucideIcon } from "lucide-react";

export type FyStayService = {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  cta: string;
  /** Brand-gradient art where a service has no photo (the homepage's Services banner). */
  gradient: string;
};

// Only services that already exist in the app, each linking to its real
// page. Shared by the /services hub and the homepage's Services banner; new
// services (see src/lib/siteSections.ts) get added here as they launch.
export const FYSTAY_SERVICES: FyStayService[] = [
  {
    icon: Car,
    title: "Airport transfers",
    description: "Add a transfer to a confirmed FYStay booking and pay for it with your stay.",
    href: "/travel-extras",
    cta: "See transfers",
    gradient: "from-brand-600 via-brand-800 to-ink",
  },
  {
    icon: Compass,
    title: "Local Guides",
    description: "Where locals eat, what's on and the weather, town by town.",
    href: "/destinations",
    cta: "Explore the towns",
    gradient: "from-brand-500 via-brand-800 to-ink",
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
    description: "Answers before and during your stay, and a direct line to the FYStay team.",
    href: "/help",
    cta: "Go to the help centre",
    gradient: "from-brand-500 via-brand-700 to-brand-950",
  },
];
