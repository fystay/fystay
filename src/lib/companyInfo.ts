/**
 * The trading entity's legal identity - name, company number (if
 * incorporated), and registered/business address. UK law (Companies Act
 * 2006 for a limited company; the Ecommerce Regulations 2002 for any
 * trader) requires this to be disclosed on a site taking real bookings and
 * payments, and this codebase has no way to know it on its own.
 *
 * Name and address are required together. A limited company (or any
 * record with a company number) also needs its number and where it's
 * registered; a sole trader or partnership has neither.
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

import type { EnvSource } from "@/lib/deploymentEnvironment";

export type CompanyInfo = {
  legalName: string;
  /** Only a limited company or LLP has one - a sole trader or partnership leaves it unset. */
  companyNumber: string | null;
  /** Where a company is registered ("England and Wales", "Scotland"); set together with the number. */
  registeredIn: string | null;
  registeredAddress: string;
};

/**
 * A name ending "Limited", "Ltd", "LLP" or "PLC" is a registered company,
 * which must also disclose its number and where it's registered (Company,
 * LLP and Business (Names and Trading Disclosures) Regulations 2015).
 */
const INCORPORATED_NAME = /\b(limited|ltd\.?|llp|plc)$/i;

function companyFrom(fields: {
  legalName?: string;
  companyNumber?: string;
  registeredIn?: string;
  registeredAddress?: string;
}): CompanyInfo | null {
  const legalName = fields.legalName?.trim();
  const companyNumber = fields.companyNumber?.trim() || null;
  const registeredIn = fields.registeredIn?.trim() || null;
  const registeredAddress = fields.registeredAddress?.trim();

  if (!legalName || !registeredAddress) return null;
  if ((INCORPORATED_NAME.test(legalName) || companyNumber) && (!companyNumber || !registeredIn)) return null;
  return { legalName, companyNumber, registeredIn, registeredAddress };
}

export function getCompanyInfo(): CompanyInfo | null {
  // process.env.NEXT_PUBLIC_* read directly so Next can inline them.
  return companyFrom({
    legalName: process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME,
    companyNumber: process.env.NEXT_PUBLIC_COMPANY_NUMBER,
    registeredIn: process.env.NEXT_PUBLIC_COMPANY_REGISTERED_IN,
    registeredAddress: process.env.NEXT_PUBLIC_COMPANY_ADDRESS,
  });
}

/**
 * "Example Limited, trading as FYStay, a company registered in England and
 * Wales (company number 123), registered office at ..." or, with no company
 * number, "Jane Smith, trading as FYStay, of ...".
 */
export function describeOperator(company: CompanyInfo): string {
  const name = /\bFYStay\b/i.test(company.legalName) ? company.legalName : `${company.legalName}, trading as FYStay`;
  return company.companyNumber
    ? `${name}, a company registered in ${company.registeredIn} (company number ${company.companyNumber}), registered office at ${company.registeredAddress}`
    : `${name}, of ${company.registeredAddress}`;
}

/**
 * Whether the trader's identity is complete - the same rule getCompanyInfo()
 * applies - for server-side checks that take an env (readiness, the
 * live-payment gate in src/lib/stripe.ts).
 */
export function hasTraderIdentity(env: EnvSource = process.env): boolean {
  return (
    companyFrom({
      legalName: env.NEXT_PUBLIC_COMPANY_LEGAL_NAME,
      companyNumber: env.NEXT_PUBLIC_COMPANY_NUMBER,
      registeredIn: env.NEXT_PUBLIC_COMPANY_REGISTERED_IN,
      registeredAddress: env.NEXT_PUBLIC_COMPANY_ADDRESS,
    }) !== null
  );
}
