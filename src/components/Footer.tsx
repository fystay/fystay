import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CurrencySelector } from "@/components/CurrencySelector";

const columns = [
  {
    heading: "Support",
    links: [
      { label: "Help centre", href: "/help" },
      { label: "Trust & Safety", href: "/safety" },
      { label: "Cancellation options", href: "/cancellation-policies" },
      { label: "Airport transfers", href: "/travel-extras" },
    ],
  },
  {
    heading: "Hosting",
    links: [
      { label: "Host your home", href: "/host" },
      { label: "Host dashboard", href: "/host/dashboard" },
      { label: "Hosting resources", href: "/host-guide" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact us", href: "/contact" },
    ],
  },
];

const legalLinks = [
  { label: "Terms and Conditions", href: "/legal/terms" },
  { label: "Privacy Policy", href: "/legal/privacy" },
  { label: "Cookie Policy", href: "/legal/cookies" },
];

export function Footer() {
  return (
    <footer className="border-t border-border-subtle bg-surface-muted">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 sm:grid-cols-4">
        <div className="col-span-2 flex flex-col gap-6 sm:col-span-1">
          <Logo size="md" withTagline />
          <CurrencySelector />
        </div>
        {columns.map((col) => (
          <div key={col.heading}>
            <p className="text-sm font-semibold text-foreground">{col.heading}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-stone-600 hover:text-brand-700 hover:underline"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border-subtle px-6 py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-stone-500">© {new Date().getFullYear()} FYStay</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {legalLinks.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  className="text-xs text-stone-500 hover:text-brand-700 hover:underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
