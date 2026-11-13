# Sales funnel automation, live

Type a company website and watch three sales automations work on it. They
share one pipeline, so each step builds on the one before.

1. **Research.** Reads a public homepage, finds the sales and marketing tools
   behind it, reads the sales motion from its calls to action, picks what to
   pitch and drafts the cold email.
2. **Speed to lead.** Takes a contact form submission, validates the address,
   looks up the company, scores the lead with visible reasons, routes it to an
   owner with a reply deadline and drafts the first answer.
3. **Reply handling.** Classifies a prospect's reply, decides what happens to
   the email sequence and the pipeline stage, and drafts the answer.

## Design decisions

- **Rules decide what must not go wrong.** Scores, routing, detected opt-outs
  and unclear replies are plain functions with tests. The language model sorts
  the remaining replies into one of seven categories and drafts the wording.
- **Only the new text counts.** Quoted history and email footers are set aside
  before any rule runs, so a quoted “unsubscribe” link is not an opt-out.
- **Opt-outs never reach the model.** A fixed rule catches them first.
  Unclear cases pause the sequence and wait for a person.
- **Replies go to the card you pick.** Each card has a stable ID, and the
  choice is fixed when you press the button. Without a pick, the result is a
  preview and no card changes.
- **Drafts promise nothing that does not exist.** No dates, times or booking
  links unless a real booking link is configured.
- **Every model call has a fallback.** On failure or after 12 seconds a
  template is returned and the page says which one was used.
- **Nothing is stored or sent.** No database, no cookies, no emails. The board
  lives in the visitor's browser.
- **No surprise costs.** Free tiers with hard daily limits, plus an
  approximate rate limiter of eight requests per minute per visitor.

## Stack

Cloudflare Workers, Workers AI, TypeScript, Vitest. The page is plain HTML,
CSS and one script, with no build step.

## Run it

```bash
npm install
npm run dev
```

```bash
npm run test:run
```
