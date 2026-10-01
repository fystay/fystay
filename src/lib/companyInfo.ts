/**
 * The trading entity's legal identity - name, company number (if
 * incorporated), and registered/business address. UK law (Companies Act
 * 2006 for a limited company; the Ecommerce Regulations 2002 for any
 * trader) requires this to be disclosed on a site taking real bookings and
 * payments, and this codebase has no way to know it on its own.
 *
 * Name and address are required together; the company number is optional,
 * since a sole trader or partnership has none.
 *
 * Deliberately env-driven rather than a hardcoded
 * placeholder: this app deploys straight to production on every push (see
 * README), so a literal "[FILL IN YOUR COMPANY NUMBER]" string would be
 * live in front of real guests the moment this shipped. Until every field
 * is set, getCompanyInfo() returns null and callers render nothing - the
 * same "don't show a guest a broken placeholder, degrade to absent
 * instead" pattern this codebase already uses for Stripe/Resend/Supabase
 * being unconfigured.
 */

export type CompanyInfo = {
  legalName: string;
  /** Only a limited company or LLP has one - a sole trader or partnership leaves it unset. */
  companyNumber: string | null;
  registeredAddress: string;
};

export function getCompanyInfo(): CompanyInfo | null {
  const legalName = process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME?.trim();
  const companyNumber = process.env.NEXT_PUBLIC_COMPANY_NUMBER?.trim() || null;
  const registeredAddress = process.env.NEXT_PUBLIC_COMPANY_ADDRESS?.trim();

  if (!legalName || !registeredAddress) return null;
  return { legalName, companyNumber, registeredAddress };
}

/** "Example Ltd (company number 123), registered office at ..." or, with no company number, "Jane Smith, of ...". */
export function describeOperator(company: CompanyInfo): string {
  return company.companyNumber
    ? `${company.legalName} (company number ${company.companyNumber}), registered office at ${company.registeredAddress}`
    : `${company.legalName}, of ${company.registeredAddress}`;
}
