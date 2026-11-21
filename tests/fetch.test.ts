import { describe, expect, it } from "vitest";
import { assertPublicUrl, htmlToText, isPrivateAddress, safeFetch } from "../src/tools/fetch.js";
import { connect, makeRoot, text } from "./helpers.js";

const publicDns = async () => ["93.184.215.14"];

function responder(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  }) as typeof fetch;
}

describe("address classification", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.1.2.3", true],
    ["172.20.0.1", true],
    ["192.168.1.10", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["0.0.0.0", true],
    ["::1", true],
    ["fd00::1", true],
    ["fe80::1", true],
    ["::ffff:10.0.0.1", true],
    ["8.8.8.8", false],
    ["93.184.215.14", false],
    ["2606:4700::1111", false],
  ])("%s private=%s", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe("assertPublicUrl", () => {
  it("rejects non-http schemes, credentials, internal hosts and unresolvable hosts", async () => {
    await expect(assertPublicUrl(new URL("file:///etc/passwd"), publicDns)).rejects.toThrow(/http/);
    await expect(assertPublicUrl(new URL("http://u:p@example.com"), publicDns)).rejects.toThrow(
      /credentials/,
    );
    await expect(
      assertPublicUrl(new URL("http://169.254.169.254/latest"), publicDns),
    ).rejects.toThrow(/non-public/);
    await expect(
      assertPublicUrl(new URL("http://intranet.example"), async () => [
        "93.184.215.14",
        "10.0.0.5",
      ]),
    ).rejects.toThrow(/10\.0\.0\.5/);
    await expect(
      assertPublicUrl(new URL("http://nowhere.example"), async () => []),
    ).rejects.toThrow(/resolve/);
    await expect(assertPublicUrl(new URL("http://[::1]:8080/"), publicDns)).rejects.toThrow(
      /non-public/,
    );
  });
});

describe("safeFetch", () => {
  it("re-checks every redirect hop", async () => {
    const fetcher = responder({
      "https://example.com/": () =>
        new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }),
    });
    await expect(
      safeFetch("https://example.com/", { resolve: publicDns, fetcher }),
    ).rejects.toThrow(/non-public/);
  });

  it("follows public redirects and caps them", async () => {
    const ok = responder({
      "https://example.com/a": () =>
        new Response(null, { status: 301, headers: { location: "/b" } }),
      "https://example.com/b": () =>
        new Response("done", { headers: { "content-type": "text/plain" } }),
    });
    const page = await safeFetch("https://example.com/a", { resolve: publicDns, fetcher: ok });
    expect(page).toMatchObject({ url: "https://example.com/b", status: 200, body: "done" });

    const loop = responder({
      "https://example.com/": () => new Response(null, { status: 302, headers: { location: "/" } }),
    });
    await expect(
      safeFetch("https://example.com/", { resolve: publicDns, fetcher: loop }),
    ).rejects.toThrow(/Too many redirects/);
  });

  it("rejects oversized responses", async () => {
    const big = responder({
      "https://example.com/": () =>
        new Response("x", { headers: { "content-length": "999999999" } }),
      "https://example.com/stream": () => new Response("y".repeat(3 * 1024 * 1024)),
    });
    await expect(
      safeFetch("https://example.com/", { resolve: publicDns, fetcher: big }),
    ).rejects.toThrow(/too large/);
    await expect(
      safeFetch("https://example.com/stream", { resolve: publicDns, fetcher: big }),
    ).rejects.toThrow(/too large/);
  });
});

describe("fetch_url tool", () => {
  it("returns readable text from HTML and blocks internal targets", async () => {
    const html =
      "<html><head><title>Pricing</title><style>p{}</style></head><body><p>Plans &amp; prices</p><script>evil()</script><p>From 29&nbsp;EUR</p></body></html>";
    const fetcher = responder({
      "https://example.com/pricing": () =>
        new Response(html, { headers: { "content-type": "text/html" } }),
    });
    const { call } = await connect({ root: makeRoot(), resolve: publicDns, fetcher });
    const result = await call("fetch_url", { url: "https://example.com/pricing" });
    const out = text(result);
    expect(out).toContain("Title: Pricing");
    expect(out).toContain("Plans & prices");
    expect(out).not.toContain("evil");
    const blocked = await call("fetch_url", { url: "http://localhost:3000/" });
    expect(blocked.isError).toBe(true);
  });

  it("strips markup", () => {
    expect(htmlToText("<div>a<br>b</div>").text).toBe("a\nb");
  });
});
