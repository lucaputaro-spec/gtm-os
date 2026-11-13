// Ordnet die Antwort eines Interessenten auf eine Vertriebs-Mail ein.
// Abmeldungen und Abwesenheitsnotizen entscheidet eine feste Regel, nie die
// AI: eine Abmeldung zu übersehen wäre ein Rechtsverstoß, kein Schönheitsfehler.

export type ReplyKind =
  | "unsubscribe"
  | "out_of_office"
  | "meeting"
  | "interested"
  | "referral"
  | "objection"
  | "not_now"
  | "not_interested"
  | "question"
  | "needs_review";

export interface ReplyPlan {
  kind: ReplyKind;
  label: string;
  stage: "Meeting" | "Replied" | "Paused" | "Closed";
  action: string;
  sequence: "stop" | "pause" | "continue";
}

export const PLANS: Record<ReplyKind, Omit<ReplyPlan, "kind">> = {
  unsubscribe: { label: "Opt-out", stage: "Closed", action: "Add to suppression list for good. No reply is sent.", sequence: "stop" },
  out_of_office: { label: "Out of office", stage: "Paused", action: "Pause the sequence and resume after the return date.", sequence: "pause" },
  meeting: { label: "Wants a meeting", stage: "Meeting", action: "Confirm a time today and send the calendar invite.", sequence: "stop" },
  interested: { label: "Interested", stage: "Replied", action: "Answer today and ask for a short call.", sequence: "stop" },
  referral: { label: "Points to someone else", stage: "Replied", action: "Thank them, add the new contact, mention the referral.", sequence: "stop" },
  objection: { label: "Objection", stage: "Replied", action: "Answer the concern directly, then offer one small next step.", sequence: "stop" },
  not_now: { label: "Not now", stage: "Paused", action: "Confirm, then set a follow-up for the time they named.", sequence: "pause" },
  not_interested: { label: "Not interested", stage: "Closed", action: "Close politely. Do not contact again in this campaign.", sequence: "stop" },
  question: { label: "Has a question", stage: "Replied", action: "Answer the question in two sentences, then ask one back.", sequence: "stop" },
  needs_review: { label: "Needs a human", stage: "Paused", action: "Pause the sequence. A person reads this reply before any next step is suggested.", sequence: "pause" },
};

