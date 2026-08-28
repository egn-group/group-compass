// Group DNA — bare-bones live AI prototype server.
//
// This is intentionally minimal: no database, no auth, no Salesforce.
// It exists to answer one question — does the real 4-prompt pipeline
// (from "AI promptkæde_Group DNA.docx") and the Chair-editing loop
// (spec §11) actually work when hooked up to a real Claude call?
//
// Run: npm install && npm start   (reads ANTHROPIC_API_KEY from .env)
//
// COST NOTES (2026-08-19, added after a 52-cent single run prompted a
// cost review — see project memory for the full discussion):
// 1. Stage 4 ("Final") used to be a real Claude call whose only job was
//    to relabel Stage 2's text as "DEL 1" and Stage 3's text as "DEL 2".
//    It never changed a word. It is now plain string formatting — see
//    buildStage4() below. This removes one full API call (25% of the
//    pipeline) per group, with zero effect on the text a Chair/Admin
//    sees.
// 2. Every Claude call now requests prompt caching on its system prompt
//    (see callClaude's `cache` option). Claude only actually caches a
//    system prompt once it is long enough (roughly ~1024+ tokens for
//    this model) — these stage prompts may be shorter than that today,
//    so don't expect a big saving yet. It costs nothing to have this on,
//    and it starts saving automatically the moment the rubric/template
//    text grows (which it likely will).
// 3. The Notary stage (stage 1) is a mechanical sorting task, not a
//    judgment task, so it can run on a cheaper/faster model without
//    (in theory) losing quality. This is now controlled separately via
//    ANTHROPIC_NOTARY_MODEL — unset by default, so behaviour is
//    unchanged until you opt in. Before relying on it, re-run the 23
//    calibration cases and compare scores to the current model.
// 4. The Auditor stage (stage 3) is no longer run inside /api/pipeline.
//    Per "AI promptkæde_Group DNA.docx" and spec v0.8, the finished DNA
//    text (DEL 1) only ever depends on Stage 1 + Stage 2 — the Auditor
//    only produces the change list (DEL 2), which the spec already
//    makes Admin-only and the UI already hides by default. A 5-case
//    real test (2026-08-19) showed the Auditor call was the single most
//    expensive stage (48-56% of the 3-stage cost) — often more
//    expensive than Notary + Consultant combined. /api/pipeline now
//    returns just stage1 + stage2 + finalDna. The Auditor + the (free,
//    local) Stage 4 formatting now run only on demand, from the new
//    POST /api/change-list route, which an Admin can call "after the
//    fact" — any time later, since the Auditor only ever compares the
//    original structured text (Stage 1) to the Score-5 text (Stage 2),
//    neither of which changes after the fact.
// Console output now logs input/output/cache token counts per call so
// you can see caching and model choice actually taking effect.
// 5. Default model switched claude-sonnet-4-5-20250929 → claude-sonnet-5
//    (2026-08-19, same day). Sonnet 5 is priced lower ($2/$10 per MTok
//    input/output vs Sonnet 4.5's $3/$15) and Anthropic reports it beats
//    4.5 on reasoning/coding/tool-use. Tested against 2 real calibration
//    cases: 27-28% cheaper than 4.5 on the same 3-stage pipeline, no
//    truncation, comparable-to-better DNA text quality in a side-by-side
//    read. Caveat: Sonnet 5 turns on extended "thinking" by default,
//    which spends part of max_tokens on hidden reasoning before writing
//    the visible answer — an early test without the setting below hit
//    the max_tokens cap before any real answer came out. Fixed by
//    passing `thinking: { type: "disabled" }` on every call (confirmed
//    safe to pass unconditionally — Haiku 4.5 and Sonnet 4.5 both accept
//    it too, so switching MODEL or NOTARY_MODEL back to another model
//    doesn't break anything). Only 2 of the 5 calibration cases were
//    tested (Jacob asked to stop early) — worth running the rest, or the
//    full 23-case set, before fully trusting this for launch.
//
// LAST PROTOTYPE FIXES (2026-08-25), before Jacob starts the real build:
// - Admin conversion now accepts an optional group roster (titles +
//   companies), passed only into Stage 2 as grounding context — see
//   /api/pipeline.
// - Every rubrik in the template is now enforced as **bold** markdown
//   (HEADLINE_FORMAT_RULE), added to both Stage 1 and Stage 2.
// - Stage 2 now has explicit objectivity and merger-recency rules
//   (>2-year-old mergers omitted); today's date is passed in so the
//   model can compute recency itself.
// - New POST /api/suggest-improvements: optional, only fires when the
//   Chair has approved every field; returns an empty list rather than
//   inventing filler suggestions.

