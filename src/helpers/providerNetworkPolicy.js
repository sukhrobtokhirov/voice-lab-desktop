const dns = require("dns");
const http = require("http");
const https = require("https");
const net = require("net");
const { Readable } = require("stream");

const METADATA_V4 = new Set(["169.254.169.254", "100.100.100.200"]);

function policyError(message, code = "PROVIDER_ENDPOINT_FORBIDDEN") {
  return Object.assign(new Error(message), { code });
}

function ipv4Number(address) {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts.reduce((value, part) => ((value << 8) | part) >>> 0, 0);
}

function inV4Range(address, base, bits) {
  const value = ipv4Number(address);
  const start = ipv4Number(base);
  if (value === null || start === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (start & mask);
}

function mappedIpv4(address) {
  const lower = address.toLowerCase().split("%")[0];
  const match = lower.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  return match && ipv4Number(match[1]) !== null ? match[1] : null;
}

function isSafeLanAddress(address) {
  const mapped = mappedIpv4(address);
  if (mapped) {
    if (METADATA_V4.has(mapped)) return false;
    return (
      inV4Range(mapped, "10.0.0.0", 8) ||
      inV4Range(mapped, "127.0.0.0", 8) ||
      inV4Range(mapped, "172.16.0.0", 12) ||
      inV4Range(mapped, "192.168.0.0", 16)
    );
  }
  const lower = address.toLowerCase().split("%")[0];
  if (net.isIP(lower) !== 6) return false;
  return lower === "::1" || /^f[cd][0-9a-f]:/.test(lower);
}

function isPublicAddress(address) {
  const mapped = mappedIpv4(address);
  if (mapped) {
    if (METADATA_V4.has(mapped)) return false;
    const blocked = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ];
    return !blocked.some(([base, bits]) => inV4Range(mapped, base, bits));
  }

  const lower = address.toLowerCase().split("%")[0];
  if (net.isIP(lower) !== 6) return false;
  if (!/^[23][0-9a-f]{3}:/.test(lower)) return false;
  return !lower.startsWith("2001:db8:");
}

function normalizeApprovedEndpoint(raw, mode) {
  const value = String(raw || "").trim();
  if (!value) throw policyError("Provider endpoint is required", "NO_API");
  if (value.length > 2048) throw policyError("Provider endpoint is too long");

  let url;
  try {
    url = new URL(value);
  } catch {
    throw policyError("Provider endpoint is invalid");
  }
  if (url.username || url.password || url.hash) {
    throw policyError("Provider endpoint must not contain credentials or fragments");
  }
  if (mode === "remote" && url.protocol !== "https:") {
    throw policyError("Remote custom providers require HTTPS");
  }
  if (mode === "lan" && !["http:", "https:"].includes(url.protocol)) {
    throw policyError("LAN provider endpoint is invalid");
  }
  if (url.port === "0") throw policyError("Provider endpoint port is invalid");
  return url.toString().replace(/\/+$/, "");
}

async function resolveApprovedEndpoint(raw, mode, lookup = dns.promises.lookup) {
  const endpoint = normalizeApprovedEndpoint(raw, mode);
  const url = new URL(endpoint);
  let records;
  if (net.isIP(url.hostname)) {
    records = [{ address: url.hostname, family: net.isIP(url.hostname) }];
  } else {
    try {
      records = await lookup(url.hostname, { all: true, verbatim: true });
    } catch {
      throw policyError("Provider endpoint DNS resolution failed", "PROVIDER_DNS_FAILED");
    }
  }
  if (!Array.isArray(records)) records = [records];
  if (!records.length || records.some((record) => !record?.address)) {
    throw policyError("Provider endpoint DNS resolution failed", "PROVIDER_DNS_FAILED");
  }

  const allowed = mode === "remote" ? isPublicAddress : isSafeLanAddress;
  if (!records.every((record) => allowed(record.address))) {
    throw policyError(
      mode === "remote"
        ? "Custom provider endpoint resolves to a private or reserved address"
        : "LAN provider endpoint must resolve to loopback or a private network"
    );
  }
  return { endpoint, url, records };
}

