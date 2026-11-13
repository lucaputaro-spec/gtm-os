// Verhalten der Seite. Alles, was vom Server oder vom Besucher kommt, wird
// als reiner Text eingesetzt (nie als HTML), damit fremde Webseiten-Inhalte
// hier keinen Code einschleusen können.

const $ = (sel) => document.querySelector(sel);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function post(path, body) {
  let res;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("No connection to the server. Check your network and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "The server could not handle that. Try again.");
  return data;
}

function seconds(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function writtenBy(source) {
  return source === "model"
    ? "Drafted by a language model from the facts shown here."
    : "Drafted from a template, because the language model was not available.";
}

async function run(form, out, stop, waiting, task) {
  const button = form.querySelector('button[type="submit"]');
  const li = document.querySelector(`[data-stop="${stop}"]`);
  button.disabled = true;
  li.classList.add("busy");
  out.replaceChildren(h("p", { class: "working" }, waiting));
  try {
    out.replaceChildren(...(await task()));
    li.classList.add("done");
  } catch (err) {
    out.replaceChildren(h("p", { class: "error" }, err.message));
  } finally {
    button.disabled = false;
    li.classList.remove("busy");
  }
}

/* ---------- Pipeline ---------- */

const STAGES = ["Researched", "Inbound", "In conversation", "Meeting", "Paused or closed"];
const store = {
  load() {
    try {
      return JSON.parse(localStorage.getItem("pipeline") || "null") || { cards: [], log: [], current: "" };
    } catch {
      return { cards: [], log: [], current: "" };
    }
  },
  save(state) {
    try {
      localStorage.setItem("pipeline", JSON.stringify(state));
    } catch {
      /* private mode: the board still works for this visit */
    }
  },
};
// Jede Karte hat eine feste ID. Zugeordnet wird über die ID, nie über den
// Namen oder „die zuletzt benutzte Karte“: die kann sich ändern, während eine
// Anfrage noch läuft.
function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

let state = store.load();
for (const c of state.cards) c.id ||= newId(); // ältere Boards ohne ID
if (state.current && !state.cards.some((c) => c.id === state.current)) {
  state.current = state.cards.find((c) => c.name === state.current)?.id || "";
}

function cardById(id) {
  return state.cards.find((c) => c.id === id) || null;
}

// Legt eine Karte an oder schreibt in eine bestehende. Gibt die Karte zurück.
function record(target, stage, note, event) {
  let card = target.id ? cardById(target.id) : state.cards.find((c) => c.name === target.name);
  if (!card) {
    if (target.id) return null; // Karte wurde inzwischen gelöscht
    card = { id: newId(), name: target.name, stage, note };
    state.cards.push(card);
  }
  card.stage = stage;
  card.note = note;
  state.current = card.id;
  state.log.unshift({ at: new Date().toTimeString().slice(0, 8), text: `${card.name}: ${event}` });
  state.log = state.log.slice(0, 12);
  state.cards = state.cards.slice(-12);
  store.save(state);
  drawBoard();
  document.querySelector('[data-stop="pipeline"]').classList.add("done");
  return card;
}

function openCard(id) {
  const pick = $("#reply-card");
  pick.value = id;
  drawBoard();
}

function drawBoard() {
  const picked = $("#reply-card").value;
  $("#board").replaceChildren(
    ...STAGES.map((stage) =>
      h(
        "div",
        { class: "col" },
        h("h3", null, stage),
        state.cards
          .filter((c) => c.stage === stage)
          .map((c) => {
            const b = h(
              "button",
              { type: "button", class: c.id === picked ? "card picked" : "card", "aria-pressed": String(c.id === picked), title: "Use this card for the next reply" },
              h("strong", null, c.name),
              h("span", null, c.note),
            );
            b.addEventListener("click", () => openCard(c.id));
            return b;
          }),
      ),
    ),
  );
  const pick = $("#reply-card");
  pick.replaceChildren(
    h("option", { value: "" }, "No company: preview only"),
    ...state.cards.map((c) => h("option", { value: c.id }, c.name)),
  );
  pick.value = cardById(picked) ? picked : "";
  $("#log").replaceChildren(
    ...(state.log.length
      ? state.log.map((e) => h("li", null, h("time", null, e.at), h("span", null, e.text)))
      : [h("li", null, h("time", null, ""), h("span", null, "Nothing yet. Every step you run above is written here."))]),
  );
  $("#clear").hidden = state.cards.length === 0;
}

$("#clear").addEventListener("click", () => {
  state = { cards: [], log: [], current: "" };
  store.save(state);
  drawBoard();
});

/* ---------- 1. Research ---------- */

const MOTION = {
  "sales-led": "Sells through sales conversations",
  "product-led": "Sells through self-serve signup",
  hybrid: "Sells both ways: self-serve and through sales",
  ecommerce: "Sells through an online shop",
  unclear: "The homepage does not show a clear way to buy",
};

function renderResearch(d) {
  const name = d.title ? d.title.split(/\s[|–—-]\s/)[0] : d.domain;
  return [
    h(
      "div",
      { class: "cols" },
      h(
        "div",
        null,
        h(
          "div",
          { class: "block account" },
          h("h3", null, name),
          h("p", null, d.outreach.sells || d.description),
          d.outreach.buyer && h("p", null, d.outreach.buyer),
          h("p", { style: "margin-top:16px" }, h("span", { class: "tag" }, MOTION[d.motion])),
          d.motionEvidence.length > 0 &&
            h("p", { class: "quote" }, "Seen on the page: ", d.motionEvidence.map((e) => `“${e}”`).join(", ")),
        ),
        h(
          "div",
          { class: "block" },
          h("h3", null, d.signals.length ? `${d.signals.length} tools found in the page source` : "No known sales or marketing tools in the page source"),
          d.signals.length
            ? h("ul", { class: "finds" }, d.signals.map((s) => h("li", null, h("strong", null, s.label), s.meaning, h("small", null, "Evidence: ", s.evidence))))
            : h("p", null, "Some sites load their tools only after a cookie banner is accepted. A browser-based check would be the next step."),
        ),
      ),
      h(
        "div",
        null,
        h(
          "div",
          { class: "block" },
          h("h3", null, "What I would build first"),
          h("ol", { class: "ideas" }, d.automations.map((a) => h("li", null, h("strong", null, a.title), h("span", null, a.why), h("span", null, a.how)))),
        ),
        h(
          "div",
          { class: "letter", style: "margin-top:16px" },
          h("p", { class: "subject" }, "Subject: ", d.outreach.subject),
          h("p", { class: "text" }, d.outreach.body),
          h("p", { class: "by" }, writtenBy(d.outreach.source), ` Finished in ${seconds(d.timing.totalMs)}.`),
        ),
      ),
    ),
  ];
}

$("#research-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const domain = $("#domain").value;
  $("#research").scrollIntoView();
  run(ev.target, $("#research-out"), "research", "Reading the homepage and drafting the email. This takes a few seconds.", async () => {
    const d = await post("/api/research", { domain });
    record({ name: d.domain }, "Researched", `${d.signals.length} tools, ${d.motion}`, `researched in ${seconds(d.timing.totalMs)}`);
    if (!leadEdited) fill(preset("hot", d.domain));
    return renderResearch(d);
  });
});

/* ---------- 2. Speed to lead ---------- */

function preset(kind, domain) {
  // Die letzte Karte kann auch einen Personennamen tragen. Nur echte Domains taugen
  // als Mail-Adresse.
  const last = cardById(state.current)?.name || "";
  const d = domain || (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(last) ? last : "acme-tools.de");
  return {
    hot: { name: "Alex Example", email: `alex@${d}`, role: "Head of Sales", message: "We lose inbound leads because nobody replies on weekends. Can we get pricing and a demo this month?" },
    vague: { name: "Sam Example", email: "sam.example@gmail.com", role: "", message: "Hi, can you send some info?" },
    junk: { name: "Promo Team", email: "promo@mailinator.com", role: "", message: "We offer guest post and backlink packages for your website." },
  }[kind];
}

function fill(values) {
  const f = $("#lead-form");
  for (const [k, v] of Object.entries(values)) f[k].value = v;
}

// Solange der Besucher nichts selbst getippt hat, folgt das Formular der
// zuletzt recherchierten Firma.
let leadEdited = false;
$("#lead-form").addEventListener("input", () => (leadEdited = true));

document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => fill(preset(b.dataset.preset))));

