# Frontend design brief (Next.js workspace)

The UI contract. The model, validation, segmentation and explanations are done and are
reached through `Service` (`STREAMLIT_HANDOFF.md`) or HTTP (`GRAPH_BACKEND_HANDOFF.md`).
This document decides what the interface is, not how it is coded.

Backend shape this assumes: one Vercel project, two services. `frontend/` (Next.js) at `/`,
FastAPI at `POST /api/predict` only. Everything else is copied from `backend/artifacts/ui_graph/`
into `frontend/data/` at build and served from the CDN. `/api/planning` is a client-side filter
over `scored_households.json` (454 KB, 484 rows), not a network call.

---

## What the product is

> "The ordered list is the product." The estimate ranks households for a human follow-up
> assessment; it is not an eligibility decision.

The interface is a prioritisation instrument under scarcity, with visible humility. It is
not a dashboard and the headline number is not a verdict.

Three facts that are never behind a tooltip (the backend docs say to show them alongside
the number):

- **61% of held-out households were food insecure**, so always answering "insecure" scores 61%.
- **Bands are descriptive, not calibrated assistance categories.**
- **`top_factors` are prediction sensitivities, not causes, and do not sum.**

---

## One system, three lenses

One shell, one design system, one data layer. A segmented mode control in the chrome changes
what the same `predict()` result emphasises; it never changes which data exists.

| Element | Field | Desk | Review |
|---|---|---|---|
| Headline | "High risk - assess" | "Rank 12 of 277 matching" | `p = 0.9119` |
| Probability | hidden by default | small grey tabular column | full, with calibration reference |
| Band | word + ramp chip, large | ramp chip only | word + "descriptive, not calibrated" inline |
| Factors | top 3, plain words | top inline, rest on expand | all 20, with `mean_abs`, `share_increasing`, domain shares |
| `area_context` | "where this household was surveyed" | inline chip | own panel (40.2% of total sensitivity) |
| Caveats | one line, always visible | column + tooltip | full block with source note |
| Sufficiency | "11/14, 9 needed" meter | hidden (list rows are complete) | `min_answers` provenance |
| Primary action | print card / next household | add to plan / export CSV | cite metric + protocol |
| Type | 18px body, 24px rhythm | 13px tabular, 18px rhythm | 16px, 68ch measure, serif headings |

Density is a custom-property scale (`--text-base`, `--row-h`, `--gap`), not a second design.

---

## Routes

| Route | Lead lens | Content | Source |
|---|---|---|---|
| `/` | Situation + Assess | the landing, specified below | static + one POST |
| `/assess` | Field | 14-question form, score card, print output | live predict |
| `/plan` | Desk | 484-row rank table, capacity slider, CSV | static |
| `/situation` | Desk/Review | bands, raw histogram, 11 region cards | static |
| `/segments` | Review | 5 cluster profiles as z-score bars | static |
| `/areas` | Field/Review | searchable 427 areas + verification quality | static |
| `/spatial` | Review | licensed admin-1 choropleth of reportable regional held-out aggregates + selected area labels | static |
| `/knowledge` | — | knowledge centre: articles from `frontend/content/knowledge/`, offline search, cited AI answers via `/api/knowledge/ask`, further reading, offline library | static |
| `/method` | Review | confusion matrix, 4-family comparison, form comparison, caveats | static + 3 PNGs |
| `/batch` | Desk | CSV upload, ranked output, download | live predict_batch |

## Landing (`/`) - orient, then act

Two zones. Left is orientation (build-time JSON, paints instantly); right is the launcher,
sticky, and it never moves the page.

Left, fold 1: `n_households` 484 with "2021/22 held-out"; the 61% baseline; band counts as a
ramp bar (High 219 / Moderate 78 / Low 187); the line "119 of 484 score above 0.90"; compact
region cards; suppressed regions rendered **in position, hatched, with their own note**
("Not surveyed in Wave 5 (conflict); no forecasts or outcomes").