function requestUrlFrom(input) {
  if (typeof input === "string" || input instanceof URL) return new URL(input);
  if (input && typeof input.url === "string") return new URL(input.url);
  throw policyError("Provider request URL is invalid");
}

function assertBoundRequestUrl(requestUrl, approvedUrl) {
  if (requestUrl.origin !== approvedUrl.origin) {
    throw policyError("Provider request escaped its approved origin");
  }
  const basePath = approvedUrl.pathname.replace(/\/+$/, "");
  if (
    basePath &&
    basePath !== "/" &&
    requestUrl.pathname !== basePath &&
    !requestUrl.pathname.startsWith(`${basePath}/`)
  ) {
    throw policyError("Provider request escaped its approved path");
  }
}

function normalizedHeaders(input, init, mode) {
  const headers = new Headers(input?.headers || undefined);
  new Headers(init?.headers || undefined).forEach((value, key) => headers.set(key, value));
  if (mode === "lan") {
    headers.delete("authorization");
    headers.delete("proxy-authorization");
    headers.delete("x-api-key");
    headers.delete("api-key");
  }
  return Object.fromEntries(headers.entries());
}

function createPinnedFetch(rawEndpoint, mode, options = {}) {
  const lookup = options.lookup || dns.promises.lookup;
  const httpRequest = options.httpRequest || http.request;
  const httpsRequest = options.httpsRequest || https.request;

  return async function pinnedFetch(input, init = {}) {
    const approved = await resolveApprovedEndpoint(rawEndpoint, mode, lookup);
    const requestUrl = requestUrlFrom(input);
    assertBoundRequestUrl(requestUrl, approved.url);

    const resolved = await resolveApprovedEndpoint(requestUrl.origin, mode, lookup);
    const address = resolved.records[0];
    const method = init.method || input?.method || "GET";
    const signal = init.signal || input?.signal;
    const body = init.body === undefined ? input?.body : init.body;
    const requestImpl = requestUrl.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const request = requestImpl(
        {
          protocol: requestUrl.protocol,
          hostname: requestUrl.hostname,
          port: requestUrl.port || undefined,
          path: `${requestUrl.pathname}${requestUrl.search}`,
          method,
          headers: normalizedHeaders(input, init, mode),
          servername: requestUrl.hostname,
          lookup: (_hostname, lookupOptions, callback) => {
            if (lookupOptions?.all) {
              callback(null, [{ address: address.address, family: address.family }]);
            } else {
              callback(null, address.address, address.family);
            }
          },
        },
        (response) => {
          const status = response.statusCode || 500;
          if (status >= 300 && status < 400) {
            response.resume();
            reject(policyError("Provider redirects are not allowed"));
            return;
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.set(name, String(value));
            }
          }
          resolve(
            new Response(Readable.toWeb(response), {
              status,
              statusText: response.statusMessage,
              headers,
            })
          );
        }
      );

      request.once("error", reject);
      const abort = () => request.destroy(policyError("Provider request was aborted", "ABORT_ERR"));
      if (signal?.aborted) return abort();
      signal?.addEventListener?.("abort", abort, { once: true });
      request.once("close", () => signal?.removeEventListener?.("abort", abort));

      if (body === undefined || body === null) {
        request.end();
      } else if (
        typeof body === "string" ||
        Buffer.isBuffer(body) ||
        body instanceof Uint8Array
      ) {
        request.end(body);
      } else if (typeof body.getReader === "function") {
        Readable.fromWeb(body).pipe(request);
      } else if (typeof body.pipe === "function") {
        body.pipe(request);
      } else {
        request.destroy(policyError("Unsupported provider request body"));
      }
    });
  };
}

module.exports = {
  assertBoundRequestUrl,
  createPinnedFetch,
  isPublicAddress,
  isSafeLanAddress,
  normalizeApprovedEndpoint,
  resolveApprovedEndpoint,
};
