import { afterEach, describe, expect, it } from "vitest";
import { describeOperator, getCompanyInfo, hasTraderIdentity } from "./companyInfo";

const KEYS = [
  "NEXT_PUBLIC_COMPANY_LEGAL_NAME",
  "NEXT_PUBLIC_COMPANY_NUMBER",
  "NEXT_PUBLIC_COMPANY_REGISTERED_IN",
  "NEXT_PUBLIC_COMPANY_ADDRESS",
] as const;

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
    process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME = "Jane Smith";
    process.env.NEXT_PUBLIC_COMPANY_ADDRESS = "1 Example Street, Blackpool, FY1 1AA";
    const company = getCompanyInfo()!;
    expect(company.companyNumber).toBeNull();
    expect(describeOperator(company)).toBe("Jane Smith, trading as FYStay, of 1 Example Street, Blackpool, FY1 1AA");
  });

  it("returns null for a limited company without its number and place of registration", () => {
    process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME = "Example Limited";
    process.env.NEXT_PUBLIC_COMPANY_ADDRESS = "1 Example Street, Blackpool, FY1 1AA";
    expect(getCompanyInfo()).toBeNull();
    process.env.NEXT_PUBLIC_COMPANY_NUMBER = "12345678";
    expect(getCompanyInfo()).toBeNull();
  });

  it("returns the full record once every field is set", () => {
    process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME = "Example Limited";
    process.env.NEXT_PUBLIC_COMPANY_NUMBER = "12345678";
    process.env.NEXT_PUBLIC_COMPANY_REGISTERED_IN = "England and Wales";
    process.env.NEXT_PUBLIC_COMPANY_ADDRESS = "1 Example Street, Blackpool, FY1 1AA";
    expect(getCompanyInfo()).toEqual({
      legalName: "Example Limited",
      companyNumber: "12345678",
      registeredIn: "England and Wales",
      registeredAddress: "1 Example Street, Blackpool, FY1 1AA",
    });
    expect(describeOperator(getCompanyInfo()!)).toBe(
      "Example Limited, trading as FYStay, a company registered in England and Wales (company number 12345678), registered office at 1 Example Street, Blackpool, FY1 1AA",
    );
  });

  it("doesn't repeat the trading name when the company is called FYStay", () => {
    process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME = "FYStay Limited";
    process.env.NEXT_PUBLIC_COMPANY_NUMBER = "12345678";
    process.env.NEXT_PUBLIC_COMPANY_REGISTERED_IN = "England and Wales";
    process.env.NEXT_PUBLIC_COMPANY_ADDRESS = "1 Example Street, Blackpool, FY1 1AA";
    expect(describeOperator(getCompanyInfo()!)).toMatch(/^FYStay Limited, a company registered in England and Wales/);
  });
});

describe("hasTraderIdentity", () => {
  const name = "Jane Smith";
  const address = "1 Example Street, Blackpool, FY1 1AA";

  it("needs both the legal name and the address, blank counting as missing", () => {
    expect(hasTraderIdentity({ NEXT_PUBLIC_COMPANY_LEGAL_NAME: name, NEXT_PUBLIC_COMPANY_ADDRESS: address })).toBe(true);
    expect(hasTraderIdentity({ NEXT_PUBLIC_COMPANY_ADDRESS: address })).toBe(false);
    expect(hasTraderIdentity({ NEXT_PUBLIC_COMPANY_LEGAL_NAME: name })).toBe(false);
    expect(hasTraderIdentity({ NEXT_PUBLIC_COMPANY_LEGAL_NAME: " ", NEXT_PUBLIC_COMPANY_ADDRESS: address })).toBe(false);
  });

  it("needs a limited company's number and place of registration", () => {
    const company = { NEXT_PUBLIC_COMPANY_LEGAL_NAME: "Example Ltd", NEXT_PUBLIC_COMPANY_ADDRESS: address };
    expect(hasTraderIdentity(company)).toBe(false);
    expect(hasTraderIdentity({ ...company, NEXT_PUBLIC_COMPANY_NUMBER: "12345678", NEXT_PUBLIC_COMPANY_REGISTERED_IN: "England and Wales" })).toBe(true);
  });

  it("doesn't need a company number, which a sole trader doesn't have", () => {
    expect(hasTraderIdentity({ NEXT_PUBLIC_COMPANY_LEGAL_NAME: name, NEXT_PUBLIC_COMPANY_ADDRESS: address, NEXT_PUBLIC_COMPANY_NUMBER: "" })).toBe(true);
  });
});
