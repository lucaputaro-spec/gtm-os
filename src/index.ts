// Einstiegspunkt. Drei Schnittstellen, eine je Funnel-Stufe. Gespeichert
// wird nichts: jede Anfrage wird beantwortet und danach vergessen.

import { classifyReply, writeFirstTouch, writeOutreach, type AiEnv } from "./ai";
import { clip, fetchHomepage, normalizeDomain } from "./guard";
import { decideReply, plan, returnDate } from "./reply";
import { emailDomain, scoreLead } from "./score";
import { extractResearch, recommend } from "./signals";

interface Env extends AiEnv {
  ASSETS: Fetcher;
  LIMITER?: RateLimit;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function research(env: Env, body: Record<string, unknown>): Promise<Response> {
  const started = Date.now();
  const domain = normalizeDomain(clip(body.domain, 200));
  if (!domain) return json({ error: "That does not look like a website. Try something like stripe.com." }, 400);

  const html = await fetchHomepage(domain);
  if (!html) {
    return json({ error: `Could not read ${domain}. The site may block automated visitors. Try another company.` }, 422);
  }
  const fetchMs = Date.now() - started;
  const r = extractResearch(html);
  const automations = recommend(r);
  const top = automations[0];
  if (!top) return json({ error: "No recommendation could be made for this site." }, 422);
  const outreach = await writeOutreach(env, domain, r, top);

  return json({
    domain,
    title: r.title,
    description: r.description,
    motion: r.motion,
    motionEvidence: r.motionEvidence,
    signals: r.signals,
    links: r.links,
    automations,
    outreach,
    timing: { fetchMs, totalMs: Date.now() - started },
  });
}

async function lead(env: Env, body: Record<string, unknown>): Promise<Response> {
  const started = Date.now();
  const steps: { name: string; ms: number; detail: string }[] = [];
  const mark = (name: string, since: number, detail: string) => steps.push({ name, ms: Date.now() - since, detail });

  const input = {
    name: clip(body.name, 80),
    email: clip(body.email, 120),
    role: clip(body.role, 80),
    message: clip(body.message, 800),
  };
  if (!input.email || !input.message) return json({ error: "Email and message are required." }, 400);

  let t = Date.now();
  const domain = emailDomain(input.email);
  const pre = scoreLead(input, null);
  mark("Validate", t, domain ? `Address format is valid, domain ${domain}` : "Address format is not valid");

  t = Date.now();
  let site = null;
  if (pre.routing.tier !== "Rejected" && !pre.freeMail) {
    const safe = normalizeDomain(domain);
    const html = safe ? await fetchHomepage(safe) : null;
    if (html) site = extractResearch(html);
  }
  mark(
    "Enrich",
    t,
    site
      ? `Read ${domain}: ${site.title || "no page title"}`
      : pre.freeMail
        ? "Skipped, a personal mailbox says nothing about the company"
        : "No readable company website",
  );

  t = Date.now();
  const scored = scoreLead(input, site);
  mark("Score", t, `${scored.score} of 100`);

  t = Date.now();
  mark("Route", t, `${scored.routing.owner}${scored.routing.slaMinutes ? `, reply due in ${scored.routing.slaMinutes} min` : ""}`);

  t = Date.now();
  const reply =
    scored.routing.tier === "Rejected"
      ? { text: "", source: "template" as const }
      : await writeFirstTouch(env, input, scored, site);
  mark("Draft reply", t, reply.text ? `Written by ${reply.source === "model" ? "the language model" : "a template"}` : "No reply for rejected leads");

  return json({
    score: scored.score,
    lines: scored.lines,
    routing: scored.routing,
    company: site ? { title: site.title, tools: site.signals.map((s) => s.label) } : null,
    reply,
    steps,
    totalMs: Date.now() - started,
  });
}

async function reply(env: Env, body: Record<string, unknown>): Promise<Response> {
  const started = Date.now();
  const text = clip(body.text, 1500);
  if (text.length < 2) return json({ error: "Paste a reply first." }, 400);

  // Entschieden wird nur über den neu geschriebenen Teil. Auch die AI sieht
  // nur ihn, nicht den zitierten Verlauf.
  const rule = decideReply(text);
  if (rule.kind) {
    const back = rule.kind === "out_of_office" ? returnDate(rule.fresh) : "";
    return json({
      plan: plan(rule.kind),
      decidedBy: "rule",
      draft: "",
      note: rule.reason || (back ? `Return date found: ${back}` : ""),
      ignored: rule.ignored,
      totalMs: Date.now() - started,
    });
  }
  const result = await classifyReply(env, rule.fresh);
  return json({
    plan: plan(result.kind),
    decidedBy: result.source,
    draft: result.draft,
    note: "",
    ignored: rule.ignored,
    totalMs: Date.now() - started,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);

    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== url.host) return json({ error: "Cross-site requests are not allowed." }, 403);

    if (env.LIMITER) {
      const key = request.headers.get("cf-connecting-ip") ?? "unknown";
      const { success } = await env.LIMITER.limit({ key });
      if (!success) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
    }

    let body: Record<string, unknown>;
    try {
      const raw = await request.text();
      if (raw.length > 5000) return json({ error: "Request is too large." }, 413);
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json({ error: "Body must be JSON." }, 400);
    }

    switch (url.pathname) {
      case "/api/research":
        return research(env, body);
      case "/api/lead":
        return lead(env, body);
      case "/api/reply":
        return reply(env, body);
      default:
        return json({ error: "Unknown endpoint." }, 404);
    }
  },
} satisfies ExportedHandler<Env>;
