/**
 * Copy the backend's UI artifacts into frontend/data/ and validate every one of them
 * against the zod schemas in lib/schemas.mjs before writing.
 *
 * Why this exists instead of importing the JSON directly:
 *   - The artifacts are the contract. The frontend must fail at build time, with
 *     the offending file and JSON pointer, rather than render `undefined` in a
 *     table a programme officer is about to make a targeting decision from.
 *   - The copy is a security boundary, not a convenience. Only files named in
 *     ALLOW below ever reach the client bundle. artifacts/ also contains model
 *     pickles, per-household survey rows and coordinates; a wildcard glob would
 *     ship those to the browser.
 *
 * Run: npm run data   (also runs automatically before `npm run dev` and `npm run build`)
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { marked } from "marked";

import { validateArtifact } from "../lib/schemas.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(here, "..");
const projectRoot = resolve(frontendDir, "..");
const backendDir = join(projectRoot, "backend");
const outDir = join(frontendDir, "data");
const knowledgeDir = join(frontendDir, "content", "knowledge");
const publicSourceMetadataPath = join(backendDir, "artifacts", "public_evidence", "source_metadata.json");

/**
 * The allowlist. Files in artifacts/ that are NOT listed here deliberately:
 * model_bundle.joblib / gcn_model.joblib (pickles), raw SPSS conversions, and any
 * per-household row carrying identifiers or coordinates. If a new artifact is
 * needed by the UI, add it here by name and validate it in lib/schemas.mjs.
 */
const ALLOW = [
  "ui_graph/risk_distribution.json",
  "ui_graph/regional_summary.json",
  "ui_graph/comparison.json",
  "ui_graph/performance.json",
  "ui_graph/drivers.json",
  "ui_graph/intake_evaluation.json",
  "ui_graph/cluster_profiles.json",
  "ui_graph/regions.json",
  "ui_graph/area_names.json",
  "ui_graph/scored_households.json",
  "ui_graph/field_labels.json",
  "ui_graph/field_help.json",
  "ui/clusters.json",
];

/**
 * The knowledge centre: content/knowledge/NN-slug.md, one article per file.
 *
 * Figures in the articles are {{placeholders}} filled here from the same artifacts
 * the dashboards read, so the text cannot drift from the model's results; an
 * unknown placeholder or a broken /knowledge link fails the build. Each "## "
 * heading becomes a section with a stable anchor, and each section becomes a
 * search passage, which is what the AI answers cite.
 */
const pct = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const count = (value) => Number(value).toLocaleString("en-US");

