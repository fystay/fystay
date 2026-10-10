import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Cancellation policies",
  description: "The Flexible, Moderate, Strict and Non-refundable cancellation policies FYStay hosts can choose from.",
  path: "/cancellation-policies",
});

const POLICIES = [
  {
    label: "Flexible",
    tiers: [
      "Full refund if you cancel at least 1 day before check-in",
      "No refund after that",
    ],
  },
  {
    label: "Moderate",
    tiers: [
      "Full refund if you cancel at least 5 days before check-in",
      "50% refund if you cancel between 1 and 5 days before check-in",
      "No refund after that",
    ],
  },
  {
    label: "Strict",
    tiers: [
      "50% refund if you cancel at least 7 days before check-in",
      "No refund after that",
    ],
  },
  {
    label: "Non-refundable",
    tiers: [
      "Full refund if you cancel within 24 hours of paying, as long as that's before your check-in date",
      "No refund after that",
    ],
  },
  {
    label: "Custom",
    tiers: [
      "Set by the host - a chosen refund percentage if you cancel by a chosen number of days before check-in",
      "The exact terms are always shown on the listing page before you book",
    ],
  },
];

export default function CancellationPoliciesPage() {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Cancellation policies</h1>
      <p className="mt-2 text-sm text-stone-500">
        Every host picks one of these policies for their listing. You&apos;ll always see which one
        applies, in plain language, before you book - and again if you ever preview a
        cancellation.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        {POLICIES.map((policy) => (
          <Card key={policy.label}>
            <CardHeader className="pb-0">
              <CardTitle>{policy.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-600">
                {policy.tiers.map((tier) => (
                  <li key={tier}>{tier}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="mt-8 text-sm text-stone-500">
        Refunds are calculated automatically and shown to you before you confirm a cancellation,
        based on the exact policy on your booking and how many days remain before check-in (or,
        for Non-refundable, how long ago you paid).
      </p>
    </div>
  );
}