let ticking;
function countdown(el, minutes) {
  clearInterval(ticking);
  const due = Date.now() + minutes * 60000;
  const tick = () => {
    const left = Math.max(0, due - Date.now());
    el.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
  };
  tick();
  ticking = setInterval(tick, 1000);
}

function renderLead(d) {
  const r = d.routing;
  const clock = h("span", { class: "clock" });
  if (r.slaMinutes) countdown(clock, r.slaMinutes);
  const bar = h("i", { style: "width:0%" });
  requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.width = `${d.score}%`)));
  return [
    h(
      "div",
      { class: "block" },
      h(
        "div",
        { class: "verdict" },
        h("div", { class: `tier ${r.tier}` }, r.tier === "Rejected" ? "×" : r.tier),
        h(
          "div",
          null,
          h("strong", null, r.tier === "Rejected" ? "Rejected" : `Goes to: ${r.owner}`),
          h("p", null, r.action),
          r.slaMinutes ? h("p", null, "A human must reply within ", clock) : null,
        ),
      ),
      h("div", { class: "meter", role: "img", "aria-label": `Score ${d.score} of 100` }, bar),
      h(
        "ul",
        { class: "points" },
        d.lines.map((l) => h("li", { class: l.points < 0 ? "minus" : "" }, h("b", null, l.points > 0 ? `+${l.points}` : l.points), h("span", null, l.reason))),
        h("li", null, h("b", null, d.score), h("span", null, "Score out of 100")),
      ),
    ),
    h(
      "div",
      { class: "block" },
      h("h3", null, `Handled in ${seconds(d.totalMs)}`),
      h("ol", { class: "steps" }, d.steps.map((s) => h("li", null, h("b", null, s.name), h("span", null, s.detail), h("time", null, seconds(s.ms))))),
    ),
    d.reply.text
      ? h("div", { class: "letter", style: "margin-top:16px" }, h("p", { class: "text" }, d.reply.text), h("p", { class: "by" }, writtenBy(d.reply.source)))
      : null,
  ];
}