function knowledgeValues(parsed) {
  const performance = parsed.get("ui_graph/performance.json");
  const holdout = performance.holdout_seed0;
  const cv = performance.five_split;
  const distribution = parsed.get("ui_graph/risk_distribution.json");
  const drivers = parsed.get("ui_graph/drivers.json");
  const intake = parsed.get("ui_graph/intake_evaluation.json");
  const comparison = parsed.get("ui_graph/comparison.json");
  const areaSummary = parsed.get("ui_graph/area_names.json").summary;

  const model = (key) => {
    const found = comparison.models.find((entry) => entry.key === key);
    if (!found) throw new Error(`comparison.json has no model "${key}"`);
    return pct(found.accuracy_mean);
  };
  const missing = (rate) => {
    const found = intake.missing.find((entry) => Math.abs(entry.missing_rate - rate) < 1e-9);
    if (!found) throw new Error(`intake_evaluation.json has no missing rate ${rate}`);
    return found;
  };
  const benchmark = intake.forms.find((form) => form.family === "benchmark");
  const areaContext = drivers.fields.find((field) => field.field === "area_context");
  if (!benchmark || !areaContext) throw new Error("knowledge figures: benchmark form or area_context missing");

  return {
    training_households: count(performance.training.households),
    training_areas: count(performance.training.areas),
    test_households: count(holdout.n),
    baseline_rate: pct(performance.baseline_rate, 0),
    threshold: performance.threshold.toFixed(2),
    min_answers: String(performance.min_answers),
    accuracy: pct(holdout.accuracy),
    precision: pct(holdout.precision),
    recall: pct(holdout.recall),
    roc_auc: holdout.roc_auc.toFixed(2),
    cv_accuracy: pct(cv.accuracy_mean),
    cv_accuracy_sd: (cv.accuracy_sd * 100).toFixed(1),
    cv_recall: pct(cv.recall_mean),
    cv_precision: pct(cv.precision_mean),
    cv_roc_auc: cv.roc_auc_mean.toFixed(2),
    tp: count(holdout.tp),
    fp: count(holdout.fp),
    fn: count(holdout.fn),
    tn: count(holdout.tn),
    fn_plus_tp: count(holdout.fn + holdout.tp),
    flagged: count(distribution.flagged),
    area_effect: areaContext.mean_abs.toFixed(2),
    zone_verified: pct(areaSummary.zone_verified_share, 0),
    woreda_verified: pct(areaSummary.woreda_verified_share, 0),
    missing20_accuracy: pct(missing(0.2).accuracy),
    missing20_scored: pct(missing(0.2).scored_share, 0),
    missing30_scored: pct(missing(0.3).scored_share, 0),
    model_gcn: model("gcn_plus_ensemble"),
    model_extratrees: model("extra_trees_graph"),
    model_lightgbm: model("lightgbm"),
    model_logistic: model("logistic_regression"),
    benchmark_accuracy: pct(benchmark.accuracy),
  };
}

const slugify = (text) =>
  text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");

function parseFrontMatter(text, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) throw new Error(`${file}: missing front matter (title, summary)`);
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { meta, body: text.slice(match[0].length) };
}

/** Markdown to the plain text that search and the AI read. */
function plainText(markdown) {
  return markdown
    .replace(/^\|?\s*:?-{3,}[-|: ]*$/gm, "")
    .replace(/^\|(.*)\|[ \t]*$/gm, (_, row) =>
      row.split("|").map((cell) => cell.trim()).filter(Boolean).join(" · "))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>[ 	]?/gm, "")
    .replace(/^[ 	]*[-*][ 	]+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The articles are this project's own content, so their HTML is trusted. */
function renderMarkdown(markdown) {
  return marked
    .parse(markdown, { async: false, gfm: true })
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, "</table></div>")
    .replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noreferrer"');
}

