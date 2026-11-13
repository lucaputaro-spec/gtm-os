import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { decideReply, keywordGuess, splitReply } from "../src/reply";

// Modell fällt aus: dann entscheiden Regeln und Stichwörter, deterministisch.
const env = {
  AI: { run: () => Promise.reject(new Error("offline")) },
  AI_MODEL: "test",
  ASSETS: { fetch: () => new Response("") },
} as never;

async function sort(text: string) {
  const res = await worker.fetch(
    new Request("https://gtm-os.test/api/reply", { method: "POST", body: JSON.stringify({ text }) }),
    env,
  );
  return (await res.json()) as { plan: { kind: string; sequence: string }; decidedBy: string; draft: string; note: string; ignored: string };
}

const TUESDAY = `Yes, Tuesday works.

On Mon, Nov 9, 2026 at 10:02 Luca <luca@example.com> wrote:
> Hi, would a short call next week help?
> Luca
> Click here to unsubscribe`;

describe("opt-outs in the new text", () => {
  it("catches 'Please stop reaching out'", async () => {
    expect(decideReply("Please stop reaching out.").kind).toBe("unsubscribe");
    const d = await sort("Please stop reaching out.");
    expect(d.plan.kind).toBe("unsubscribe");
    expect(d.decidedBy).toBe("rule");
    expect(d.draft).toBe("");
  });

  it("does not drop an opt-out written in the new text just because it looks like a footer", () => {
    expect(decideReply("I'd like to unsubscribe from these emails.").kind).toBe("unsubscribe");
    expect(decideReply("Please unsubscribe me from all of this.").kind).toBe("unsubscribe");
    expect(decideReply("We want to unsubscribe from all your lists, thanks.").kind).toBe("unsubscribe");
  });

  it("still lets an opt-out win over interest in the same new text", () => {
    expect(decideReply("Sounds interesting but unsubscribe me").kind).toBe("unsubscribe");
  });
});

describe("quoted history and footers", () => {
  it("splits the new text from the quote and drops the footer line", () => {
    const p = splitReply(TUESDAY);
    expect(p.fresh).toBe("Yes, Tuesday works.");
    expect(p.quoted).toContain("short call");
    expect(p.quoted).not.toContain("unsubscribe");
    expect(p.footerLines).toBe(1);
  });

  it("treats 'Yes, Tuesday works' with a quoted unsubscribe footer as a meeting", async () => {
    expect(decideReply(TUESDAY).kind).toBeNull();
    expect(keywordGuess("Yes, Tuesday works.")).toBe("meeting");
    const d = await sort(TUESDAY);
    expect(d.plan.kind).toBe("meeting");
    expect(d.ignored).toMatch(/quoted history/);
    expect(d.ignored).toMatch(/1 footer line/);
  });

  it("sends a footer-like line in the new text to a person instead of dropping it", () => {
    const r = decideReply("Happy to chat.\n\nTo unsubscribe from these emails, click here.");
    expect(r.kind).toBe("needs_review");
    expect(r.reason).toMatch(/footer/);
  });

  it("reads German quote headers", () => {
    const text = "Klingt gut, gerne mehr Infos.\n\nAm 09.11.2026 um 10:02 schrieb Luca:\n> Hallo";
    expect(splitReply(text).fresh).toBe("Klingt gut, gerne mehr Infos.");
  });

  it("does not take an out-of-office from the quoted part", () => {
    expect(decideReply("Thanks, more details please.\n> I am out of the office until March 14").kind).toBeNull();
  });
});

describe("unclear replies go to a human", () => {
  it("flags a negated opt-out", async () => {
    const d = await sort("Don't unsubscribe me, I just changed my address.");
    expect(d.plan.kind).toBe("needs_review");
    expect(d.plan.sequence).toBe("pause");
    expect(d.draft).toBe("");
    expect(d.note).toMatch(/negated/);
  });

  it("flags opt-out wording in the quoted conversation that is not a footer", () => {
    const r = decideReply("Sure, call me Tuesday.\n\n> Please remove me from your list.");
    expect(r.kind).toBe("needs_review");
    expect(r.reason).toMatch(/who wrote it/);
  });

  it("flags a reply with no new text", () => {
    expect(decideReply("> Hi, would a call help?").kind).toBe("needs_review");
  });
});

describe("drafts promise no dates or links that do not exist", () => {
  it("offers no time slots or link without a booking link", async () => {
    const d = await sort("Let's talk next week.");
    expect(d.plan.kind).toBe("meeting");
    expect(d.draft).not.toMatch(/\d{1,2}:\d{2}|link|https?:/i);
  });
});
