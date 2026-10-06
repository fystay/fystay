import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertFetchableUrl, isBlockedAddress, isFetchableUrl, publicOnlyLookup, safeFetchText, UnsafeUrlError } from "./safeFetch";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::10.0.0.1",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows public %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe("assertFetchableUrl", () => {
  it("accepts a normal public calendar link", () => {
    expect(assertFetchableUrl("https://www.airbnb.co.uk/calendar/ical/123.ics?s=abc").hostname).toBe(
      "www.airbnb.co.uk",
    );
    expect(isFetchableUrl("http://example.com/feed.ics")).toBe(true);
  });

  it.each([
    "ftp://example.com/feed.ics",
    "file:///etc/passwd",
    "https://example.com:8443/feed.ics",
    "http://example.com:22/",
    "https://user:pass@example.com/feed.ics",
    "http://localhost/feed.ics",
    "http://api.localhost/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://2130706433/",
    "http://0x7f000001/",
    "not a url",
  ])("refuses %s", (url) => {
    expect(() => assertFetchableUrl(url)).toThrow(UnsafeUrlError);
    expect(isFetchableUrl(url)).toBe(false);
  });
});

describe("safeFetchText", () => {
  // A local server is itself a private address, so every request to it must
  // be refused - which is exactly what these tests check, including when a
  // redirect or a hostname is what leads there.
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((_req, res) => res.end("BEGIN:VCALENDAR\nEND:VCALENDAR"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("refuses a loopback address before connecting", async () => {
    await expect(safeFetchText(`http://127.0.0.1:${port}/`)).rejects.toThrow(UnsafeUrlError);
    await expect(safeFetchText("http://127.0.0.1/")).rejects.toThrow(UnsafeUrlError);
  });

  it("fails the connection's own DNS lookup when a name resolves to a private address", async () => {
    // "localhost" resolves to loopback without any network; the name check
    // would also catch it, so call the lookup directly to prove the DNS
    // layer refuses it on its own (this is what stops a public-looking
    // hostname, or a redirect to one, that points inside).
    const error = await new Promise<Error | null>((resolve) =>
      publicOnlyLookup("localhost", { all: true }, (err) => resolve(err)),
    );
    expect(error).toBeInstanceOf(UnsafeUrlError);
  });
});
