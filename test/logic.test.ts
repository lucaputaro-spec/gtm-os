import { describe, expect, it } from "vitest";
import { normalizeDomain } from "../src/guard";
import { hardRule, keywordGuess, plan, returnDate } from "../src/reply";
import { emailDomain, scoreLead } from "../src/score";
import { extractResearch, recommend } from "../src/signals";

const SALES_SITE = `<html lang="de"><head><title>Acme &amp; Co – Software</title>
<meta name="description" content="Planning software for workshops.">
<script src="https://js.hs-scripts.com/123.js"></script>
<script src="https://snap.licdn.com/li.lms-analytics/insight.min.js"></script></head>
<body><style>.x{color:red}</style><a href="/preise">Preise</a><a href="/karriere">Karriere</a>
<a href="/demo">Demo buchen</a><p>Request a demo today.</p><script>var hidden = "sign up";</script></body></html>`;

const lead = (over: Partial<Parameters<typeof scoreLead>[0]> = {}) => ({
  name: "Dana Okafor",
  email: "dana@acme-tools.de",
  role: "Head of Sales",
  message: "We need pricing and a demo this month, our team loses inbound leads every week.",
  ...over,
});

describe("extractResearch", () => {
  const r = extractResearch(SALES_SITE);

  it("reads title, description and language", () => {
    expect(r.title).toBe("Acme & Co – Software");
    expect(r.description).toBe("Planning software for workshops.");
    expect(r.language).toBe("de");
  });

  it("finds tools with their evidence", () => {
    expect(r.signals.map((s) => s.id)).toEqual(["hubspot", "linkedin"]);
    expect(r.signals[0]?.evidence).toContain("hs-scripts");
  });

  it("reads the sales motion from visible text only", () => {
    expect(r.motion).toBe("sales-led");
    expect(r.text).not.toContain("hidden");
  });

  it("detects pricing and careers links", () => {
    expect(r.links).toMatchObject({ pricing: true, careers: true, login: false });
  });

  it("calls a site with both calls to action hybrid", () => {
    expect(extractResearch("<body>Book a demo or start for free</body>").motion).toBe("hybrid");
  });

  it("survives an empty page", () => {
    const empty = extractResearch("");
    expect(empty.motion).toBe("unclear");
    expect(recommend(empty).length).toBeGreaterThan(0);
  });
});

describe("recommend", () => {
  it("gives at most three ideas and leads with the demo flow for sales-led sites", () => {
    const ideas = recommend(extractResearch(SALES_SITE));
    expect(ideas).toHaveLength(3);
    expect(ideas[0]?.title).toMatch(/demo request/);
  });

  it("suggests a pipeline home when no CRM shows", () => {
    const ideas = recommend(extractResearch("<body>Hello</body>"));
    expect(ideas.some((i) => /one home/.test(i.title))).toBe(true);
  });
});

describe("scoreLead", () => {
  it("sends a senior buyer with a work email to an account executive", () => {
    const s = scoreLead(lead(), extractResearch(SALES_SITE));
    expect(s.routing.tier).toBe("A");
    expect(s.routing.owner).toBe("DACH account executive");
    expect(s.routing.slaMinutes).toBe(5);
    expect(s.score).toBe(s.lines.reduce((sum, l) => sum + l.points, 0));
  });

  it("keeps a vague personal-mailbox lead away from sales", () => {
    const s = scoreLead(lead({ email: "someone@gmail.com", role: "", message: "hello, info please" }), null);
    expect(s.freeMail).toBe(true);
    expect(s.routing.tier).toBe("C");
  });

  it("rejects throwaway addresses and broken emails", () => {
    expect(scoreLead(lead({ email: "x@mailinator.com" }), null).routing.tier).toBe("Rejected");
    expect(scoreLead(lead({ email: "not-an-email" }), null).routing.tier).toBe("Rejected");
  });

  it("pushes non-buyers down even with a work email", () => {
    const s = scoreLead(lead({ role: "", message: "I am a student writing my thesis about your pricing." }), null);
    expect(s.routing.tier).not.toBe("A");
    expect(s.lines.some((l) => l.points < 0)).toBe(true);
  });

  it("never leaves the 0 to 100 range", () => {
    const low = scoreLead(lead({ email: "a@gmail.com", role: "", message: "guest post backlink" }), null);
    expect(low.score).toBe(0);
  });

  it("routes by region", () => {
    expect(scoreLead(lead({ email: "dana@acme.com" }), null).routing.owner).toMatch(/^International/);
  });
});

describe("reply rules", () => {
  it("treats opt-outs as a hard rule in English and German", () => {
    expect(hardRule("Please remove me from your list.")).toBe("unsubscribe");
    expect(hardRule("Bitte keine weiteren E-Mails.")).toBe("unsubscribe");
    expect(plan("unsubscribe").sequence).toBe("stop");
  });

  it("lets an opt-out win over interest in the same message", () => {
    expect(hardRule("Sounds interesting but unsubscribe me")).toBe("unsubscribe");
  });

  it("detects out-of-office and the return date", () => {
    const text = "I am out of the office until March 14 with limited access to email.";
    expect(hardRule(text)).toBe("out_of_office");
    expect(returnDate(text)).toBe("March 14");
    expect(returnDate("Ich bin wieder am 03.02. im Büro")).toBe("03.02.");
  });

  it("leaves normal replies to the model", () => {
    expect(hardRule("Sounds good, can you send details?")).toBeNull();
  });

  it("has a keyword fallback when the model is down", () => {
    expect(keywordGuess("Let's talk next week, are you free Tuesday?")).toBe("meeting");
    expect(keywordGuess("We already use a tool for this")).toBe("objection");
    expect(keywordGuess("I'm not the right person, reach out to our COO")).toBe("referral");
    expect(keywordGuess("How does it connect to our CRM?")).toBe("question");
  });
});

describe("input guards", () => {
  it("normalises what people type", () => {
    expect(normalizeDomain("https://www.Stripe.com/pricing?x=1")).toBe("stripe.com");
    expect(normalizeDomain("dana@acme-tools.de")).toBe("acme-tools.de");
  });

  it("refuses addresses that are not public websites", () => {
    for (const bad of ["localhost", "127.0.0.1", "10.0.0.5:8080", "intra.local", "gtm-os.x.workers.dev", "a b.com", ""]) {
      expect(normalizeDomain(bad)).toBeNull();
    }
  });

  it("reads the domain of an email", () => {
    expect(emailDomain(" Dana@Acme.io ")).toBe("acme.io");
    expect(emailDomain("nope")).toBe("");
  });
});

describe("modelText", () => {
  it("reads the three answer shapes the models use", async () => {
    const { modelText } = await import("../src/ai");
    expect(modelText({ response: "a" })).toBe("a");
    expect(modelText({ choices: [{ message: { content: "b" } }] })).toBe("b");
    expect(modelText({ output: [{ type: "reasoning" }, { type: "message", content: [{ text: "c" }] }] })).toBe("c");
    expect(modelText({})).toBeNull();
  });
});
