# Frontend design (Next.js workspace)

How the website is built and the rules it follows. The model, validation, segmentation and
explanations live in the backend and are reached over HTTP (`GRAPH_BACKEND_HANDOFF.md`) or
through `Service` from Python (`STREAMLIT_HANDOFF.md`). Deployment is in `DEPLOYMENT.md`.

---

## Architecture

| Piece | Where | What it does |
|---|---|---|
| Website (`frontend/`, Next.js 15 App Router) | Vercel | Pages, the knowledge centre and the two AI routes |
| API (`backend/`, FastAPI) | Render (Docker) | `/api/schema`, `/api/meta`, `/api/areas`, `/api/predict`, `/api/predict_batch`, `/api/health` |
| AI service | Groq | Called only from the website's server, never from the browser |

- **Build-time data.** `scripts/copy-data.mjs` copies an allowlist of files from
  `backend/artifacts/ui_graph/` into `frontend/data/`, validates each one against the zod
  schemas in `lib/schemas.mjs`, and fails the build on any mismatch. Model pickles, raw survey
  rows and coordinates are never copied. Dashboards are static pages built from these files.
- **Live calls.** Only scoring talks to the API: the browser calls `/api/predict` and
  `/api/predict_batch` directly (CORS limited by `ALLOWED_ORIGINS`), and the Assess page's
  server loads the question set and survey areas.
- **Knowledge content.** The same build renders `content/knowledge/*.md` into articles and
  search passages, filling `{{placeholders}}` from the model's result files so the text cannot
  drift from the dashboards.

## Product principles

> The ordered list is the product. A score ranks households for a human follow-up assessment;
> it is not an eligibility decision.

These stay visible wherever a score appears, never behind a tooltip:

- **About 61% of test households were food insecure**, so always answering "insecure" would be
  right 61% of the time.
- **Risk bands are descriptive labels**, not calibrated assistance categories.
- **Reasons are model sensitivities, not causes**, and they do not add up to the score.
- **The survey area is the largest single influence** (about 40% of the total effect in
  `drivers.json`). It is shown separately from the household's answers and described as where
  the household was surveyed, not something it did.

## Navigation and routes

Header menu: Overview · Assess ▾ · Plan · Insights ▾ · About ▾. The footer repeats the links
and credits the team with their profiles (`lib/team.ts`).

| Route | Content | Data |
|---|---|---|
| `/` | Headline, key figures, how it works, links to the results, responsible-use notes | static |
| `/assess` | Stepped 14-question interview, review, score, reasons, follow-up topics, what-if, "Explain this result", print card | live API |
| `/batch` | CSV upload, ranked output, download | live API |
| `/plan` | Ranked test households, capacity slider, expected yield, CSV | static |
| `/situation` | Risk levels, score histogram, profiles, region cards | static |
| `/spatial` | Regional map (geoBoundaries ADM1, CC BY 4.0) and survey-area lookup | static |
| `/segments` | Five household profiles as z-score bars | static |
| `/areas` | The 427 survey areas and how reliable their names are | static |
| `/method` | Right and wrong calls, accuracy, model comparison, question choice, limits | static |
| `/knowledge`, `/knowledge/[slug]` | Knowledge centre: search, cited AI answers, eight articles, further reading, citation, offline library | static + AI route |
| `/api/knowledge/ask`, `/api/knowledge/explain` | The AI routes (below) | server |

`/copilot` redirects permanently to `/knowledge`.

## Display options

The header's **Display** menu sets two preferences, kept per device:

| Option | Simple | Compact | Detailed |
|---|---|---|---|
| Score | words and the band | small grey number | exact value with its data source |
| Reasons | top three | top three | all, with the area panel |

Density (comfortable or compact) is a set of CSS custom properties, not a second design.

## Visual design

- **Register.** White cards on a cool grey page with a deep navy header and footer (`#0b2a45`),
  in the style of international-development institutions. No dark mode: it fights print.
- **Risk ramp.** Straw to clay (`#efe3b8`, `#e0b071`, `#b4632b`), monotonic in lightness so it
  survives greyscale printing and colour-vision deficiency. **No red or green**: green reads as
  "eligible" or "safe", red as "punished".
- **Accent.** One blue (`#1a5d97`) for interaction only (links, buttons, focus), never for risk,
  so a control can never be read as a risk level.
