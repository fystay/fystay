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

  it("uses no stand-in logo or photo for a provider that hasn't supplied its own", () => {
    const service = partnerServiceForOffering(evExec, "/x");
    expect(service.logoSrc).toBeUndefined();
    expect(service.image).toBeUndefined();
  });
});
