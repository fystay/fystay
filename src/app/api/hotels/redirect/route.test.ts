import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { computeClickSubId } from "@/lib/hotelProviders/click";
import { defaultStayWindow, DEFAULT_GUEST_COUNTS } from "@/lib/hotelSearchParams";

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rateLimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rateLimit")>("@/lib/rateLimit");
  return {
    ...actual,
    checkRateLimit: (...args: Parameters<typeof actual.checkRateLimit>) => mockCheckRateLimit(...args),
  };
});

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

const mockAffiliateHotelFindUnique = vi.fn();
const mockAffiliateClickCreate = vi.fn();
const mockAffiliateClickFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    affiliateHotel: { findUnique: (...args: unknown[]) => mockAffiliateHotelFindUnique(...args) },
    affiliateClick: {
      create: (...args: unknown[]) => mockAffiliateClickCreate(...args),
      findUnique: (...args: unknown[]) => mockAffiliateClickFindUnique(...args),
    },
  },
}));

const { GET } = await import("./route");

const MOCK_HOTEL_ID = "11111111-1111-1111-1111-111111111111";
const MOCK_PROVIDER_ID = "22222222-2222-2222-2222-222222222222";

function activeMockHotelRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: MOCK_HOTEL_ID,
    externalId: "mock:blackpool:0",
    slug: "the-grand-lodge-blackpool",
    city: "Blackpool",
    active: true,
    provider: {
      id: MOCK_PROVIDER_ID,
      code: "mock",
      status: "ACTIVE",
      supportsDeepLink: true,
    },
    ...overrides,
  };
}

