import { describe, expect, it } from "vitest";
import { oauthErrorMessage } from "./authErrors";

describe("oauthErrorMessage", () => {
  it("says which provider was cancelled", () => {
    expect(oauthErrorMessage("OAuthCallbackError", "google")).toBe("Google sign-in was cancelled. Please try again.");
    expect(oauthErrorMessage("OAuthCallbackError", "apple")).toBe("Apple sign-in was cancelled. Please try again.");
  });

  it("explains what to do when a password account already uses the email", () => {
    expect(oauthErrorMessage("AccountExists", "google")).toMatch(/Log in with your email and password.*connect Google/);
  });

  it("falls back to a generic line for anything else, never the raw code", () => {
    expect(oauthErrorMessage("Configuration", "apple")).toBe("We couldn't sign you in with Apple. Please try again.");
    expect(oauthErrorMessage("SomethingInternal: stack", null)).toBe("We couldn't sign you in. Please try again.");
  });

  it("reads cleanly without a provider", () => {
    expect(oauthErrorMessage("AlreadyLinked", null)).toBe(
      "That account is already connected to a different FYStay account.",
    );
    expect(oauthErrorMessage("EmailUnverified", "google")).toBe(
      "Your Google email address isn't verified yet. Verify it with Google and try again, or sign up with email instead.",
    );
  });

  it("stays quiet when there's no error, or a password error the form shows itself", () => {
    expect(oauthErrorMessage(null, "google")).toBeNull();
    expect(oauthErrorMessage("CredentialsSignin", null)).toBeNull();
  });
});
