// Liest aus dem HTML einer Firmen-Startseite heraus, was sich über deren
// Vertrieb sagen lässt. Alles hier ist reine Textsuche ohne AI: dieselbe
// Seite ergibt immer dasselbe Ergebnis, und jeder Befund trägt seinen Beleg.

export interface Signal {
  id: string;
  label: string;
  category: "crm" | "chat" | "analytics" | "ads" | "scheduling" | "payments" | "platform" | "forms";
  evidence: string;
  meaning: string;
}

export type Motion = "sales-led" | "product-led" | "hybrid" | "ecommerce" | "unclear";

export interface PageLinks {
  pricing: boolean;
  careers: boolean;
  blog: boolean;
  login: boolean;
}

export interface Research {
  title: string;
  description: string;
  text: string;
  signals: Signal[];
  motion: Motion;
  motionEvidence: string[];
  links: PageLinks;
  language: string;
}

export interface Automation {
  title: string;
  why: string;
  how: string;
}

type Fingerprint = [Signal["id"], string, Signal["category"], RegExp, string];

const FINGERPRINTS: Fingerprint[] = [
  ["hubspot", "HubSpot", "crm", /js\.hs-scripts\.com|js\.hsforms\.net|hs-analytics|hubspot\.com\/|hsforms\.com/i, "Leads already land in a CRM, so automations can plug into existing records."],
  ["salesforce", "Salesforce / Pardot", "crm", /pi\.pardot\.com|force\.com|salesforce\.com\/servlet/i, "Enterprise CRM in place. Routing rules probably exist and can be audited."],
  ["marketo", "Marketo", "crm", /munchkin\.marketo\.net|mktoforms/i, "Marketing automation is in place, so lead scoring can reuse its data."],
  ["klaviyo", "Klaviyo", "crm", /static\.klaviyo\.com|klaviyo\.com\/onsite/i, "Email flows are owned by marketing. Good base for lifecycle automation."],
  ["intercom", "Intercom", "chat", /widget\.intercom\.io|intercomSettings/i, "Live chat exists. Chat leads can be scored and routed like form leads."],
  ["drift", "Drift", "chat", /js\.driftt\.com|drift\.com\/core/i, "Conversational sales tooling in place."],
  ["crisp", "Crisp", "chat", /client\.crisp\.chat/i, "Live chat exists. Chat leads can be scored and routed like form leads."],
  ["zendesk", "Zendesk", "chat", /static\.zdassets\.com|zendesk\.com\/embeddable/i, "Support desk in place. Support tickets can reveal upsell signals."],
  ["calendly", "Calendly", "scheduling", /calendly\.com/i, "Self-serve booking exists, so a hot lead can be sent straight to a calendar."],
  ["chilipiper", "Chili Piper", "scheduling", /chilipiper\.com/i, "Inbound routing to calendars already matters to this team."],
  ["typeform", "Typeform", "forms", /typeform\.com/i, "Forms live outside the CRM. A sync step is needed so no lead gets lost."],
  ["gtm", "Google Tag Manager", "analytics", /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/, "Tags are centrally managed. Conversion events can be added without a release."],
  ["ga", "Google Analytics", "analytics", /google-analytics\.com|gtag\/js\?id=G-/i, "Traffic is measured, so funnel steps can be tied to sources."],
  ["segment", "Segment", "analytics", /cdn\.segment\.com/i, "Customer data is piped through one layer. Product events can feed lead scoring."],
  ["posthog", "PostHog", "analytics", /posthog\.com|ph\.init|posthog\.init/i, "Product analytics in place. Usage signals can trigger sales outreach."],
  ["mixpanel", "Mixpanel", "analytics", /cdn\.mxpnl\.com|mixpanel\.init/i, "Product analytics in place. Usage signals can trigger sales outreach."],
  ["amplitude", "Amplitude", "analytics", /cdn\.amplitude\.com|amplitude\.getInstance/i, "Product analytics in place. Usage signals can trigger sales outreach."],
  ["hotjar", "Hotjar", "analytics", /static\.hotjar\.com/i, "The team studies on-site behaviour, so they care about conversion."],
  ["linkedin", "LinkedIn Insight Tag", "ads", /snap\.licdn\.com/i, "They run or prepare LinkedIn ads. That points to B2B demand generation."],
  ["meta", "Meta Pixel", "ads", /connect\.facebook\.net/i, "They run or prepare Meta ads. Paid leads need fast follow-up to pay off."],
  ["googleads", "Google Ads", "ads", /googleadservices\.com|AW-\d{6,}/, "They pay for clicks. Every slow reply wastes ad spend."],
  ["stripe", "Stripe", "payments", /js\.stripe\.com/i, "Self-serve payment exists, so part of the funnel closes without sales."],
  ["shopify", "Shopify", "platform", /cdn\.shopify\.com/i, "Store runs on Shopify. Order and cart events are available for automation."],
  ["webflow", "Webflow", "platform", /assets\.website-files\.com|data-wf-site|webflow\.(js|css)/i, "Marketing owns the site and can ship form changes quickly."],
  ["wordpress", "WordPress", "platform", /wp-content\/|wp-includes\//i, "Site runs on WordPress. Form plugins can post leads to a webhook."],
];

const SALES_CTA = /\b(book (a|your) (demo|call|meeting)|request (a )?demo|get a demo|schedule (a )?(demo|call)|talk to (sales|an expert|us)|contact sales|demo (buchen|anfragen|vereinbaren)|beratungsgespr[aä]ch|termin (buchen|vereinbaren)|angebot anfordern|get a quote|request a quote)\b/i;
const PRODUCT_CTA = /\b(start (for )?free|try (it )?(for )?free|sign up( for free)?|get started( for free)?|start (your )?(free )?trial|free trial|create (an |your )?account|kostenlos (testen|starten|registrieren)|jetzt (testen|registrieren))\b/i;
const SHOP_CTA = /\b(add to cart|shop now|in den warenkorb|warenkorb|checkout|zur kasse)\b/i;

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

function meta(html: string, name: string): string {
  const tag = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i"))?.[0];
  return decode(tag?.match(/content=["']([^"']*)["']/i)?.[1] ?? "").trim();
}

export function visibleText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatches(text: string, re: RegExp, max: number): string[] {
  const found = new Set<string>();
  const global = new RegExp(re.source, "gi");
  for (const m of text.matchAll(global)) {
    found.add(m[0].toLowerCase());
    if (found.size >= max) break;
  }
  return [...found];
}

export function extractResearch(html: string): Research {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const description = meta(html, "description") || meta(html, "og:description");
  const text = visibleText(html);

  const signals: Signal[] = [];
  for (const [id, label, category, pattern, meaning] of FINGERPRINTS) {
    const hit = html.match(pattern);
    if (hit) signals.push({ id, label, category, evidence: hit[0].slice(0, 60), meaning });
  }

  const sales = firstMatches(text, SALES_CTA, 2);
  const product = firstMatches(text, PRODUCT_CTA, 2);
  const shop = firstMatches(text, SHOP_CTA, 2);
  let motion: Motion = "unclear";
  if (shop.length && !sales.length) motion = "ecommerce";
  else if (sales.length && product.length) motion = "hybrid";
  else if (sales.length) motion = "sales-led";
  else if (product.length) motion = "product-led";

  const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)]
    .slice(0, 600)
    .map((m) => `${m[1]} ${visibleText(m[2] ?? "")}`.toLowerCase());
  const has = (re: RegExp) => hrefs.some((h) => re.test(h));

  return {
    title: title.slice(0, 160),
    description: description.slice(0, 300),
    text: text.slice(0, 1400),
    signals,
    motion,
    motionEvidence: [...sales, ...product, ...shop],
    links: {
      pricing: has(/pricing|preise|plans\b|tarife/),
      careers: has(/careers|jobs\b|karriere|join-us|stellen|we.?re hiring/),
      blog: has(/\/blog|\/resources|\/insights|magazin|ratgeber/),
      login: has(/login|log in|sign in|signin|anmelden/),
    },
    language: html.match(/<html[^>]*\blang=["']([a-zA-Z-]{2,10})["']/i)?.[1]?.toLowerCase() ?? "",
  };
}

// Wählt bis zu drei Automatisierungen aus den Befunden. Regeln statt AI,
// damit jede Empfehlung auf einen sichtbaren Befund zurückgeht.
export function recommend(r: Research): Automation[] {
  const ids = new Set(r.signals.map((s) => s.id));
  const cats = new Set(r.signals.map((s) => s.category));
  const out: Automation[] = [];
  const add = (a: Automation) => {
    if (out.length < 3) out.push(a);
  };

  if (r.motion === "sales-led" || r.motion === "hybrid") {
    add({
      title: "Answer every demo request in under a minute",
      why: `The site asks visitors to "${r.motionEvidence[0] ?? "book a demo"}". Each request is a person waiting for a reply.`,
      how: "Form webhook, enrich the company, score it, send a personal reply with a booking link, alert the owner.",
    });
  }
  if (cats.has("ads")) {
    add({
      title: "Stop paying for leads that go cold",
      why: "Ad tags are installed, so some leads cost money per click. Slow follow-up burns that budget.",
      how: "Tag paid leads at capture, put them at the front of the queue, report reply time per campaign.",
    });
  }
  if (r.motion === "product-led" || r.motion === "hybrid") {
    add({
      title: "Tell sales which free users are ready to buy",
      why: `The site offers "${r.motionEvidence.find((e) => PRODUCT_CTA.test(e)) ?? "a free start"}". Most signups never talk to anyone.`,
      how: "Score signups by company fit and product usage, then hand only the top slice to a human.",
    });
  }
  if (r.motion === "ecommerce") {
    add({
      title: "Win back carts and first-time buyers",
      why: "The site sells through a cart. Abandoned carts and one-time buyers are the cheapest revenue to recover.",
      how: "Trigger flows on cart and order events, split by order value, stop as soon as the customer buys.",
    });
  }
  if (!cats.has("crm")) {
    add({
      title: "Give every lead one home",
      why: "No CRM or marketing-automation tag is visible in the page source. If leads live in inboxes and spreadsheets, this is the first fix.",
      how: "Send every form, chat and email lead into one pipeline with source, owner and next step.",
    });
  }
  if (cats.has("chat") && !cats.has("scheduling")) {
    add({
      title: "Turn chat conversations into booked calls",
      why: "Live chat is installed but no booking tool shows. Hot chats end without a next step.",
      how: "Detect buying intent in chat, offer a calendar slot in the same thread, log it to the pipeline.",
    });
  }
  if (r.links.careers) {
    add({
      title: "Use your own hiring as a signal",
      why: "The site links to open roles. Growing teams need onboarding material and clean handovers.",
      how: "Document the lead flow as you build it, so each new rep works the same playbook from day one.",
    });
  }
  if (ids.has("typeform") || ids.has("wordpress") || ids.has("webflow")) {
    add({
      title: "Catch form leads that never reach sales",
      why: "Forms run on a site builder, outside the sales tools. That gap is where leads get lost.",
      how: "Post each submission to a webhook, check it arrived in the pipeline, alert on any mismatch.",
    });
  }
  add({
    title: "Sort replies to outbound email automatically",
    why: "Every outbound campaign produces replies that need a decision: answer, wait, or stop.",
    how: "Classify each reply, pause the sequence, draft the answer, and honour opt-outs without a human.",
  });
  return out;
}
