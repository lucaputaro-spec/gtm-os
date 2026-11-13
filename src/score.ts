// Bewertet eine eingehende Anfrage und entscheidet, wer sie bekommt und
// wie schnell geantwortet werden muss. Jede Regel vergibt sichtbare Punkte,
// damit ein Verkäufer nachvollziehen kann, warum ein Lead oben steht.

import type { Research } from "./signals";

export interface LeadInput {
  name: string;
  email: string;
  role: string;
  message: string;
}

export interface ScoreLine {
  points: number;
  reason: string;
}

export type Tier = "A" | "B" | "C" | "Rejected";

export interface Routing {
  tier: Tier;
  owner: string;
  slaMinutes: number | null;
  action: string;
}

export interface Scored {
  score: number;
  lines: ScoreLine[];
  routing: Routing;
  emailDomain: string;
  freeMail: boolean;
}

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com",
  "me.com", "gmx.de", "gmx.net", "gmx.at", "gmx.ch", "web.de", "t-online.de", "proton.me",
  "protonmail.com", "aol.com", "mail.com", "posteo.de", "freenet.de",
]);
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "throwawaymail.com",
]);

const BUYING = /\b(pricing|price|quote|budget|demo|call|contract|proposal|timeline|asap|this (week|month|quarter)|next (week|month)|angebot|preis|kosten|termin|zeitnah)\b/i;
const NOT_A_BUYER = /\b(student|thesis|homework|internship|job application|applying for|guest post|backlink|seo services|link exchange|bachelorarbeit|praktikum|bewerbung)\b/i;
const SENIOR = /\b(founder|co-?founder|owner|ceo|cro|cmo|coo|chief|vp|vice president|head of|director|gesch[aä]ftsf[uü]hrer|inhaber|leiter)\b/i;
const MID = /\b(manager|lead|teamleiter)\b/i;

export function emailDomain(email: string): string {
  const m = email.trim().toLowerCase().match(/^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/);
  return m?.[1] ?? "";
}

export function scoreLead(lead: LeadInput, research: Research | null): Scored {
  const domain = emailDomain(lead.email);
  const lines: ScoreLine[] = [];
  const freeMail = FREE_MAIL.has(domain);

  if (!domain) {
    return reject("Email address is not valid", domain, freeMail);
  }
  if (DISPOSABLE.has(domain)) {
    return reject("Throwaway email provider", domain, freeMail);
  }

  if (freeMail) lines.push({ points: 0, reason: `Personal mailbox (${domain}), company unknown` });
  else lines.push({ points: 25, reason: `Work email at ${domain}` });

  if (research) {
    lines.push({ points: 10, reason: "Company website is live and readable" });
    const stack = research.signals.filter((s) => s.category === "crm" || s.category === "ads");
    if (stack.length) {
      lines.push({ points: 10, reason: `Already invests in pipeline tooling (${stack.map((s) => s.label).join(", ")})` });
    }
    if (research.motion === "sales-led" || research.motion === "hybrid") {
      lines.push({ points: 5, reason: "Sells through sales conversations" });
    }
  }

  if (SENIOR.test(lead.role)) lines.push({ points: 15, reason: `Decision maker (${lead.role.trim()})` });
  else if (MID.test(lead.role)) lines.push({ points: 8, reason: `Can influence the decision (${lead.role.trim()})` });

  const buying = lead.message.match(BUYING);
  if (buying) lines.push({ points: 20, reason: `Buying language in the message ("${buying[0].toLowerCase()}")` });
  const noBuyer = lead.message.match(NOT_A_BUYER);
  if (noBuyer) lines.push({ points: -30, reason: `Not a buyer ("${noBuyer[0].toLowerCase()}")` });
  if (lead.message.trim().length >= 60) lines.push({ points: 5, reason: "Took the time to describe the need" });

  const score = Math.max(0, Math.min(100, lines.reduce((sum, l) => sum + l.points, 0)));
  return { score, lines, routing: route(score, domain, research), emailDomain: domain, freeMail };
}

function reject(reason: string, domain: string, freeMail: boolean): Scored {
  return {
    score: 0,
    lines: [{ points: 0, reason }],
    routing: { tier: "Rejected", owner: "Nobody", slaMinutes: null, action: "Dropped before it reaches a salesperson" },
    emailDomain: domain,
    freeMail,
  };
}

export function region(domain: string, research: Research | null): "DACH" | "International" {
  if (/\.(de|at|ch)$/.test(domain)) return "DACH";
  if (research?.language.startsWith("de")) return "DACH";
  return "International";
}

export function route(score: number, domain: string, research: Research | null): Routing {
  const desk = region(domain, research);
  if (score >= 60) {
    return { tier: "A", owner: `${desk} account executive`, slaMinutes: 5, action: "Personal reply with calendar link, phone call if no answer" };
  }
  if (score >= 35) {
    return { tier: "B", owner: `${desk} sales development rep`, slaMinutes: 60, action: "Reply with one qualifying question" };
  }
  return { tier: "C", owner: "Nurture sequence", slaMinutes: null, action: "Automatic helpful reply, no sales time spent" };
}