function req(query: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000/api/hotels/redirect?${query}`, { headers });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 1, 12, 0, 0));
  mockCheckRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 39, resetAt: new Date() });
  mockAuth.mockReset().mockResolvedValue(null);
  mockAffiliateHotelFindUnique.mockReset().mockResolvedValue(activeMockHotelRow());
  mockAffiliateClickCreate.mockReset().mockResolvedValue({});
  mockAffiliateClickFindUnique.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/hotels/redirect - golden path", () => {
  it("redirects to the mock provider's deep link and records a click", async () => {
    const res = await GET(req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17&adults=2"));

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("mock-hotel-provider.invalid");
    expect(location).toContain("checkin=2026-10-15");
    expect(location).toContain("checkout=2026-10-17");
    expect(location).toContain("adults=2");

    expect(mockAffiliateClickCreate).toHaveBeenCalledTimes(1);
    const data = mockAffiliateClickCreate.mock.calls[0][0].data;
    expect(data.providerId).toBe(MOCK_PROVIDER_ID);
    expect(data.hotelId).toBe(MOCK_HOTEL_ID);
    expect(data.searchId).toBeNull();
    expect(data.destination).toBe("Blackpool");
    expect(data.userId).toBeNull();
    expect(typeof data.sessionId).toBe("string");
    expect(data.sessionId.length).toBeGreaterThan(0);
  });

  it("sets a fresh visitor-id cookie when the request has none", async () => {
    const res = await GET(req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17"));
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("fystay_vid=");
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  it("reuses an existing visitor-id cookie instead of issuing a new one", async () => {
    const res = await GET(
      req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17", {
        cookie: "fystay_vid=returning-visitor-123",
      }),
    );
    expect(res.headers.get("set-cookie")).toBeNull();
    const data = mockAffiliateClickCreate.mock.calls[0][0].data;
    expect(data.sessionId).toBe("returning-visitor-123");
  });

  it("falls back to the default stay window/guest counts when dates/guests are missing", async () => {
    const res = await GET(req("hotel=the-grand-lodge-blackpool"));
    expect(res.status).toBe(302);
    const expectedWindow = defaultStayWindow();
    const data = mockAffiliateClickCreate.mock.calls[0][0].data;
    expect(new Date(data.checkIn).toISOString().slice(0, 10)).toBe(
      expectedWindow.checkIn.toISOString().slice(0, 10),
    );
  });

  it("attributes an authenticated user's click to their own userId", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-real-1" } });
    await GET(req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17"));
    const data = mockAffiliateClickCreate.mock.calls[0][0].data;
    expect(data.userId).toBe("user-real-1");
  });
});

describe("GET /api/hotels/redirect - missing/invalid records", () => {
  it("falls back safely when no hotel param is given at all", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/hotels");
    expect(mockAffiliateHotelFindUnique).not.toHaveBeenCalled();
    expect(mockAffiliateClickCreate).not.toHaveBeenCalled();
  });

  it("falls back safely when the hotel slug doesn't resolve to anything", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue(null);
    const res = await GET(req("hotel=does-not-exist"));
    expect(res.headers.get("location")).toContain("/hotels");
    expect(mockAffiliateClickCreate).not.toHaveBeenCalled();
  });

  it("falls back safely for an inactive (suppressed) cached hotel row", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue(activeMockHotelRow({ active: false }));
    const res = await GET(req("hotel=the-grand-lodge-blackpool"));
    expect(res.headers.get("location")).toContain("/hotels");
    expect(mockAffiliateClickCreate).not.toHaveBeenCalled();
  });

  it("falls back safely when the hotel's provider isn't ACTIVE", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue(
      activeMockHotelRow({ provider: { id: MOCK_PROVIDER_ID, code: "booking_com", status: "INACTIVE", supportsDeepLink: true } }),
    );
    const res = await GET(req("hotel=some-booking-com-hotel"));
    expect(res.headers.get("location")).toContain("/hotels");
    expect(mockAffiliateClickCreate).not.toHaveBeenCalled();
  });

  it("falls back safely when the provider doesn't support deep links", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue(
      activeMockHotelRow({ provider: { id: MOCK_PROVIDER_ID, code: "mock", status: "ACTIVE", supportsDeepLink: false } }),
    );
    const res = await GET(req("hotel=the-grand-lodge-blackpool"));
    expect(res.headers.get("location")).toContain("/hotels");
    expect(mockAffiliateClickCreate).not.toHaveBeenCalled();
  });

  it("falls back safely when the resolved provider code has no registered adapter", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue(
      activeMockHotelRow({ provider: { id: MOCK_PROVIDER_ID, code: "totally_unregistered", status: "ACTIVE", supportsDeepLink: true } }),
    );
    const res = await GET(req("hotel=some-hotel"));
    expect(res.headers.get("location")).toContain("/hotels");
    expect(mockAffiliateClickCreate).not.toHaveBeenCalled();
  });

  it("falls back safely (never 500s) when the real booking_com adapter's createDeepLink throws (not yet confirmed)", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue(
      activeMockHotelRow({ provider: { id: MOCK_PROVIDER_ID, code: "booking_com", status: "ACTIVE", supportsDeepLink: true } }),
    );
    const originalEnv = { ...process.env };
    process.env.BOOKING_COM_API_KEY = "test-key";
    process.env.BOOKING_COM_AFFILIATE_ID = "test-aid";
    try {
      const res = await GET(req("hotel=some-booking-com-hotel"));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/hotels");
    } finally {
      process.env = originalEnv;
    }
  });
});

describe("GET /api/hotels/redirect - provider activation gate", () => {
  it("falls back safely and records no click for the mock provider on a production deployment", async () => {
    const originalEnv = { ...process.env };
    process.env.VERCEL_ENV = "production";
    try {
      const res = await GET(req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17"));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/hotels");
      expect(res.headers.get("location")).not.toContain("mock-hotel-provider.invalid");
      expect(mockAffiliateClickCreate).not.toHaveBeenCalled();
    } finally {
      process.env = originalEnv;
    }
  });

  it("still redirects to the mock provider on a preview deployment", async () => {
    const originalEnv = { ...process.env };
    process.env.VERCEL_ENV = "preview";
    try {
      const res = await GET(req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17"));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("mock-hotel-provider.invalid");
    } finally {
      process.env = originalEnv;
    }
  });

  it("falls back before recording a click for an ACTIVE external provider that isn't live-listed", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue(
      activeMockHotelRow({ provider: { id: MOCK_PROVIDER_ID, code: "booking_com", status: "ACTIVE", supportsDeepLink: true } }),
    );
    const res = await GET(req("hotel=some-booking-com-hotel"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/hotels");
    expect(mockAffiliateClickCreate).not.toHaveBeenCalled();
  });
});

describe("GET /api/hotels/redirect - rate limiting", () => {
  it("returns 429 and never touches the database when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date() });
    const res = await GET(req("hotel=the-grand-lodge-blackpool"));
    expect(res.status).toBe(429);
    expect(mockAffiliateHotelFindUnique).not.toHaveBeenCalled();
    expect(mockAffiliateClickCreate).not.toHaveBeenCalled();
  });
});

describe("GET /api/hotels/redirect - tampering resistance", () => {
  it("ignores an open-redirect-style url/next/returnTo param entirely", async () => {
    const res = await GET(
      req(
        "hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17&url=https://evil.example.com&next=https://evil.example.com&returnTo=https://evil.example.com&redirect=https://evil.example.com",
      ),
    );
    const location = res.headers.get("location")!;
    expect(location).toContain("mock-hotel-provider.invalid");
    expect(location).not.toContain("evil.example.com");
  });

  it("ignores a client-supplied providerId and always uses the resolved hotel's real provider", async () => {
    await GET(
      req(
        `hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17&providerId=${crypto.randomUUID()}`,
      ),
    );
    const data = mockAffiliateClickCreate.mock.calls[0][0].data;
    expect(data.providerId).toBe(MOCK_PROVIDER_ID);
  });

  it("ignores a client-supplied subId and always uses the deterministic server-computed one", async () => {
    await GET(req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17&subId=hacked-value"));
    const data = mockAffiliateClickCreate.mock.calls[0][0].data;
    expect(data.subId).not.toBe("hacked-value");
    // No adults/children/rooms were given at all, so parseOptionalGuestCounts
    // fills each in with its own single-field default (1/0/1) - genuinely
    // different from DEFAULT_GUEST_COUNTS (2/0/1), which only ever applies
    // when a *provided* value is out of range (see the "clamps out-of-range
    // guest counts" test below for that case).
    const expectedSubId = computeClickSubId({
      hotelId: MOCK_HOTEL_ID,
      externalRoomId: null,
      checkIn: new Date(2026, 9, 15),
      checkOut: new Date(2026, 9, 17),
      adults: 1,
      children: 0,
      rooms: 1,
      visitorKey: data.sessionId,
      now: new Date(2026, 9, 1, 12, 0, 0),
    });
    expect(data.subId).toBe(expectedSubId);
  });

  it("ignores a client-supplied userId and never attributes a click to somebody else's account", async () => {
    mockAuth.mockResolvedValue(null); // this visitor is not actually logged in
    await GET(
      req(
        "hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17&userId=some-other-real-user-id",
      ),
    );
    const data = mockAffiliateClickCreate.mock.calls[0][0].data;
    expect(data.userId).toBeNull();
  });

  it("ignores a client-supplied sessionId and never attributes a click to somebody else's session", async () => {
    const res = await GET(
      req(
        "hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17&sessionId=victim-session-id",
        { cookie: "fystay_vid=my-own-real-visitor-id" },
      ),
    );
    const data = mockAffiliateClickCreate.mock.calls[0][0].data;
    expect(data.sessionId).toBe("my-own-real-visitor-id");
    expect(data.sessionId).not.toBe("victim-session-id");
    expect(res.status).toBe(302);
  });

  it("treats malformed dates as absent rather than crashing or injecting them raw", async () => {
    const res = await GET(req("hotel=the-grand-lodge-blackpool&checkIn=not-a-date&checkOut=also-not-a-date"));
    expect(res.status).toBe(302);
    const data = mockAffiliateClickCreate.mock.calls[0][0].data;
    const expectedWindow = defaultStayWindow();
    expect(new Date(data.checkIn).toISOString().slice(0, 10)).toBe(
      expectedWindow.checkIn.toISOString().slice(0, 10),
    );
  });

  it("clamps out-of-range guest counts to the safe default rather than trusting them", async () => {
    const res = await GET(
      req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17&adults=99999&rooms=-5"),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toContain(`adults=${DEFAULT_GUEST_COUNTS.adults}`);
  });

  it("only stores a same-origin referrer path, discarding a foreign referrer header", async () => {
    await GET(
      req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17", {
        referer: "https://attacker.example.com/phishing?x=1",
      }),
    );
    const data = mockAffiliateClickCreate.mock.calls[0][0].data;
    expect(data.referrerPath).toBeNull();
  });

  it("stores a same-origin referrer path verbatim (path only, no query string leakage risk)", async () => {
    await GET(
      req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17", {
        referer: "http://localhost:3000/hotels/blackpool/the-grand-lodge-blackpool?secret=1",
      }),
    );
    const data = mockAffiliateClickCreate.mock.calls[0][0].data;
    expect(data.referrerPath).toBe("/hotels/blackpool/the-grand-lodge-blackpool");
  });
});

describe("GET /api/hotels/redirect - direct access", () => {
  it("works correctly with no referrer and no prior cookie at all (a bookmark or shared link)", async () => {
    const res = await GET(req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("mock-hotel-provider.invalid");
    expect(mockAffiliateClickCreate).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/hotels/redirect - duplicate-click idempotency", () => {
  it("reuses the original deep link when the same click (same subId) was already recorded", async () => {
    const conflictError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.19.3",
    });
    mockAffiliateClickCreate.mockRejectedValue(conflictError);
    mockAffiliateClickFindUnique.mockResolvedValue({
      deepLinkUrl: "https://mock-hotel-provider.invalid/deeplink/already-recorded",
    });

    const res = await GET(req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://mock-hotel-provider.invalid/deeplink/already-recorded");
  });

  it("still redirects the guest even if recording the click fails for an unrelated reason", async () => {
    mockAffiliateClickCreate.mockRejectedValue(new Error("database connection lost"));
    const res = await GET(req("hotel=the-grand-lodge-blackpool&checkIn=2026-10-15&checkOut=2026-10-17"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("mock-hotel-provider.invalid");
  });
});