- **Logo.** An "E" whose spine is a wheat stalk and whose arms are three bars in the ramp
  colours. `public/logo.svg` is the detailed drawing; `components/brand-mark.tsx` and
  `public/icon.svg` are the compact one, legible down to 16 px, on a white tile so it shows on
  the navy header. App icons, the Apple touch icon and the link-preview card
  (`public/og-image.png`) are generated from the same drawing.
- **Type.** Inter with Noto Sans Ethiopic, self-hosted by `next/font`; tabular figures.
- **Numbers.** At most three decimals; the cut-off `0.5211760401725769` shows as `0.52`.
- **Motion.** None for risk changes. Never animate a number counting up.
- **Print.** The assessment card and the ranked list print cleanly; site chrome is hidden.

## The assessment

- The form is built from `/api/schema`, not hard-coded. Labels and help come from
  `field_labels.json` and `field_help.json`.
- "Unknown" is a real answer and is never read as zero. A sufficiency meter shows answered
  questions against the minimum (9); below it, the backend's own message is shown.
- Calculated values (household size, dependency ratio, livestock units) appear as read-only
  chips, with the livestock-unit weights explained.
- Drafts and recent assessments stay in the browser on that device. The form asks for no names
  or identifiers.
- **What-if** appears only after a valid score. It changes one answer, rescores the full input
  through the API, and labels the result as a model comparison, not an effect of any action.

## Knowledge centre and AI

Both AI features are retrieval-augmented generation sharing `lib/rag.ts`:

- **Corpus.** 73 passages from the eight articles plus 16 generated summaries of the model's
  results (overall risk, each region, each profile, what moves the scores). Each results
  summary links to the page that shows those figures.
- **Retrieval.** `lib/knowledge-search.ts`: stemmed keyword search with rare words weighted
  higher and headings counting most. The same code runs in the browser (instant, offline
  search) and on the server (choosing what the AI may cite).
- **Ask.** The server sends Groq the six best passages and the question. Every sentence must
  cite a passage; an answer without valid citations is rejected; unanswerable questions return
  "not covered" with the closest sections.
- **Explain this result.** The browser sends only the score, band, what moved it, the survey
  area id and the profile id, never the interview answers. The server writes the result out
  from its own copies of labels and names, adds the region and profile summaries and the
  sections on how scores work, and asks for a cited explanation.
- **Guards.** Same-origin requests only (`Sec-Fetch-Site`, or Origin against Host), small
  request bodies, and a shared rate limit (6 a minute per visitor, 60 in total).
- **Offline library.** Visitors may keep their own PDF, TXT and Markdown files in IndexedDB for
  offline search. These files never leave the device and are never sent to the AI.
- **Further reading** is a hand-picked list (`lib/further-reading.ts`) plus recent official
  publications listed as titles and links only; publisher content is never copied.

## Suppression and privacy

- Regions with no or too few test households (Tigray, Addis Ababa, Somali,
  Benishangul-Gumuz) are drawn in position, hatched, with their own note. A missing region
  would read as "no problem there".
- No household or survey-area coordinates are shipped or plotted. Area names come from
  official boundaries matched to displaced survey locations and are marked "(approx.)" when
  not verified.
- The ranked list on `/plan` is anonymised historical test households with surrogate ids, and
  says so, so it never reads as a live beneficiary register.

## Offline use

- The service worker caches the app shell, the pages a visitor has opened and the knowledge
  articles. Bump `CACHE_NAME` in `public/service-worker.js` when cached assets change.
- Offline, the interview can be filled in and reviewed, and the knowledge centre can be
  searched. Scoring and AI answers need a connection and are never queued.
- The connection indicator checks both the browser's network state and the API's health.

## Quality checks

- `npm run check` (TypeScript) and `npm run lint` (ESLint, Next.js rules) must pass;
  `next build` also runs ESLint.
- A release needs a passing production build, which includes the data-copy validation.
- Accessibility: keyboard-reachable controls, visible focus, labelled regions and icons,
  screen-reader text for citations and external links, and no horizontal scrolling at phone
  width.

## Open questions

- Amharic and Afaan Oromo: question labels, help text and caveats need translation and review,
  not only the navigation.
- A shorter form: the ten-question variant scores nearly as well (`intake_evaluation.json`) but
  needs its own model path.
- Semantic (embedding) search alongside keyword search, if the corpus grows.