require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
// Optional cheaper/faster model for the mechanical Notary stage only.
// Falls back to MODEL (i.e. no behaviour change) if not set in .env.
// (Haiku 4.5, at $1/$5 per MTok, is still cheaper than Sonnet 5's $2/$10,
// so this option is still worth having even after the Sonnet 5 switch.)
const NOTARY_MODEL = process.env.ANTHROPIC_NOTARY_MODEL || MODEL;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key before starting."
  );
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

/* ============================================================
   In-memory store for the 3-step demo (Admin conversion →
   Network Advisor comment → Chair review). No database — this
   resets whenever the server restarts, which is fine for a
   bare-bones prototype. Shape matches the client's `fields()`
   helper in chair-groups-live.html exactly, so the Chair page
   can merge these straight into its own GROUPS array.
   ============================================================ */
let launchedGroups = [];

function slugify(str) {
  return (
    String(str || "group")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "group"
  );
}

// Very approximate splitter: looks for the DNA template's own section
// headers (GRUPPEPROFIL / MEDLEMSPROFIL / VIRKSOMHEDSPROFIL) to break the
// Admin-approved DNA text into the same 3 fields the Chair review screen
// expects. If the model didn't include those headers verbatim, everything
// falls into "group" rather than silently dropping content.
function grabSection(text, startRe, endRe) {
  const s = text.search(startRe);
  if (s < 0) return "";
  const rest = text.slice(s + 1);
  const e = endRe ? rest.search(endRe) : -1;
  const chunk = e >= 0 ? text.slice(s, s + 1 + e) : text.slice(s);
  return chunk.trim();
}

function splitIntoFields(finalDna) {
  const text = finalDna || "";
  let group = grabSection(text, /GRUPPEPROFIL/i, /MEDLEMSPROFIL/i);
  let member = grabSection(text, /MEDLEMSPROFIL/i, /VIRKSOMHEDSPROFIL/i);
  let company = grabSection(text, /VIRKSOMHEDSPROFIL/i, null);
  if (!group && !member && !company) {
    group = text.trim();
  }
  return { group, member, company };
}

// `cache: true` (the default) marks the system prompt as an ephemeral
// prompt-cache breakpoint. On calls whose system prompt exactly matches a
// prior call's, Claude re-uses the cached read instead of billing full
// price for those input tokens. Stage prompts are fixed text reused on
// every group, so repeat calls (2nd group onward, per stage) are the
// ones that benefit — the first call of each stage just pays a small
// one-time "cache write" premium.
async function callClaude(system, userContent, opts = {}) {
  const { maxTokens = 2000, model = MODEL, cache = true, label = "" } = opts;
  const t0 = Date.now();
  const resp = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    // Sonnet 5 turns on extended thinking by default, which spends part
    // of max_tokens on hidden reasoning before writing the visible
    // answer — this pipeline wants a plain, predictable answer every
    // time, not a reasoning trace. Confirmed safe to pass on every
    // model (Haiku 4.5 and Sonnet 4.5 both accept it too), so this
    // doesn't need to change if MODEL or NOTARY_MODEL point elsewhere.
    thinking: { type: "disabled" },
    system: cache
      ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
      : system,
    messages: [{ role: "user", content: userContent }],
  });
  const u = resp.usage || {};
  console.log(
    `[claude]${label ? " " + label : ""} model=${model} ms=${Date.now() - t0} ` +
      `in=${u.input_tokens ?? "?"} ` +
      `cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} ` +
      `out=${u.output_tokens ?? "?"}`
  );
  return resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/* ============================================================
   STAGE SYSTEM PROMPTS
   Adapted directly from "AI promptkæde_Group DNA.docx" (Jacob's
   own drafted prompt chain) and spec §7-9. Kept in Danish because
   DNA content is processed in its source language (spec §14);
   only the tool's own UI/labels are in English.
   ============================================================ */

// NOTE (2026-08-19): a Danish-only orthography guardrail was added here
// earlier today, after Jacob found a real generation error in "Edit with
// AI" (the model wrote "specialiströller" using "ö", which doesn't exist
// in Danish). Removed again the same day on Jacob's instruction: this
// pipeline will also run in other languages, including Swedish, where
// "ö" is a normal, correct letter — a hard-coded Danish-only rule would
// have broken that. Left as a note in case this class of error resurfaces
// and needs a language-aware (not Danish-only) fix instead.