Right, fold 1: the area picker, `Start assessment` (expands the rail into the form in place;
URL becomes `/assess`), a resume-draft row, a recent-on-this-device list, and the ranking
caveat. The launcher is the same box the score card appears in, so the context on the left
stays visible while the result is read.

Fold 2: the raw 10-bin histogram (`39 51 41 33 33 31 37 41 59 119`) - shape, not smoothing.
Fold 3: segment z-score profiles, top domain drivers, link to Plan.

Why Situation and Assess share the landing: the baseline must be seen **before** the first
score, not after it. That is the honesty principle implemented structurally rather than as a
disclaimer. Nothing on the landing touches the network except scoring, so skeletons are sized
to the score card and a spinner is never used.

---

## Design tokens

- **Surface** white cards on a cool grey page, a deep navy header and footer (`#0b2a45`), in
  the register of international-development institutions. No dark mode in v1 (fights print,
  turns the ramp into a game HUD).
- **Risk ramp** four steps, dry straw to deep clay, monotonic in lightness so it survives
  greyscale print and colour-vision deficiency. **No red/green**: green reads "eligible/safe",
  red reads "punished", and this gets printed.
- **Accent** one blue (`#1a5d97`), for interaction only (links, buttons, focus, selection), never
  for risk. Blue interaction against a straw-to-clay risk ramp means a control can never be read
  as a risk level.
- **Type** Inter with `Noto Sans Ethiopic`, both self-hosted by `next/font`; Latin digits only;
  `font-variant-numeric: tabular-nums` globally.
- **Numbers** 3 decimals maximum. `0.5211760401725769` renders `0.52`. Raw float precision
  implies accuracy the model does not claim.
- **Motion** none for risk changes; row reorder only, at most 120ms. Never tween a number up.
- **Print stylesheet is v1.** Both the assessment card and the ranked list get printed and
  carried into the field.
- **Components** AreaSearch, QuestionField (5 dtypes from schema), DerivedChip,
  SufficiencyMeter, ScoreCard, FactorBar, RampChip, CaveatBlock, ProvenanceChip, RegionCard
  (+ suppressed state), Histogram, ZScoreBars, RankTable, CapacitySlider, DensityToggle,
  LangToggle, Skeleton.

## Provenance chips

Every metric carries a chip naming its own protocol. This is also how a real inconsistency is
handled rather than hidden:

- `comparison.json` -> GCN accuracy 0.7704, ROC-AUC 0.8499
- `performance.json` -> five-split accuracy 0.7844, ROC-AUC 0.8555

Same model, two headline numbers. Chips label each one (`held-out - seed 0 - n=484 - agri14`
vs `five-split mean - seeds 0-4 - agri14`). Two numbers must never meet without their
protocol attached.

---

## The assessment form

Built from data, not JSX: `/api/schema?full=false` returns the 14 deployed questions with
`dtype`, `min`, `max`, `allowed_values`, `median_default`, `required`.
`field_labels.json` and `field_help.json` are ready-written UI copy; use them rather than
inventing text.

- Sufficiency meter shows `n_predictive_supplied` against `min_answers` (9). Below the
  minimum, render the backend's own warning text, not an error.
- Derived values render as read-only chips (`=> 2.06 TLU`, household size, dependency ratio)
  from `derived_fields()`. Expose the TLU weights (cattle 0.6, sheep/goat 0.1, chicken 0.01)
  and the note that it is an approximation.
- Score card leads with rank-flavoured words; the probability is small and grey; the band word
  carries "descriptive"; the 61% caveat is permanently visible.
- `area_context` gets distinct treatment - it is 40.2% of total sensitivity in `drivers.json`
  and is the first thing a reviewer will ask about.
- Drafts and recents persist to `localStorage`, labelled as device-only. The form states that
  names and identifiers should not be entered: `predict` rejects unknown field names.
- Enter scores. `Ctrl/Cmd+K` searches areas. No network until the score button is pressed.

## The plan table