const UNSUBSCRIBE = /\b(unsubscribe|opt[ -]?out|remove me|take me off|stop (emailing|contacting|sending|reaching out|writing|messaging)|no more (e-?mails|messages)|do not (contact|email)|don'?t (contact|email) me|abmelden|austragen|keine (weiteren )?(e-?mails|nachrichten|werbung)|aus (dem|ihrem) verteiler)\b/i;
const OUT_OF_OFFICE = /\b(out of (the )?office|on (annual |parental )?leave|on vacation|on holiday|away until|back on|limited access to (my )?email|auto(matic|-)?reply|abwesenheit|nicht im b[uü]ro|im urlaub|bin ich wieder|au[sß]er haus)\b/i;

const KEYWORDS: [ReplyKind, RegExp][] = [
  ["meeting", /\b((mon|tues|wednes|thurs|fri)day (works|is fine|suits)|works for me|let'?s (talk|chat|meet|schedule)|book a (call|time)|send (me )?(your |a )?(calendar|calendly)|are you free|free (on|next)|set up a call|termin|telefonieren|kurz sprechen)\b/i],
  ["referral", /\b(not the right person|wrong person|reach out to|you should (talk|speak) to|get in touch with|cc'?ing|looping in|falsche(r)? ansprechpartner|wenden sie sich an)\b/i],
  ["not_now", /\b(not (right )?now|next quarter|next year|in (a few|\d+) months|circle back|check back|bad timing|sp[aä]ter|n[aä]chstes (jahr|quartal))\b/i],
  ["objection", /\b(too expensive|no budget|already (use|have|work with)|we use|happy with|locked in|contract with|kein budget|zu teuer|haben (wir )?bereits)\b/i],
  ["not_interested", /\b(not interested|no thanks|no thank you|not a fit|please stop|kein interesse|nein danke)\b/i],
  ["interested", /\b(interested|sounds (good|interesting|great)|tell me more|more (info|information|details)|send (me )?(more|details|info)|klingt (gut|interessant)|mehr (infos|informationen))\b/i],
];

export function plan(kind: ReplyKind): ReplyPlan {
  return { kind, ...PLANS[kind] };
}

// Eine Antwort-Mail enthält oft mehr als die Antwort: zitierten Verlauf,
// Signatur und Newsletter-Footer wie „Click here to unsubscribe“. Bewertet
// wird nur der neu geschriebene Teil. Sonst würde ein zitierter Footer aus
// einer Terminzusage eine Abmeldung machen.
const QUOTE_START = [
  /^\s*>/,
  /^\s*On .+wrote:\s*$/i,
  /^\s*Am .+schrieb.*:\s*$/i,
  /^\s*-{2,}\s*(Original Message|Urspr[uü]ngliche Nachricht|Forwarded message)/i,
  /^\s*(From|Von):\s/,
  /^\s*_{5,}\s*$/,
];
const SIGNATURE = /^\s*(-- ?|Sent from my \w+|Von meinem \w+ gesendet)\s*$/i;
const FOOTER = /(click here to unsubscribe|to unsubscribe|unsubscribe (here|link|from (this|these|our|all))|manage (your )?(email |subscription )?preferences|update your preferences|you('re| are)? receiv(ed|ing) this|newsletter abbestellen|hier abmelden|abmelden:)/i;
// Spricht der Absender selbst? Dann ist eine Zeile mit „unsubscribe from …“
// sein eigener Wunsch und kein Newsletter-Footer.
const PERSONAL = /\b(i|i'?d|i'?m|we|we'?d|please|me|us|bitte|ich|wir|mich|uns)\b/i;
const NEGATED_OPT_OUT = /\b(don'?t|do not|no need to|not)\s+(unsubscribe|remove|opt[ -]?out|take me off)/i;

export interface ReplyParts {
  fresh: string;
  quoted: string;
  footerLines: number; // im Zitat, still entfernt
  freshFooterLines: number; // im neuen Text: nicht still entfernen, ein Mensch prüft
}

export function splitReply(text: string): ReplyParts {
  const fresh: string[] = [];
  const quoted: string[] = [];
  let footerLines = 0;
  let freshFooterLines = 0;
  let inQuote = false;
  for (const line of text.split(/\r?\n/)) {
    if (!inQuote && (QUOTE_START.some((re) => re.test(line)) || SIGNATURE.test(line))) inQuote = true;
    if (FOOTER.test(line)) {
      if (inQuote) {
        footerLines++;
        continue;
      }
      // Im neuen Text nie still verwerfen: sonst würde „I'd like to
      // unsubscribe from these emails“ als Footer übersehen.
      if (!PERSONAL.test(line)) {
        freshFooterLines++;
        continue;
      }
    }
    (inQuote ? quoted : fresh).push(line);
  }
  return { fresh: fresh.join("\n").trim(), quoted: quoted.join("\n").trim(), footerLines, freshFooterLines };
}

export interface RuleResult {
  kind: ReplyKind | null; // null: die AI darf einordnen
  fresh: string;
  reason: string;
  ignored: string;
}

// Feste Regeln zuerst. Eindeutige Abmeldung gewinnt immer. Unklare Fälle
// gehen an einen Menschen, statt dass die Demo einen Folgeschritt empfiehlt.
export function decideReply(text: string): RuleResult {
  const parts = splitReply(text);
  const { fresh, quoted } = parts;
  const ignored = describeIgnored(parts);
  const done = (kind: ReplyKind | null, reason = ""): RuleResult => ({ kind, fresh, reason, ignored });

  if (!fresh) {
    return done("needs_review", UNSUBSCRIBE.test(quoted)
      ? "No new text above the quoted message, and the quoted part contains opt-out wording."
      : "No new text found above the quoted message.");
  }
  if (NEGATED_OPT_OUT.test(fresh)) {
    return done("needs_review", "Opt-out words appear in a negated form. A person should read what they mean.");
  }
  if (UNSUBSCRIBE.test(fresh)) return done("unsubscribe");
  if (parts.freshFooterLines) {
    return done("needs_review", "The new text contains a line that looks like an email footer with unsubscribe wording. A person should check whether the prospect wants out.");
  }
  if (UNSUBSCRIBE.test(quoted)) {
    return done("needs_review", "The new text is not an opt-out, but the quoted conversation contains opt-out wording outside a standard footer. A person should check who wrote it.");
  }
  if (OUT_OF_OFFICE.test(fresh)) return done("out_of_office");
  return done(null);
}

function describeIgnored(p: ReplyParts): string {
  const bits: string[] = [];
  if (p.quoted) bits.push("quoted history or signature");
  if (p.footerLines) bits.push(p.footerLines === 1 ? "1 footer line" : `${p.footerLines} footer lines`);
  return bits.length ? `Ignored for the decision: ${bits.join(" and ")}.` : "";
}

// Kurzform für Stellen, die nur die Regel-Kategorie brauchen.
export function hardRule(text: string): ReplyKind | null {
  return decideReply(text).kind;
}

// Ersatz, wenn die AI nicht antwortet: Stichwort-Suche in fester Reihenfolge.
export function keywordGuess(text: string): ReplyKind {
  for (const [kind, re] of KEYWORDS) if (re.test(text)) return kind;
  return "question";
}

export function isReplyKind(v: unknown): v is ReplyKind {
  return typeof v === "string" && v in PLANS;
}

// Diese drei Kategorien darf nur eine feste Regel vergeben, nie die AI.
export const RULE_ONLY: readonly ReplyKind[] = ["unsubscribe", "out_of_office", "needs_review"];

export function returnDate(text: string): string {
  const m = text.match(
    /\b(?:until|back on|returning(?: on)?|return on|wieder (?:am|ab)|bis(?: zum)?)\s+((?:\d{1,2}\.\s?\d{1,2}\.(?:\d{2,4})?)|(?:[A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?)|(?:\d{1,2}(?:st|nd|rd|th)? (?:of )?[A-Z][a-z]+)|(?:(?:Mon|Tues|Wednes|Thurs|Fri)day))/,
  );
  return m?.[1] ?? "";
}
