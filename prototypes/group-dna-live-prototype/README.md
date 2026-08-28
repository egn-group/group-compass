# Group DNA — live AI prototype (bare bones)

This is a small, local-only prototype that answers one question: **does the
real Group DNA AI pipeline and Chair-editing loop actually work when wired
to a real Claude call?**

It is not the production app. There is no database, no auth, no Salesforce
integration. It runs on your own machine, using your own Anthropic API key.

## The 3-step flow

This prototype links one real DNA through the three roles in the spec's
lifecycle, skipping the intermediate steps that don't need a live demo:

1. **Admin conversion** (`ai-pipeline-test.html`) — pick a raw sample (or
   paste your own), run the real 4-prompt chain, review the finished DNA
   (the 4 technical stages, including the change list, are tucked into a
   collapsed "show technical stages" section — optional detail for an
   admin, not the main event), then click **Approve**. In the real app this
   maps to "ready for launch"; here it launches immediately.
2. **Network Advisor comment** (`na-review.html`) — whatever you just
   approved shows up here, waiting for a comment. Add a note on any field,
   click **Send to Chair**.
3. **Chair review** (`chair-groups-live.html`) — the group now appears in
   the Chair's "My groups" table with status "Needs your review", NA
   comment attached, ready for the same AI-assisted review flow (Include /
   Disregard / Edit with AI / post-edit feedback) already built for the 5
   mock groups.

Each page has a small stepper in the header so you can jump between steps
manually too. The 5 starting groups in step 3 are still mock data — only a
DNA you actually run through steps 1–2 arrives there for real. This link is
in-memory only (`server.js` holds it in a plain array) and resets whenever
you restart the server — there's no database in this prototype.

## What's in here

- `server.js` — a small Express server. It holds your API key (via `.env`,
  never sent to the browser) and exposes:
  - `POST /api/pipeline` — runs the real 4-prompt chain (Notary → Strict
    Consultant → Auditor → Final) on raw Group DNA text.
  - `POST /api/chat` — the Chair "Edit with AI" assistant (used by the chat
    panel and by the NA-comment "Include" button).
  - `POST /api/edit-feedback` — the short AI quality note shown after a
    Chair manually edits a field.
  - `POST /api/launch`, `GET /api/groups`, `POST /api/na-comment` — the
    in-memory handoff that links steps 1 → 2 → 3 above.
- `public/ai-pipeline-test.html` — step 1, Admin conversion.
- `public/na-review.html` — step 2, Network Advisor comment.
- `public/chair-groups-live.html` — step 3, Chair "My groups" + DNA review,
  with "Edit with AI", "Include", and post-edit feedback calling the real
  endpoints above instead of scripted responses.

## Setup (one time)

1. Make sure Node.js is installed (v18 or newer).
2. In this folder, run:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```
4. Open `.env` and paste your own Anthropic API key after `ANTHROPIC_API_KEY=`.
   **Never share this file or commit it anywhere.** `.gitignore` already
   excludes it, and it is not included in anything I deliver back to you.

## Run it

```
npm start
```

Then open in your browser, starting with step 1:

- Step 1, Admin conversion: http://localhost:3000/ai-pipeline-test.html
- Step 2, Network Advisor comment: http://localhost:3000/na-review.html
- Step 3, Chair review (live): http://localhost:3000/chair-groups-live.html

Leave the terminal window open while you use the prototype — closing it
stops the server. Stop it any time with Ctrl+C.

## Notes on the real API key

- The key lives only in your local `.env` file, read via `process.env.ANTHROPIC_API_KEY`.
- It is never written into any HTML/JS file, never sent to the browser, and
  never logged.
- Default model is `claude-sonnet-4-5-20250929`; override with
  `ANTHROPIC_MODEL=...` in `.env` if you want to test a different one.

## Known finding worth flagging

Running Stage 1 (the Notary) on genuinely messy real sample text
("Sikkerhedschefer 1") showed some imperfect sentence categorization —
content that arguably belongs under "Hvad kendetegner gruppen" ended up
split oddly between "Hvad får man" and "Udviklingsfokus". This is real
model behavior, not a bug in this prototype — worth keeping in mind before
trusting Stage 1 output unreviewed on messy raw input.