function chunkText(text, maxLength = 1200) {
  const chunks = [];
  let current = "";
  for (const paragraph of text.split(/\n\s*\n/)) {
    const normalized = paragraph.trim();
    if (!normalized) continue;
    if (current && current.length + normalized.length + 2 > maxLength) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${normalized}` : normalized;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function buildKnowledge(values) {
  const fill = (text, file) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!(key in values)) throw new Error(`${file}: unknown placeholder {{${key}}}`);
      return values[key];
    });

  const files = (await readdir(knowledgeDir)).filter((file) => file.endsWith(".md")).sort();
  const articles = [];
  const passages = [];

  for (const file of files) {
    const name = /^(\d+)-([a-z0-9-]+)\.md$/.exec(file);
    if (!name) throw new Error(`${file}: knowledge articles are named NN-slug.md`);
    const slug = name[2];
    const { meta, body } = parseFrontMatter(fill(await readFile(join(knowledgeDir, file), "utf8"), file), file);
    if (!meta.title || !meta.summary) throw new Error(`${file}: front matter needs title and summary`);

    const parts = body.split(/^## +/m);
    const intro = (parts.shift() ?? "").trim();
    const sections = parts.map((part) => {
      const newline = part.indexOf("\n");
      const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
      const markdown = newline === -1 ? "" : part.slice(newline + 1).trim();
      return { id: slugify(heading), heading, markdown };
    });
    const ids = new Set();
    for (const section of sections) {
      if (!section.id || ids.has(section.id)) throw new Error(`${file}: duplicate or empty heading "${section.heading}"`);
      ids.add(section.id);
    }

    const words = plainText(body).split(/\s+/).length;
    articles.push({
      slug,
      title: meta.title,
      summary: meta.summary,
      minutes: Math.max(1, Math.round(words / 200)),
      intro: renderMarkdown(intro),
      sections: sections.map(({ id, heading, markdown }) => ({ id, heading, html: renderMarkdown(markdown) })),
    });

    const addPassages = (section, anchor, markdown) => {
      for (const [index, text] of chunkText(plainText(markdown)).entries()) {
        passages.push({
          id: `${slug}#${anchor || "top"}:${index + 1}`, slug, article: meta.title, section, anchor, kind: "article", text,
        });
      }
    };
    if (intro) addPassages("", "", intro);
    for (const section of sections) addPassages(section.heading, section.id, section.markdown);
  }

  // Every /knowledge link inside an article must point at a real article and section.
  const anchors = new Map(articles.map((article) => [article.slug, new Set(article.sections.map((s) => s.id))]));
  for (const article of articles) {
    const html = [article.intro, ...article.sections.map((section) => section.html)].join("");
    for (const [, slug, anchor] of html.matchAll(/href="\/knowledge\/([a-z0-9-]+)(?:#([a-z0-9-]+))?"/g)) {
      if (!anchors.has(slug) || (anchor && !anchors.get(slug).has(anchor))) {
        throw new Error(`${article.slug}: broken link /knowledge/${slug}${anchor ? `#${anchor}` : ""}`);
      }
    }
  }
  return { articles, passages };
}

/**
 * Results summaries for the knowledge centre: the dashboards' figures written
 * out as short factual passages, so questions such as "which region has the
 * highest risk?" are answered, and cited, from the same artifacts the pages
 * show. Each passage links to the page where the figure appears.
 */