const TEMPLATE_SHAPE = `GRUPPEPROFIL
**Hvem er gruppen for**
**Hvad får man**
**Hvad kendetegner gruppen**
**Udviklingsfokus**

MEDLEMSPROFIL
**Titler / erfaring**
**Ledelsesspænd**
**Matcher / matcher ikke**

VIRKSOMHEDSPROFIL
**Størrelse / type**
**Branche / marked**
**Matcher / matcher ikke**`;

// Formatting rule shared by both stages that write text into the
// template, so every underlying rubrik comes out the same way no
// matter which model runs the stage. Added 2026-08-25 after testing
// showed some outputs used plain text or "- " bullets for a rubrik
// instead of bold markdown.
const HEADLINE_FORMAT_RULE = `Formatregel for rubrikker: hver rubrik (fx "Hvem er gruppen for") SKAL skrives præcis som **Rubrik** — fed markdown, to stjerner på hver side, ingen "#", ingen "- " foran, ingen almindelig tekst uden fed. Denne regel gælder for alle 9 rubrikker i skabelonen, hver gang.`;

const STAGE1_NOTARY_SYSTEM = `Du er "Notaren" i en 4-trins redigeringskæde for Group DNA-tekster.

Din eneste opgave er at STRUKTURERE den rå tekst ind i denne skabelon — IKKE omskrive den:
${TEMPLATE_SHAPE}

${HEADLINE_FORMAT_RULE}

Regler:
- Behold 100% af den originale ordlyd. Ingen forkortelser, ingen omskrivning, ingen tilføjelser.
- Fordel sætninger fra input i de rigtige felter, selvom kilden ikke selv er struktureret sådan.
- Hvis noget indhold optræder to gange i kilden (fx samme oplysning nævnt i to forskellige felter), bevar det begge steder eller det mest retvisende sted — smid ikke information væk.
- Hvis et felt slet ikke har indhold i kilden, skriv præcis: (ikke eksplicit defineret). Opfind aldrig indhold her.
- Output kun den strukturerede tekst, ingen forklaring, ingen indledning.`;

const STAGE2_CONSULTANT_SYSTEM = `Du er "Den stramme konsulent" i en 4-trins redigeringskæde for Group DNA-tekster.

Du modtager en struktureret (men endnu urevideret) Group DNA-tekst. Din opgave er at omskrive den til en operationel Score-5 version, der kan bruges direkte til salg, rekruttering, sammensætning og kvalitetssikring.

Følg denne skabelon:
${TEMPLATE_SHAPE}

${HEADLINE_FORMAT_RULE}

Vigtige kvalitetsregler (tilføjet 2026-08-25):
- Teksten skal være OBJEKTIV, ikke subjektiv. Skriv ikke i vurderende eller følelsesladet sprog (fx "fantastisk", "unik", "vi er stolte af") — beskriv gruppen faktuelt, så en læser selv kan afgøre om den matcher.
- Hvis kildematerialet nævner en tidligere fusion mellem grupper, skal det KUN medtages hvis fusionen er sket for højst 2 år siden. Du får dags dato nedenfor i brugerbeskeden — brug den til at afgøre om fusionen er inden for de 2 år. Er fusionen ældre end 2 år (eller er der ingen dato at gå efter, men det tydeligt fremgår at det er "gammel historie"), skal den udelades helt — den er ikke relevant for en operationel Group DNA-tekst.

Vejledning pr. felt:
- Hvem er gruppen for: rolle, niveau, geografi, størrelse (ansatte som primær), omsætning (sekundær).
- Hvad får man: hvad medlemmet reelt køber og hvilken værdi det skaber. Ingen temalister.
- Hvad kendetegner gruppen: hvorfor denne gruppe vælges, hvad adskiller den.
- Udviklingsfokus: retning — hvad skal løftes eller ændres.
- Titler/erfaring: skal skabe ensartet niveau. Ledelsesspænd: skal sikre sammenlignelig kompleksitet.
- Matcher/matcher ikke (begge steder): skal gøre det muligt entydigt at sige ja/nej.

Fjern: historik, "kan også"-formuleringer, undtagelser, temalister, bløde formuleringer, alder som kriterie medmindre det er tydeligt afgørende.
Bevar: diversitet (fx køn), generationsskifte, sociale styrker (men som sekundært, ikke som primær identitet).

Hvis et felt er tomt i kilden (står som "(ikke eksplicit defineret)"), må du konstruere reelt, forankret indhold ud fra det, gruppen tydeligvis gør og er for — men konstruer aldrig noget, der modsiger kilden. Hvis der slet ikke er noget grundlag at bygge på (fx et felt om organisatorisk kompleksitet, hvor intet i kilden antyder noget som helst), behold "(ikke eksplicit defineret)" i stedet for at gætte.

Resultatet skal være kortere, skarpere og mere operationelt end kilden.
Output kun selve DNA-teksten i skabelonform, ingen forklaring, ingen sammenligning.`;