- The capacity slider is the page. `capacity_plan` returns `selected`, `unscored`, `note`,
  `precision_note`; check `n_rankable` before drawing the widget.
- `historical_precision_at_25pct` is a past measurement at one coverage level, **not a
  forecast**. Render `precision_note` at equal visual weight to the 94%, never as an asterisk.
- Rank is the largest glyph in a row; probability is small. Percentile beats percentage here.
- Rows expand to `top_factors` and `support_categories`, which is the handoff to a real
  questionnaire.
- CSV in and out; program staff work in Excel.
- 484 rows needs no virtualisation. Filtering client-side also keeps the response clear of the
  4.5 MB serverless payload ceiling.
- These are anonymised held-out historical households with surrogate ids. The header must say
  so, so the screen never reads as a live beneficiary register.

## Suppression and no-data states

`regional_summary.json` carries `{n: 0, suppressed: true, note: "Not surveyed in Wave 5
(conflict); no forecasts or outcomes."}` for Tigray, and cells under 25 households are
suppressed elsewhere. Suppressed regions render present-but-hatched, in their real geographic
position, with their own note. A region missing from an Ethiopian food-security map reads as
"no problem there", which is false.

---

## Data notes found while auditing the artifacts

- **No coordinates are exported.** `area_names.json` holds `summary` + `areas` only (427 areas;
  the summary counts 410 with coordinates but the file does not ship them; woreda verified
  22.5%, zone verified 85.7%). A real choropleth needs an external boundary file, so
  region-level cards are the honest default.
- The "(approx.)" in area labels deserves a real explanation page (`/areas`), not a tooltip.
- `ui/clusters.json` uses `name_` (trailing underscore); `cluster_profiles.json` uses `name`.
  Absorb this in the component layer.
- `/api/schema` defaults to the short graph form; `?full=true` returns the long one. Decide
  which the UI requests; do not guess.
- Legacy `feature_schema.json` has 75 records across 9 groups and describes the ExtraTrees
  model; the deployed form is the 14-question graph form. Do not build the form from it.
- Of 13 figures, only `serving_flow.png`, `model_comparison_4.png` and
  `holdout_diagnostics.png` belong in the product. The 01-08 exploratory set does not.
- `intake_evaluation.json` compares agri10 (accuracy 0.7811) with the deployed agri14 (0.7844):
  four fewer questions for 0.3 points. A good story, but a short-form toggle needs a second
  model path.

## Build order

0. Tokens, shell, mode/density/language toggles, `ProvenanceChip`, `CaveatBlock`, JSON copy
   step, generated TypeScript types from the OpenAPI schema. Response models must be added
   server-side first, or the generated types come out as `unknown`.
1. Landing: orientation + launcher, static only.
2. Assess: schema-driven form, score card, print card.
3. Plan: rank table, capacity slider, CSV.
4. Situation, Segments, Areas.
5. Method: confusion matrix, comparisons, caveats.
6. Field hardening: offline drafts, print pass, Amharic / Afaan Oromo content, batch upload.

Phase 0 is separate on purpose. In a multi-lens design, tokens plus the chip and caveat system
are the only thing that stops four visual dialects growing apart.

### Offline field use

- The installed production app caches its shell and pages already visited while online; users must
  open `/assess` online before relying on that route in the field.
- Assessment answers remain in browser-local storage on that device. They are not synced, queued,
  or sent until the user reconnects and explicitly confirms scoring.
- Offline mode supports form entry and review only. Scoring and model inference require the API;
  never imply that a locally stored draft has been submitted or scored.
- The online/offline indicator checks both the browser's network signal and the scoring API health.
- Do not enter identifying information. Clear the draft on shared devices after use.

### What-if assessment

- Show this only after a sufficient baseline score, and only offer answered numeric model inputs with backend
  ranges.
- Keep the recorded assessment and its result unchanged. Change one answer at a time and send the full modified
  input to the scoring API; never estimate a new score by interpolation.
- Require an explicit action to score each hypothetical. Show both scores and the probability difference with
  clear hypothetical language.
