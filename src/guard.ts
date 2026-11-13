// Prüft Eingaben, bevor der Server fremde Seiten abruft. Ohne diese Prüfung
// könnte jemand den Server als Werkzeug benutzen, um interne Adressen
// abzufragen oder riesige Dateien zu laden.

const MAX_BYTES = 300_000;

export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1);
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#]/)[0] ?? "";
  if (s.length > 100 || s.includes(":")) return null;
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(s)) return null;
  if (/\.(local|internal|localhost|test|invalid|example)$/.test(s)) return null;
  if (s.endsWith("workers.dev")) return null;
  return s;
}

export function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

const MAX_REDIRECTS = 3;

// Weiterleitungen selbst verfolgen: sonst könnte eine geprüfte Seite auf eine
// Adresse umleiten, die normalizeDomain abgelehnt hätte (z. B. *.workers.dev).
function safeRedirect(location: string | null, current: string): string | null {
  if (!location) return null;
  try {
    const next = new URL(location, current);
    if (next.protocol !== "https:" || next.port !== "") return null;
    return normalizeDomain(next.hostname) ? next.href : null;
  } catch {
    return null;
  }
}

export async function fetchHomepage(domain: string): Promise<string | null> {
  try {
    const signal = AbortSignal.timeout(7000);
    let url = `https://${domain}/`;
    let res = await fetchOnce(url, signal);
    for (let hop = 0; res.status >= 300 && res.status < 400; hop++) {
      const next = hop < MAX_REDIRECTS ? safeRedirect(res.headers.get("location"), url) : null;
      if (!next) return null;
      url = next;
      res = await fetchOnce(url, signal);
    }
    if (!res.ok || !res.body) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    let bytes = 0;
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => undefined);
    return html;
  } catch {
    return null;
  }
}

function fetchOnce(url: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, {
    redirect: "manual",
    signal,
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; gtm-os-research/1.0)",
      accept: "text/html",
      "accept-language": "en,de;q=0.8",
    },
  });
}
