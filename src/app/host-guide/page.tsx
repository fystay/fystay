import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Host guide",
  description: "How to list and manage a holiday let on FYStay, the local accommodation marketplace for the Fylde Coast and Lancashire.",
  path: "/host-guide",
});

const STEPS = [
  {
    title: "1. Create a listing",
    description:
      "From your host dashboard, add your property's title, description, city, address, and property type, plus your nightly price, cleaning fee, and how many guests/bedrooms/beds/bathrooms it has.",
  },
  {
    title: "2. Add photos and amenities",
    description:
      "Upload real photos of your property and tick the amenities that genuinely apply (Wifi, parking, kitchen, pet-friendly, and more). Accurate listings get fewer cancellations and better reviews.",
  },
  {
    title: "3. Choose a cancellation policy",
    description:
      "Pick Flexible, Moderate, Strict, Non-refundable (a full refund only within 24 hours of paying), or set your own Custom refund percentage and cutoff. This is shown to guests before they book, and drives every refund calculation automatically.",
  },
  {
    title: "4. Publish and manage availability",
    description:
      "Publish your listing to make it bookable, and block off any dates it isn't available (maintenance, personal use) from its calendar.",
  },
  {
    title: "5. Manage bookings",
    description:
      "Confirmed bookings, date-change requests, and cancellations all appear on your host dashboard. Respond to date-change requests and reviews from there too.",
  },
  {
    title: "6. Meet your legal and safety responsibilities",
    description:
      "As the host, you're responsible for your property meeting UK safety law, not FYStay: a valid gas safety (CP12) certificate if it has any gas appliances, working smoke alarms on every floor and a carbon monoxide alarm in any room with a solid fuel appliance, an up-to-date Energy Performance Certificate, and furniture that meets fire safety regulations. Public liability insurance covering paying guests is strongly recommended - a standard home insurance policy usually doesn't cover this. Check current requirements with gov.uk and your local council before you publish your first listing.",
  },
];

export default function HostGuidePage() {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <Link href="/host" className="text-sm font-medium text-brand-700 hover:underline">
        ← Why host with FYStay
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-foreground sm:text-3xl">Host guide</h1>
      <p className="mt-2 text-sm text-stone-500">
        A quick walkthrough of listing your property and managing bookings on FYStay.
      </p>

      <div className="mt-8 flex flex-col gap-6">
        {STEPS.map((step) => (
          <div key={step.title}>
            <p className="text-sm font-semibold text-foreground">{step.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-stone-600">{step.description}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/host/listings/new" className={cn(buttonVariants())}>
          Create your first listing
        </Link>
        <Link href="/host/dashboard" className={cn(buttonVariants({ variant: "outline" }))}>
          Go to host dashboard
        </Link>
      </div>
    </div>
  );
}
