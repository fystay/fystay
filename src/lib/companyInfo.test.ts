import { afterEach, describe, expect, it } from "vitest";
import { describeOperator, getCompanyInfo } from "./companyInfo";

const KEYS = ["NEXT_PUBLIC_COMPANY_LEGAL_NAME", "NEXT_PUBLIC_COMPANY_NUMBER", "NEXT_PUBLIC_COMPANY_ADDRESS"] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("getCompanyInfo", () => {
  it("returns null when nothing is configured", () => {
    expect(getCompanyInfo()).toBeNull();
  });

  it("returns null without both a name and an address", () => {
    process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME = "FYStay Ltd";
    process.env.NEXT_PUBLIC_COMPANY_NUMBER = "12345678";
    expect(getCompanyInfo()).toBeNull();
  });

  it("supports a sole trader or partnership with no company number", () => {
    process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME = "Jane Smith trading as FYStay";
    process.env.NEXT_PUBLIC_COMPANY_ADDRESS = "1 Example Street, Blackpool, FY1 1AA";
    const company = getCompanyInfo()!;
    expect(company.companyNumber).toBeNull();
    expect(describeOperator(company)).toBe("Jane Smith trading as FYStay, of 1 Example Street, Blackpool, FY1 1AA");
  });

  it("returns the full record once every field is set", () => {
    process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME = "FYStay Ltd";
    process.env.NEXT_PUBLIC_COMPANY_NUMBER = "12345678";
    process.env.NEXT_PUBLIC_COMPANY_ADDRESS = "1 Example Street, Blackpool, FY1 1AA";
    expect(getCompanyInfo()).toEqual({
      legalName: "FYStay Ltd",
      companyNumber: "12345678",
      registeredAddress: "1 Example Street, Blackpool, FY1 1AA",
    });
    expect(describeOperator(getCompanyInfo()!)).toBe(
      "FYStay Ltd (company number 12345678), registered office at 1 Example Street, Blackpool, FY1 1AA",
    );
  });
});