function buildDataPassages(parsed, values) {
  const distribution = parsed.get("ui_graph/risk_distribution.json");
  const regions = parsed.get("ui_graph/regional_summary.json");
  const profiles = parsed.get("ui_graph/cluster_profiles.json");
  const drivers = parsed.get("ui_graph/drivers.json");
  const labels = parsed.get("ui_graph/field_labels.json");
  const label = (field) => labels[field] ?? field;
  const share = (part, whole) => pct(part / whole, 0);
  const passages = [];
  const add = (id, article, section, href, sentences) =>
    passages.push({
      id: `data:${id}`, slug: "", article, section, anchor: "", href, kind: "data",
      text: sentences.filter(Boolean).join(" "),
    });

  // Overall picture.
  const n = distribution.n_households;
  const bands = distribution.band_counts;
  const { edges, counts } = distribution.histogram;
  add("overview", "Risk overview", "Risk levels across the test households", "/situation#risk-levels", [
    `Across the ${count(n)} test households, farming households the model never saw while it was trained,`,
    `${pct(distribution.observed_rate)} reported food insecurity in 2021/22.`,
    `The model placed ${count(bands.High)} households (${share(bands.High, n)}) in the High risk band,`,
    `${count(bands.Moderate)} (${share(bands.Moderate, n)}) in Moderate and ${count(bands.Low)} (${share(bands.Low, n)}) in Low.`,
    `${count(distribution.flagged)} households (${share(distribution.flagged, n)}) scored above the follow-up cut-off of`,
    `${values.threshold} and would be flagged for a visit.`,
    `${count(counts.at(-1))} households scored ${edges.at(-2)} or higher and ${count(counts[0])} scored below ${edges[1]}.`,
  ]);

  // Regions.
  const reported = regions.filter((region) => !region.suppressed)
    .sort((a, b) => b.observed_rate - a.observed_rate);
  const regionName = (region) =>
    region.region === "SNNP" ? "SNNP (Southern Nations, Nationalities and Peoples Region)" : region.region;
  const why = (region) => region.note?.includes("conflict")
    ? `${region.region} (not surveyed in 2021/22 because of the conflict)`
    : region.n === 0 ? `${region.region} (no test households)`
      : `${region.region} (only ${region.n} test households, too few to report safely)`;
  const byRisk = [...reported].sort((a, b) => b.mean_risk - a.mean_risk);
  add("regions", "Risk overview", "Regions compared", "/situation#by-region", [
    "Regions ranked by the share of test households that reported food insecurity in 2021/22, highest first:",
    `${reported.map((region) => `${region.region} ${pct(region.observed_rate)} (${count(region.n)} households)`).join(", ")}.`,
    `The highest average risk score is in ${byRisk[0].region} (${byRisk[0].mean_risk.toFixed(2)})`,
    `and the lowest in ${byRisk.at(-1).region} (${byRisk.at(-1).mean_risk.toFixed(2)}).`,
    `Across all test households the share was ${pct(distribution.observed_rate)}.`,
    `No figures are reported for ${regions.filter((region) => region.suppressed).map(why).join(", ")}.`,
    "A region without a figure does not have zero risk.",
  ]);
  reported.forEach((region, rank) => {
    const above = region.observed_rate > distribution.observed_rate;
    add(`region-${region.region_code}`, "Risk overview", `${region.region} region`, "/situation#by-region", [
      `${regionName(region)}: ${count(region.n)} test households in ${count(region.n_areas)} survey areas.`,
      `${pct(region.observed_rate)} reported food insecurity in 2021/22, ${above ? "above" : "below"} the`,
      `${pct(distribution.observed_rate)} average across all test households; it ranks ${rank + 1} of the`,
      `${reported.length} regions with figures, where 1 is the highest share.`,
      `The average risk score was ${region.mean_risk.toFixed(2)}; ${pct(region.flagged_share, 0)} of its households were`,
      `flagged for follow-up and ${pct(region.high_share, 0)} were in the High band.`,
      `The model was right about ${pct(region.agricultural_accuracy, 0)} of the households in this region.`,
      `The most common household profile is ${region.top_cluster}.`,
    ]);
  });

  // Household profiles.
  const testByProfile = new Map(distribution.by_cluster.map((row) => [row.cluster, row]));
  const allHouseholds = profiles.reduce((sum, profile) => sum + profile.n, 0);
  const sortedProfiles = [...profiles].sort((a, b) => b.food_insecure_rate - a.food_insecure_rate);
  add("profiles", "Household profiles", "Profiles compared", "/segments", [
    `The ${count(allHouseholds)} households in the data fall into ${profiles.length} descriptive profiles.`,
    "Ranked by the share that reported food insecurity in 2021/22, highest first:",
    `${sortedProfiles.map((profile) => `${profile.name} ${pct(profile.food_insecure_rate)} (${count(profile.n)} households,`
      + ` ${profile.pct.toFixed(1)}% of all)`).join(", ")}.`,
    "Profiles describe groups of similar households; they are not categories of need.",
  ]);
  for (const profile of profiles) {
    const test = testByProfile.get(profile.name);
    const traits = Object.entries(profile.z)
      .filter(([, z]) => Math.abs(z) >= 0.25)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 4)
      .map(([field, z]) => `${label(field)} ${Math.abs(z) >= 1 ? "well " : ""}${z > 0 ? "above" : "below"} average`);
    add(`profile-${profile.cluster}`, "Household profiles", profile.name, `/segments#profile-${profile.cluster}`, [
      `${profile.name}: ${count(profile.n)} households, ${profile.pct.toFixed(1)}% of all households in the data.`,
      `${pct(profile.food_insecure_rate)} of them reported food insecurity in 2021/22.`,
      test ? `Among the test households in this profile (${count(test.n)}), the average risk score was`
        + ` ${test.mean_risk.toFixed(2)} and ${pct(test.flagged_share, 0)} were flagged for follow-up.` : "",
      traits.length ? `Compared with the average household: ${traits.join("; ")}.` : "",
    ]);
  }

  // What moves the scores.
  const top = drivers.fields.slice(0, 8);
  const steady = drivers.fields.slice(0, 12).filter((field) =>
    field.field !== "area_context" && (field.share_increasing <= 0.1 || field.share_increasing >= 0.9));
  add("drivers", "How the risk score works", "What moves the scores most",
    "/knowledge/how-the-score-works#the-reasons-shown-with-a-score", [
      "On the test households, the score changed most when this information was left out (average change on a 0 to 1 scale):",
      `${top.map((field) => `${label(field.field)} ${field.mean_abs.toFixed(2)}`).join("; ")}.`,
      `By group: ${drivers.domains.map((domain) => `${domain.group} ${domain.share_pct.toFixed(1)}%`).join(", ")} of the total effect.`,
      ...steady.map((field) => field.share_increasing <= 0.1
        ? `Knowing ${label(field.field)} raised the score for only ${pct(field.share_increasing, 0)} of households.`
        : `Knowing ${label(field.field)} raised the score for ${pct(field.share_increasing, 0)} of households.`),
      "These figures describe how the model behaves, not what causes food insecurity.",
    ]);

  return passages;
}