$("#lead-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const body = { name: f.name.value, email: f.email.value, role: f.role.value, message: f.message.value };
  run(f, $("#lead-out"), "respond", "Validating, enriching, scoring, routing and drafting.", async () => {
    const d = await post("/api/lead", body);
    const domain = body.email.split("@")[1] || "";
    const known = state.cards.find((c) => c.name === domain);
    const name = known ? known.name : body.name || body.email;
    const rejected = d.routing.tier === "Rejected";
    record(
      { name },
      rejected ? "Paused or closed" : "Inbound",
      rejected ? "Rejected at the door" : `Tier ${d.routing.tier}, ${d.routing.owner}`,
      rejected ? "inbound lead rejected" : `inbound lead scored ${d.score}, routed in ${seconds(d.totalMs)}`,
    );
    return renderLead(d);
  });
});

/* ---------- 3. Reply handling ---------- */

document.querySelectorAll("[data-reply]").forEach((b) =>
  b.addEventListener("click", () => {
    $("#reply-form").text.value = b.dataset.reply;
  }),
);

const SEQUENCE = { stop: "Stopped", pause: "Paused", continue: "Keeps running" };
const DECIDED = { rule: "A fixed rule", model: "The language model", template: "Keyword matching, the model was not available" };
const STAGE_FOR = { Meeting: "Meeting", Replied: "In conversation", Paused: "Paused or closed", Closed: "Paused or closed" };

function renderReply(d, card) {
  return [
    card
      ? h("p", { class: "applied" }, "Written to the card ", h("strong", null, card.name), ".")
      : h("p", { class: "applied preview" }, "Preview only. No card was changed. Pick a company above the reply to update its card."),
    h(
      "div",
      { class: "block move" },
      h("p", { class: "kind" }, d.plan.label),
      h("p", null, d.plan.action),
      h(
        "dl",
        { class: "facts" },
        h("dt", null, "Decided by"),
        h("dd", null, DECIDED[d.decidedBy]),
        h("dt", null, "Email sequence"),
        h("dd", null, SEQUENCE[d.plan.sequence]),
        h("dt", null, "Pipeline stage"),
        h("dd", null, STAGE_FOR[d.plan.stage]),
        d.note ? [h("dt", null, d.plan.kind === "needs_review" ? "Why" : "Note"), h("dd", null, d.note)] : null,
        d.ignored ? [h("dt", null, "Not read"), h("dd", null, d.ignored)] : null,
      ),
    ),
    d.draft
      ? h("div", { class: "letter", style: "margin-top:16px" }, h("p", { class: "text" }, d.draft), h("p", { class: "by" }, writtenBy(d.decidedBy === "model" ? "model" : "template")))
      : h(
          "p",
          { class: "empty", style: "margin-top:16px" },
          d.plan.kind === "needs_review"
            ? "No answer is drafted and no next step is suggested until a person has read this reply."
            : "No answer is drafted for this kind of reply. Writing back would be the mistake.",
        ),
  ];
}

$("#reply-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const text = ev.target.text.value;
  // Die Auswahl wird beim Absenden festgehalten. Was danach auf dem Board
  // passiert, ändert nicht mehr, wohin das Ergebnis geschrieben wird.
  const cardId = $("#reply-card").value;
  run(ev.target, $("#reply-out"), "reply", "Reading the reply.", async () => {
    const d = await post("/api/reply", { text });
    let card = null;
    if (cardId) {
      card = record({ id: cardId }, STAGE_FOR[d.plan.stage], d.plan.label, `reply sorted as "${d.plan.label}"`);
      if (!card) throw new Error("The card you picked was removed while the reply was being sorted. Nothing was written.");
    }
    return renderReply(d, card);
  });
});

$("#reply-card").addEventListener("change", drawBoard);

fill(preset("hot"));
drawBoard();
