import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Fetching a URL that a user typed in (today: a host's calendar import link)
 * from our own servers. A plain fetch() would let anyone who becomes a host
 * make the server request internal addresses (cloud metadata, localhost,
 * the private network), hang a function with a feed that never ends, or
 * bounce through a redirect to somewhere they couldn't name directly.
 *
 * This refuses all of that:
 *  - http(s) only, on the default ports only;
 *  - every address the hostname resolves to must be public, and the socket
 *    connects to the address that was checked (the check runs inside the
 *    connection's own DNS lookup, so a hostname can't resolve to a public
 *    address for the check and a private one for the connection);
 *  - redirects are followed by hand, a few at most, each hop checked again;
 *  - a hard time limit for the whole fetch and a cap on the body size.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

/** IPv4 embedded in an IPv6 address that routes to it: ::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d. */
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }
  return null;
}

/** True for any address a user-supplied URL must never reach. Unparseable counts as blocked. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const v4 = embeddedIpv4(address);
    if (v4) return blocked.check(v4, "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true;
}

/** Throws UnsafeUrlError unless the URL is http(s) on a default port with no credentials. */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https links are allowed");
  }
  // URL drops a port that's the protocol's default, so any port left is non-standard.
  if (url.port !== "") {
    throw new UnsafeUrlError("Links on non-standard ports aren't allowed");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("Links with a username or password aren't allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) {
    throw new UnsafeUrlError("That address isn't reachable");
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new UnsafeUrlError("That address isn't reachable");
  }
  return url;
}

/** dns.lookup that fails the connection if any resolved address is blocked. */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(new UnsafeUrlError("That address isn't reachable"), "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
};

export type SafeFetchResult = { status: number; ok: boolean; text: string; finalUrl: string };

function requestOnce(
  url: URL,
  accept: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ status: number; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        headers: { Accept: accept, "User-Agent": "FYStay-CalendarSync/1.0" },
        lookup: publicOnlyLookup,
        signal,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location: response.headers.location ?? null, body: "" });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.destroy(new UnsafeUrlError("The response was too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status, location: null, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/**
 * GET a user-supplied URL under the rules above. Resolves for any final
 * HTTP status (check `ok`); rejects for an unsafe URL, a redirect loop, a
 * timeout, an oversized body or a network failure.
 */
export async function safeFetchText(raw: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const { timeoutMs = 10_000, maxBytes = 2 * 1024 * 1024, maxRedirects = 3, accept = "*/*" } = options;
  const signal = AbortSignal.timeout(timeoutMs);

  let url = assertFetchableUrl(raw);
  for (let hop = 0; ; hop++) {
    const { status, location, body } = await requestOnce(url, accept, maxBytes, signal);
    if (status >= 300 && status < 400 && location) {
      if (hop >= maxRedirects) throw new UnsafeUrlError("Too many redirects");
      url = assertFetchableUrl(new URL(location, url).toString());
      continue;
    }
    return { status, ok: status >= 200 && status < 300, text: body, finalUrl: url.toString() };
  }
}

/** assertFetchableUrl as a boolean, for validating a link when it's saved. DNS is still checked at fetch time. */
export function isFetchableUrl(raw: string): boolean {
  try {
    assertFetchableUrl(raw);
    return true;
  } catch {
    return false;
  }
}