async function readPublicSourceMetadata() {
  try {
    const data = JSON.parse(await readFile(publicSourceMetadataPath, "utf8"));
    if (!Array.isArray(data.sources)) {
      throw new Error("sources must be an array");
    }

    return {
      retrieved_at: typeof data.retrieved_at === "string" ? data.retrieved_at : null,
      sources: data.sources.map((source) => {
        if (!Array.isArray(source.items)) {
          throw new Error(`${source.id}: items must be an array`);
        }
        const host = new URL(source.publisher_url).hostname;
        return {
          id: source.id,
          name: source.name,
          publisher_url: source.publisher_url,
          reuse_terms_url: source.reuse_terms_url,
          rights_notes: source.rights_notes,
          content_type: source.content_type,
          rights_status: source.rights_status,
          external_ai_policy:
            source.rights_status === "verified" && source.external_ai_policy === "approved"
              ? "approved"
              : "blocked",
          offline_content_policy: source.offline_content_policy,
          retrieved_at: source.retrieved_at,
          items: source.items.map((item) => {
            const itemUrl = new URL(item.url);
            if (itemUrl.protocol !== "https:" || itemUrl.hostname !== host) {
              throw new Error(`${source.id}: item URL is outside the official publisher host`);
            }
            return {
              id: item.id,
              title: item.title,
              url: itemUrl.href,
              published_at: item.published_at ?? null,
              language: item.language,
              content_type: item.content_type,
            };
          }),
        };
      }),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { retrieved_at: null, sources: [] };
    }
    throw new Error(`Could not prepare official-source metadata: ${error.message}`);
  }
}

/**
 * areas.json is derived, not copied: /api/areas joins the surveyed areas held in
 * the model pickle with these readable names, and the pickle cannot be loaded at
 * build time (it needs the pinned scikit-learn). Everything here is a subset of
 * what the endpoint serves, so the static picker can be built without a backend;
 * `survey_label` and `index` only exist at runtime, so they are absent by design.
 */
