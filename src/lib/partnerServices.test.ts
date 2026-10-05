import { describe, expect, it } from "vitest";
import { PARTNER_LABEL, partnerServiceForOffering } from "./partnerServices";
import type { TravelAddonOffering } from "./travelAddons";

const evExec: TravelAddonOffering = {
  id: "offering_1",
  name: "Return airport transfer",
  description: "Door-to-door executive transfer.",
  category: "AIRPORT_TRANSFER",
  priceCents: 4500,
  features: ["Tesla / fully electric"],
  providerName: "EV Exec",
};

describe("partnerServiceForOffering", () => {
  it("presents the provider as an independent partner, booked with them through FYStay's flow", () => {
    const service = partnerServiceForOffering(evExec, "/travel-extras?category=AIRPORT_TRANSFER");
    expect(service).toMatchObject({
      provider: "EV Exec",
      category: "Airport transfers",
      title: "Premium electric airport transfers",
      description: "Travel door-to-door in a Tesla, with your journey arranged around your FYStay.",
      providerLabel: PARTNER_LABEL,
      cta: "Book with EV Exec",
      href: "/travel-extras?category=AIRPORT_TRANSFER",
    });
    expect(PARTNER_LABEL).toBe("FYStay service partner");
  });

  it("names whichever provider the offering belongs to, never a hard-coded one", () => {
    const service = partnerServiceForOffering({ ...evExec, providerName: "Coastline Cars" }, "/x");
    expect(service.provider).toBe("Coastline Cars");
    expect(service.cta).toBe("Book with Coastline Cars");
  });

  it("uses a provider's own logo and photo when it has supplied them, and no stand-in otherwise", () => {
    const service = partnerServiceForOffering(evExec, "/x");
    expect(service.logoSrc).toBe("/images/partners/ev-exec/logo.jpg");
    expect(service.image?.src).toBe("/images/partners/ev-exec/model-y-airport.jpg");

    const other = partnerServiceForOffering({ ...evExec, providerName: "Coastline Cars" }, "/x");
    expect(other.logoSrc).toBeUndefined();
    expect(other.image).toBeUndefined();
  });
});
