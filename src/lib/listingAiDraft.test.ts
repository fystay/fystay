import { describe, expect, it, vi } from "vitest";
import { draftListingWithAi, isListingAiDraftConfigured, ListingAiDraftError } from "./listingAiDraft";

function fakeClient(response: object) {
  const parse = vi.fn(async () => response);
  return { client: { beta: { messages: { parse } } } as never, parse };
}

const input = { notes: "Two-bed flat on the prom with sea views, wifi and parking.", city: "Blackpool", propertyType: "APARTMENT" };

describe("isListingAiDraftConfigured", () => {
  it("is on only with an API key", () => {
    expect(isListingAiDraftConfigured({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe(true);
    expect(isListingAiDraftConfigured({ ANTHROPIC_API_KEY: " " })).toBe(false);
    expect(isListingAiDraftConfigured({})).toBe(false);
  });
});

describe("draftListingWithAi", () => {
  it("keeps only amenities from FYStay's own checklist, spelled as listed, once each", async () => {
    const { client, parse } = fakeClient({
      stop_reason: "end_turn",
      parsed_output: {
        title: "  Sea-view flat on Blackpool prom  ",
        description: "A bright two-bedroom flat looking out to sea.",
        amenities: ["wifi", "Free parking", "Rooftop helipad", "WIFI"],
      },
    });
    const draft = await draftListingWithAi(input, client);
    expect(draft).toEqual({
      title: "Sea-view flat on Blackpool prom",
      description: "A bright two-bedroom flat looking out to sea.",
      amenities: ["Wifi", "Free parking"],
    });
    const params = (parse.mock.calls[0] as unknown[])[0] as { model: string; fallbacks: string; messages: { content: string }[] };
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.fallbacks).toBe("default");
    expect(params.messages[0].content).toContain("<owner_notes>");
  });

  it("explains a refusal or an unreadable draft instead of returning nothing", async () => {
    await expect(draftListingWithAi(input, fakeClient({ stop_reason: "refusal", parsed_output: null }).client)).rejects.toBeInstanceOf(
      ListingAiDraftError,
    );
    await expect(draftListingWithAi(input, fakeClient({ stop_reason: "end_turn", parsed_output: null }).client)).rejects.toBeInstanceOf(
      ListingAiDraftError,
    );
  });
});