async function deriveAreas(regions, areaNames) {
  const codeByName = new Map(regions.map((r) => [r.name, r.code]));
  return Object.entries(areaNames.areas).map(([id, a]) => {
    const code = codeByName.get(a.region_name);
    if (code === undefined) {
      throw new Error(`area ${id}: region_name "${a.region_name}" is not in regions.json`);
    }
    return {
      id,
      region_code: code,
      region_name: a.region_name,
      zone: a.zone ?? null,
      woreda: a.woreda ?? null,
      zone_verified: Boolean(a.zone_verified),
      woreda_verified: Boolean(a.woreda_verified),
      label: a.label,
    };
  });
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function main() {
  const parsed = new Map();
  const sourceBuffers = new Map();
  const manifest = { generated_at: null, files: {}, derived: {} };

  for (const relative of ALLOW) {
    const buffer = await readFile(join(backendDir, "artifacts", relative));
    const text = buffer.toString("utf8");
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(`${relative} is not valid JSON: ${error.message}`);
    }

    validateArtifact(relative, data);
    parsed.set(relative, data);
    sourceBuffers.set(relative, buffer);

    const name = relative.split("/").pop();
    manifest.files[name] = {
      source: `backend/artifacts/${relative}`,
      bytes: buffer.length,
      sha256: sha256(buffer),
    };
  }

  const areas = await deriveAreas(
    parsed.get("ui_graph/regions.json"),
    parsed.get("ui_graph/area_names.json"),
  );
  validateArtifact("areas.json", areas);
  const areaText = JSON.stringify(areas);
  manifest.derived["areas.json"] = {
    bytes: Buffer.byteLength(areaText),
    sha256: sha256(Buffer.from(areaText)),
    from: ["ui_graph/area_names.json", "ui_graph/regions.json"],
  };
  manifest.summary = {
    area_names: parsed.get("ui_graph/area_names.json").summary,
    area_count: areas.length,
  };

  const values = knowledgeValues(parsed);
  const knowledge = await buildKnowledge(values);
  knowledge.passages.push(...buildDataPassages(parsed, values));
  // Results summaries may link into the articles; those links must exist too.
  const sectionIds = new Map(knowledge.articles.map((article) => [article.slug, new Set(article.sections.map((s) => s.id))]));
  for (const passage of knowledge.passages) {
    if (!passage.href?.startsWith("/knowledge")) continue;
    const link = /^\/knowledge\/([a-z0-9-]+)(?:#([a-z0-9-]+))?$/.exec(passage.href);
    if (!link || !sectionIds.has(link[1]) || (link[2] && !sectionIds.get(link[1]).has(link[2]))) {
      throw new Error(`${passage.id}: broken link ${passage.href}`);
    }
  }
  const publicSourceMetadata = await readPublicSourceMetadata();
  await mkdir(join(frontendDir, "public"), { recursive: true });
  await copyFile(
    join(frontendDir, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
    join(frontendDir, "public", "pdf.worker.mjs"),
  );

  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "artifacts"), { recursive: true });
  await mkdir(join(outDir, "evidence"), { recursive: true });
  await mkdir(join(outDir, "knowledge"), { recursive: true });
  for (const relative of ALLOW) {
    const name = relative.split("/").pop();
    await writeFile(join(outDir, "artifacts", name), sourceBuffers.get(relative));
  }
  await writeFile(join(outDir, "areas.json"), areaText, "utf8");
  await writeFile(join(outDir, "knowledge", "articles.json"), JSON.stringify(knowledge.articles), "utf8");
  await writeFile(join(outDir, "knowledge", "passages.json"), JSON.stringify(knowledge.passages), "utf8");
  await writeFile(
    join(outDir, "evidence", "public-sources.json"),
    JSON.stringify(publicSourceMetadata),
    "utf8",
  );

  // generated_at would make this file differ on every build even when no artifact
  // changed, so the timestamp is written only here, and hashes are the diff.
  manifest.generated_at = new Date().toISOString();
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const total = Object.values(manifest.files).reduce((sum, f) => sum + f.bytes, 0);
  console.log(
    `copy-data: ${ALLOW.length} artifacts (${(total / 1024).toFixed(0)} KB) + areas.json ` +
      `(${areas.length} areas) -> frontend/data/`,
  );
  console.log(
    `copy-data: ${knowledge.articles.length} knowledge articles, ${knowledge.passages.length} passages ` +
      `(${knowledge.passages.filter((passage) => passage.kind === "data").length} from results) ` +
      "-> frontend/data/knowledge/",
  );
  console.log(
    `copy-data: ${publicSourceMetadata.sources.reduce((sum, source) => sum + source.items.length, 0)} ` +
      "official-source metadata records -> frontend/data/evidence/",
  );
}

await main();