- State that this is a model comparison, not a causal effect, intervention forecast, or assistance decision.
- Do not offer offline scoring or silently queue hypothetical requests.

## Spatial and evidence foundations

- `/spatial` may show only the shipped area labels, their verification flags, and reportable regional aggregates.
- The regional choropleth uses simplified geoBoundaries Ethiopia ADM1 geometry (boundary year 2016; source Open Africa / Code for Ethiopia; CC BY 4.0) and reportable held-out regional aggregates. Display the source and license with the map.
- Let reviewers switch between mean model score and observed food-insecurity rate. Show the selected region's sample size and other available evaluation summaries; keep the color scale explicitly relative to currently reportable regions.
- Draw the regional boundaries once as a non-scaling boundary overlay, not as a stroke on each fill polygon. Provide keyboard-selectable regions, hover feedback, a region selector, and selected-region-centered zoom controls.
- Do not plot household or enumeration-area coordinates or show neighbour links. These are excluded by the project's privacy rules and model-adjacency edges are not exported.
- Regional aggregates describe the region, not the selected area or household. Suppressed values remain unavailable, not zero.
- `/knowledge` searches its own articles and may list official-source metadata links. Metadata listings are not retrieved evidence and must not be presented as World Bank, FEWS NET, WFP, or FAO evidence.
- `/knowledge` may store user-authorized PDF, TXT, and Markdown files in browser-local IndexedDB for offline search. Keep uploads on-device, cite PDF page numbers, show storage usage, cap the library at 300 MB, protect pinned files, and confirm before pruning older unpinned documents. Publisher material remains link-only unless its reuse terms permit the intended use.
- Do not enable LLM answers until approved, versioned source documents, citation-preserving retrieval, and an explicitly configured model/deployment are in place. Every generated factual claim must link to the retrieved passage.

## Open decisions

- Language in v1, or English-only with the font hook in place. `field_labels.json` and
  `field_help.json` are English, so roughly 75 labels plus 13 KB of help text is a new content
  asset.
- Whether agri10 is exposed as a short-form toggle.
- Auth for the public deployment (Deployment Protection covers preview URLs only).
- Which accuracy protocol is canonical once provenance chips exist.

## Frontend recommendations for responsible model use

- **Make area context unmistakable.** The surveyed area's neighbourhood context accounts for
  40.2% of total sensitivity in `drivers.json`. On an assessment result, show this separately
  from household answers and explain that it describes the surveyed area, not something the
  household did. Make approximate area labels and their verification status visible.
- **Keep evidence and limitations beside each result.** Keep the 61% held-out baseline,
  minimum-answer requirement, and descriptive-score caveat visible. Identify the evaluation
  set and operating threshold where relevant. Do not call the output "confidence" or imply
  calibration unless the model has been validated for that interpretation.
- **Help interviewers check the inputs.** Before scoring, provide a clear review of the selected
  area and entered answers, with a straightforward way to correct them. Make missing or unusual
  values understandable; never silently treat an unknown answer as zero.
- **Separate model explanations from recommendations.** Describe `top_factors` as model
  sensitivities, not causes. Present support categories and follow-up prompts as topics for
  human assessment, not instructions to provide or deny assistance. Apply this distinction
  consistently wherever scores and factors appear.
- **Explain batch-data handling before upload.** The batch workflow may pass unrecognised
  columns through the API and return them in the output. Tell users this before file selection
  and advise them to omit columns that are not needed. Verify any "nothing is stored" claim
  against the deployed API and hosting/logging configuration before presenting it as a privacy
  guarantee.
- **Plan localization as a reviewed content change.** If the intended users need Amharic or
  Afaan Oromo, translate and review question labels, help text, warnings, and caveats—not only
  navigation. Test the Ethiopic font and printed output with the translated content.
- **Treat a passing production build as a release prerequisite.** Type-checking alone does not
  show that the frontend can be built and deployed; verify the data-copy step and production
  build before calling a release complete.