const STAGE3_AUDITOR_SYSTEM = `Du er "Revisoren" i en 4-trins redigeringskæde for Group DNA-tekster.

Du får den ORIGINALE strukturerede tekst og den NYE Score-5 version. Lav en præcis ændringsliste.

For hver ændring:
1. Citér den originale formulering (eksakt tekst).
2. Angiv hvad der er sket: fjernet / komprimeret / omskrevet / flyttet / tilføjet (brug "tilføjet" når noget er konstrueret, fordi feltet var tomt i originalen).
3. Forklar hvorfor, kort og konkret.

Kategorisér hver ændring i én af disse:
- Fjernet pga. uklarhed
- Fjernet pga. støj (historik, mødeform, metadata)
- Fjernet pga. svag værdi
- Fjernet pga. manglende selektion
- Temaliste fjernet
- Blød formulering fjernet
- Tilføjet pga. manglende indhold (fremhæv disse tydeligt — de bør bekræftes af Network Advisor/Chair, fordi det er nyt indhold, ikke omskrivning)

Vær konkret og brug eksakt tekst fra originalen. Undgå generelle forklaringer.
Output kun selve ændringslisten, ingen indledning.`;

// STAGE4_FINAL_SYSTEM is no longer called (see buildStage4() below and
// the cost note at the top of this file) — kept here only as a
// reference of what the old stage 4 prompt said, and in case a future
// change to the pipeline needs it back as a real Claude call.
const STAGE4_FINAL_SYSTEM = `Du er sidste trin i en 4-trins redigeringskæde for Group DNA-tekster. Du får Score-5-teksten og ændringslisten fra de foregående trin. Saml dem i to dele:

DEL 1: OPDATERET GROUP DNA
Ren tekst, klar struktur, klar til brug i salg. Ingen sammenligning med originalen her.

DEL 2: HVAD ER ÆNDRET FRA ORIGINALEN
For hver ændring: original formulering, hvad der er gjort, hvorfor. Kort og præcist.

Vigtigt: ingen score, ingen numerisk vurdering, ingen metodeforklaring nogen steder i outputtet — kun det brugeren skal bruge.`;

