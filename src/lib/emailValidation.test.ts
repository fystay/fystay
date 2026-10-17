import { describe, expect, it } from "vitest";
import { emailFormatError, suggestEmailCorrection } from "./emailValidation";

describe("emailFormatError", () => {
  it.each([
    "name@example.com",
    "first.last+tag@sub.example.co.uk",
    "o'brien@example.ie",
    "hello@fystay.co.uk",
    "someone@xn--bcher-kva.example",
    "  padded@example.com  ",
  ])("accepts %s", (email) => {
    expect(emailFormatError(email)).toBeNull();
  });

  it.each([
    "",
    "plainaddress",
    "@example.com",
    "name@",
    "name@@example.com",
    "name@example",
    "name@example.c",
    "name@example.123",
    "name@-example.com",
    "name@example-.com",
    "name@exa_mple.com",
    "name@example..com",
    ".name@example.com",
    "na..me@example.com",
    "name @example.com",
    `${"a".repeat(65)}@example.com`,
  ])("rejects %s", (email) => {
    expect(emailFormatError(email)).not.toBeNull();
  });
});

describe("suggestEmailCorrection", () => {
  it.each([
    ["hello@fystay.couk", "hello@fystay.co.uk"],
    ["hello@fystay.co.uk.", "hello@fystay.co.uk"],
    ["hello@fysty.co.uk", "hello@fystay.co.uk"],
    ["sam@gmial.com", "sam@gmail.com"],
    ["sam@gmai.com", "sam@gmail.com"],
    ["sam@gmail.con", "sam@gmail.com"],
    ["sam@gmail.co", "sam@gmail.com"],
    ["sam@hotmial.co.uk", "sam@hotmail.co.uk"],
    ["sam@hotmail.couk", "sam@hotmail.co.uk"],
    ["sam@outlok.com", "sam@outlook.com"],
    ["sam@yahooo.co.uk", "sam@yahoo.co.uk"],
    ["sam@icloud.cmo", "sam@icloud.com"],
    ["sam@btinternet.co", "sam@btinternet.com"],
    ["Sam@GMIAL.com", "sam@gmail.com"],
    ["sam@example.couk", "sam@example.co.uk"],
  ])("suggests %s → %s", (typed, expected) => {
    expect(suggestEmailCorrection(typed)).toBe(expected);
  });

  it.each([
    "hello@fystay.co.uk",
    "sam@gmail.com",
    "sam@my-company.co.uk",
    "sam@smallbusiness.org",
    "sam@uni.ac.uk",
    "sam@mo.com",
    "sam@example.cm",
    "sam@lancashire.gov.uk",
    "sam@proton.me",
  ])("leaves %s alone", (email) => {
    expect(suggestEmailCorrection(email)).toBeNull();
  });
});
