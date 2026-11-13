import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHomepage } from "../src/guard";

const html = () => new Response("<html>ok</html>", { headers: { "content-type": "text/html" } });
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

afterEach(() => vi.unstubAllGlobals());

describe("fetchHomepage redirects", () => {
  it("follows a redirect to another public page and keeps host and path", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return calls.length === 1 ? redirect("https://www.acme.io/en/") : html();
    }));
    expect(await fetchHomepage("acme.io")).toContain("ok");
    expect(calls).toEqual(["https://acme.io/", "https://www.acme.io/en/"]);
  });

  it("refuses redirects the input check would have refused", async () => {
    for (const target of ["https://lead-table.x.workers.dev/", "http://acme.io/", "https://acme.io:8443/", "https://127.0.0.1/", "https://intra.local/"]) {
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        calls.push(url);
        return calls.length === 1 ? redirect(target) : html();
      }));
      expect(await fetchHomepage("acme.io")).toBeNull();
      expect(calls).toHaveLength(1);
    }
  });

  it("gives up after too many redirects", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => redirect(`https://acme.io/${++n}`)));
    expect(await fetchHomepage("acme.io")).toBeNull();
    expect(n).toBeLessThanOrEqual(4);
  });
});