// Replaces the old Stage 4 Claude call. Stage 4 never generated new
// content — it only wrapped Stage 2's text as "DEL 1" and Stage 3's
// text as "DEL 2". Doing that with a template string instead of an API
// call produces byte-identical structure with zero API cost and zero
// latency for this stage.
// Models sometimes format section titles as markdown headings ("#
// GRUPPEPROFIL") even though the prompt asks for plain skabelon text —
// confirmed happening on the Sonnet 4.5 baseline during the 2026-08-19
// model comparison test. The old client-side code used to strip these
// before display; that got dropped when finalDna was simplified during
// the Auditor-deferral change earlier the same day. Restored here,
// server-side, so it applies no matter which model is in use.
function cleanFinalDna(stage2) {
  return stage2.trim().replace(/^#+\s*/gm, "").trim();
}

function buildStage4(stage2, stage3) {
  return (
    `DEL 1: OPDATERET GROUP DNA\n\n${stage2.trim()}\n\n` +
    `DEL 2: HVAD ER ÆNDRET FRA ORIGINALEN\n\n${stage3.trim()}`
  );
}

/* ============================================================
   Route: run the DNA-generating half of the pipeline (Notary +
   Consultant) on raw DNA text. Returns the finished DNA text
   (finalDna, = Stage 2's output) right away. The Auditor stage (the
   change list) is deliberately NOT run here — see POST
   /api/change-list below and the cost note at the top of this file.
   ============================================================ */
app.post("/api/pipeline", async (req, res) => {
  try {
    const { groupProfile = "", memberProfile = "", companiesProfile = "", roster = "" } = req.body;
    const rawInput =
      `GROUP PROFILE (raw):\n${groupProfile}\n\n` +
      `MEMBER PROFILE (raw):\n${memberProfile}\n\n` +
      `COMPANIES PROFILE (raw):\n${companiesProfile}`;

    const stage1 = await callClaude(STAGE1_NOTARY_SYSTEM, rawInput, {
      model: NOTARY_MODEL,
      label: "stage1-notary",
    });

    // The roster (titles + companies) is grounding context only — it goes
    // into Stage 2 (the Consultant, which sharpens Member/Companies
    // profile), not Stage 1 (the Notary, which only re-structures the raw
    // profile text and must not take on new input sources).
    const todayStr = new Date().toISOString().slice(0, 10);
    const stage2UserParts = [
      `Dags dato: ${todayStr}`,
      `Struktureret original (fra trin 1):\n\n${stage1}`,
    ];
    if (roster && roster.trim()) {
      stage2UserParts.push(
        `Gruppens deltagerliste (titel + virksomhed pr. medlem). Brug dette til at skærpe ` +
        `Medlemsprofil og Virksomhedsprofil — men opfind ikke noget der modsiger kilden ovenfor:\n\n${roster.trim()}`
      );
    }
    const stage2 = await callClaude(
      STAGE2_CONSULTANT_SYSTEM,
      stage2UserParts.join("\n\n---\n\n"),
      { label: "stage2-consultant" }
    );

    res.json({ stage1, stage2, finalDna: cleanFinalDna(stage2) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Pipeline call failed." });
  }
});

/* ============================================================
   Route: generate the Auditor change list "after the fact" — on
   demand, whenever an Admin actually opens it, rather than on every
   conversion. Takes the Stage 1 + Stage 2 text the client already has
   from /api/pipeline (this demo has no database, so the client is the
   simplest place to hold them meanwhile; a real backend would instead
   look these up by group id). Safe to call any time later: the Auditor
   only ever compares Stage 1 to Stage 2, and neither changes after the
   fact.
   ============================================================ */
app.post("/api/change-list", async (req, res) => {
  try {
    const { stage1 = "", stage2 = "" } = req.body;
    if (!stage1.trim() || !stage2.trim()) {
      return res.status(400).json({ error: "Missing stage1 and/or stage2 text." });
    }

    const stage3 = await callClaude(
      STAGE3_AUDITOR_SYSTEM,
      `ORIGINAL (trin 1):\n\n${stage1}\n\n---\n\nNY SCORE-5 VERSION (trin 2):\n\n${stage2}`,
      // Tested 2026-08-19 against 5 real calibration cases: the default
      // 2000-token cap silently cut the change list off mid-sentence in
      // ALL 5 cases (a pre-existing bug, unrelated to the cost changes
      // above). Raised to 8000 — the largest real change list seen in
      // testing needed 4993 tokens, so this leaves real headroom. Claude
      // only bills for tokens it actually writes, so this costs nothing
      // extra except on the genuinely long cases that need it.
      { maxTokens: 8000, label: "stage3-auditor" }
    );
    const stage4 = buildStage4(stage2, stage3);

    res.json({ stage3, stage4 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Change-list call failed." });
  }
});

/* ============================================================
   Route: Chair "Edit with AI" assistant (spec §11)
   ============================================================ */
const CHAIR_CHAT_SYSTEM = `Du hjælper en Chair (gruppeformand) med at redigere ét felt i et Group DNA. Chair kan bede dig om at indarbejde en Network Advisors kommentar, eller bede dig gøre teksten skarpere/kortere/mere operationel.

Regler:
- Foreslå ny tekst for feltet, i samme skabelon-stil som originalen.
- Skriv en kort note (1 sætning) om hvad du har ændret og hvorfor.
- Nævn ALDRIG en score, et tal, eller en kvalitetsvurdering. Ingen metodeforklaring.
- Chair beslutter altid selv — du foreslår, du bestemmer ikke.
- VIGTIGT: Hvis Chairs besked IKKE giver nok mening eller information til at lave en meningsfuld redigering — fx tilfældige bogstaver/tegn, en enkelt stavelse, eller en besked der ikke ligner en redigeringsinstruks — må du IKKE opfinde en ændring. Spørg i stedet Chair hvad de gerne vil ændre. Brug dette format i så fald (kun denne ene linje, ingen TEKST/NOTE):
SPØRGSMÅL: <kort, venligt spørgsmål om hvad Chair gerne vil have ændret>
- Ellers, hvis beskeden giver mening, svar i dette præcise format (to linjer, ingen ekstra tekst):
TEKST: <den foreslåede nye feltekst>
NOTE: <kort forklaring>`;

app.post("/api/chat", async (req, res) => {
  try {
    const { fieldLabel, currentText, naComment, userMessage } = req.body;
    const parts = [
      `Feltnavn: ${fieldLabel}`,
      `Nuværende tekst:\n${currentText}`,
    ];
    if (naComment) {
      parts.push(`Network Advisors kommentar:\n${naComment}`);
    }
    parts.push(`Chairs besked: ${userMessage}`);

    const raw = await callClaude(CHAIR_CHAT_SYSTEM, parts.join("\n\n"), {
      maxTokens: 800,
      label: "chair-chat",
    });

    // The model can decline to propose an edit when the Chair's message
    // doesn't give it enough to work with (see the SPØRGSMÅL rule above) —
    // in that case it asks a clarifying question instead of fabricating a
    // "proposal" out of nonsense input.
    const questionMatch = raw.match(/SPØRGSMÅL:\s*([\s\S]*)/i);
    if (questionMatch) {
      return res.json({ clarifyingQuestion: questionMatch[1].trim(), raw });
    }

    const textMatch = raw.match(/TEKST:\s*([\s\S]*?)\nNOTE:/i);
    const noteMatch = raw.match(/NOTE:\s*([\s\S]*)/i);

    res.json({
      proposedText: textMatch ? textMatch[1].trim() : raw.trim(),
      note: noteMatch ? noteMatch[1].trim() : "",
      raw,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Chat call failed." });
  }
});

/* ============================================================
   Route: post-edit AI quality feedback (spec §11 guardrail)
   ============================================================ */
const EDIT_FEEDBACK_SYSTEM = `Du giver en Chair kort, konstruktiv feedback lige efter Chair selv har redigeret et felt i et Group DNA.

Regler:
- Maks 1-2 sætninger.
- Vurdér KUN om feltet stadig er operationelt og skarpt (kan man bruge det til at sige klart ja/nej i matching?).
- Nævn ALDRIG en score, et tal, eller ordet "score". Ingen metodeforklaring.
- Feedbacken blokerer aldrig for at gemme — den er ren rådgivning.
- Svar kun med selve feedback-teksten, intet andet.`;

app.post("/api/edit-feedback", async (req, res) => {
  try {
    const { fieldLabel, oldText, newText } = req.body;
    const content = `Felt: ${fieldLabel}\n\nFør Chairs redigering:\n${oldText}\n\nEfter Chairs redigering:\n${newText}`;
    const feedback = await callClaude(EDIT_FEEDBACK_SYSTEM, content, {
      maxTokens: 200,
      label: "edit-feedback",
    });
    res.json({ feedback: feedback.trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Feedback call failed." });
  }
});

/* ============================================================
   Routes: the 3-step demo handoff
   1) Admin approves a converted DNA on ai-pipeline-test.html
   2) A Network Advisor comments on it on na-review.html
   3) It shows up in the Chair's "Needs your review" list on
      chair-groups-live.html, using the AI-assisted review flow
      already built above.
   ============================================================ */
app.post("/api/launch", (req, res) => {
  try {
    const { groupName, chairName, naName, finalDna } = req.body;
    if (!groupName || !groupName.trim()) {
      return res.status(400).json({ error: "Missing group name." });
    }
    if (!finalDna || !finalDna.trim()) {
      return res.status(400).json({ error: "Missing the finished DNA text." });
    }

    const cleanName = String(groupName).replace(/\s*\([^)]*\)\s*$/, "").trim();
    const chair = (chairName && chairName.trim()) || "Chair (demo)";
    const na = (naName && naName.trim()) || "Network Advisor (demo)";
    const parts = splitIntoFields(finalDna);

    let id = slugify(cleanName);
    if (launchedGroups.some((g) => g.id === id)) {
      id = id + "-" + (launchedGroups.length + 1);
    }

    const dnaFields = ["group", "member", "company"].map((fid) => ({
      id: fid,
      label: fid === "group" ? "Group profile" : fid === "member" ? "Member profile" : "Companies profile",
      text: parts[fid] || "(not generated by this run)",
      naComment: null,
      naResolved: true,
      naResolution: null,
      naExpanded: false,
      approved: false,
    }));

    const group = {
      id,
      name: cleanName,
      chair,
      country: "Denmark",
      na,
      status: "waitingNA",
      approvedAt: null,
      exportedAt: null,
      lastUpdateText: "Launched · invitation sent to " + na + " · just now",
      daysAgo: 0,
      dnaFields,
    };

    launchedGroups.push(group);
    res.json({ group });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Launch failed." });
  }
});

app.get("/api/groups", (req, res) => {
  res.json(launchedGroups);
});

/* ============================================================
   Route: optional improvement suggestions, offered once a Chair has
   approved every field of a Group DNA. Not a required step — the AI
   only proposes something when it sees a clear, concrete candidate
   (a contradiction between fields, a field still saying "not
   defined", etc.). Returns an empty list when there is nothing
   obvious to flag, rather than inventing filler suggestions.
   ============================================================ */
const SUGGEST_IMPROVEMENTS_SYSTEM = `Du gennemgår et FÆRDIGT Group DNA (alle felter er godkendt af Chair). Din opgave er at pege på op til 3 KONKRETE forbedringsforslag — kun hvis der er tydelige, indlysende kandidater. Led ikke efter problemer for problemernes skyld.

Regler:
- Foreslå kun noget hvis det er tydeligt og konkret (fx en selvmodsigelse mellem to felter, en utydelig "matcher/matcher ikke"-regel, eller et felt der stadig indeholder "(ikke eksplicit defineret)").
- Hvis der ikke er noget oplagt at forbedre, svar med præcis: INGEN FORSLAG
- Ellers svar med præcis én linje pr. forslag, i dette format (ingen anden tekst):
FELT: <feltnavn, nøjagtig som givet> | FORSLAG: <kort, konkret forslag i én sætning>
- Maks 3 forslag.`;

app.post("/api/suggest-improvements", async (req, res) => {
  try {
    const { fields } = req.body;
    if (!Array.isArray(fields) || !fields.length) {
      return res.status(400).json({ error: "Missing fields." });
    }
    const content = fields
      .map((f) => `Felt: ${f.label}\n${f.text}`)
      .join("\n\n---\n\n");
    const raw = await callClaude(SUGGEST_IMPROVEMENTS_SYSTEM, content, {
      maxTokens: 500,
      label: "suggest-improvements",
    });
    if (/INGEN FORSLAG/i.test(raw.trim())) {
      return res.json({ suggestions: [] });
    }
    const suggestions = [];
    raw.split("\n").forEach((line) => {
      const m = line.match(/FELT:\s*(.+?)\s*\|\s*FORSLAG:\s*(.+)/i);
      if (m) { suggestions.push({ fieldLabel: m[1].trim(), suggestion: m[2].trim() }); }
    });
    res.json({ suggestions: suggestions.slice(0, 3) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Suggestion call failed." });
  }
});

app.post("/api/na-comment", (req, res) => {
  try {
    const { groupId, comments } = req.body;
    const group = launchedGroups.find((g) => g.id === groupId);
    if (!group) {
      return res.status(404).json({ error: "Group not found — it may have been reset when the server restarted." });
    }
    if (!Array.isArray(comments) || !comments.length) {
      return res.status(400).json({ error: "No comments provided." });
    }
    comments.forEach(({ fieldId, comment }) => {
      const f = group.dnaFields.find((x) => x.id === fieldId);
      if (f && comment && comment.trim()) {
        f.naComment = comment.trim();
        f.naResolved = false;
        f.naResolution = null;
      }
    });
    group.status = "chairReview";
    group.lastUpdateText = group.na + " commented on " + comments.length + " field" + (comments.length === 1 ? "" : "s") + " · just now";
    group.daysAgo = 0;
    res.json({ group });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Comment failed." });
  }
});

app.listen(PORT, () => {
  console.log(`Group DNA live prototype running at http://localhost:${PORT}`);
  console.log(`  - Step 1, Admin conversion:      http://localhost:${PORT}/ai-pipeline-test.html`);
  console.log(`  - Step 2, Network Advisor:        http://localhost:${PORT}/na-review.html`);
  console.log(`  - Step 3, Chair review (live):    http://localhost:${PORT}/chair-groups-live.html`);
});
