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
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateArtifact } from "../lib/schemas.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(here, "..");
const projectRoot = resolve(frontendDir, "..");
const backendDir = join(projectRoot, "backend");
const docsDir = join(projectRoot, "docs");
const outDir = join(frontendDir, "data");
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

const LOCAL_EVIDENCE_DOCS = [
  ["README.md", join(projectRoot, "README.md")],
  ["FRONTEND_DESIGN.md", join(docsDir, "FRONTEND_DESIGN.md")],
  ["GRAPH_BACKEND_HANDOFF.md", join(docsDir, "GRAPH_BACKEND_HANDOFF.md")],
  ["STREAMLIT_HANDOFF.md", join(docsDir, "STREAMLIT_HANDOFF.md")],
];

function chunkText(text, maxLength = 1200) {
  const chunks = [];
  let current = "";

  for (const paragraph of text.split(/\n\s*\n/)) {
    const normalized = paragraph.trim();
    if (!normalized) continue;

    if (normalized.length > maxLength) {
      if (current) chunks.push(current);
      current = "";
      for (let start = 0; start < normalized.length; start += maxLength) {
        chunks.push(normalized.slice(start, start + maxLength));
      }
      continue;
    }

    if (current && current.length + normalized.length + 2 > maxLength) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${normalized}` : normalized;
  }

  if (current) chunks.push(current);
  return chunks;
}

function indexMarkdown(source, markdown) {
  const records = [];
  const headings = [];
  let sectionLines = [];

  function flushSection() {
    const section = headings.filter(Boolean).join(" > ") || "Overview";
    const text = sectionLines.join("\n").trim();
    for (const [index, content] of chunkText(text).entries()) {
      records.push({
        id: `${source}:${section}:${index + 1}`,
        source,
        section,
        citation: `${source} — ${section}`,
        content,
      });
    }
    sectionLines = [];
  }

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) {
      sectionLines.push(line);
      continue;
    }

    flushSection();
    const depth = match[1].length;
    headings.length = depth - 1;
    headings[depth - 1] = match[2];
  }
  flushSection();
  return records;
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

  const localEvidence = [];
  for (const [source, path] of LOCAL_EVIDENCE_DOCS) {
    const markdown = await readFile(path, "utf8");
    localEvidence.push(...indexMarkdown(source, markdown));
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
  for (const relative of ALLOW) {
    const name = relative.split("/").pop();
    await writeFile(join(outDir, "artifacts", name), sourceBuffers.get(relative));
  }
  await writeFile(join(outDir, "areas.json"), areaText, "utf8");
  await writeFile(
    join(outDir, "evidence", "project-documents.json"),
    JSON.stringify(localEvidence),
    "utf8",
  );
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
  console.log(`copy-data: ${localEvidence.length} project evidence passages -> frontend/data/evidence/`);
  console.log(
    `copy-data: ${publicSourceMetadata.sources.reduce((sum, source) => sum + source.items.length, 0)} ` +
      "official-source metadata records -> frontend/data/evidence/",
  );
}

await main();
