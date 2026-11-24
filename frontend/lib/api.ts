/**
 * Typed client for the FastAPI backend (`api_server.py`).
 *
 * The field names below were checked against a running server, not the docs:
 * `GET /api/health`, `/api/meta`, `/api/schema`, `/api/areas` and a scored
 * `POST /api/predict`. Anything the backend does not return has no type here.
 *
 * Two base URLs, because a container's own localhost is not the browser's:
 *   - serverApiUrl()   -> server-rendered fetches (inside compose: http://api:5000)
 *   - clientApiUrl()   -> calls made by the browser (must be host-reachable)
 */

const FALLBACK_API_URL = "http://localhost:5000";

function trimBase(value: string | undefined): string {
  return (value && value.length > 0 ? value : FALLBACK_API_URL).replace(/\/+$/, "");
}

/** URL the browser should call. NEXT_PUBLIC_* is inlined by Next at build time. */
export function clientApiUrl(): string {
  return trimBase(process.env.NEXT_PUBLIC_API_URL);
}

/** URL this server process should call. Falls back to the public one. */
export function serverApiUrl(): string {
  return trimBase(process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL);
}

/** A failed call, carrying the HTTP status so a page can tell 422 from 503. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** FastAPI sends a string for HTTPException and an array for request validation. */
function describeError(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const first = detail[0];
      if (first && typeof first === "object" && "msg" in first) {
        const location = (first as { loc?: unknown[] }).loc;
        const field = Array.isArray(location) && location.length > 1 ? String(location[1]) : "request";
        return `${field}: ${String((first as { msg: unknown }).msg)}`;
      }
    }
  }
  return `Backend returned ${status}`;
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { cache: "no-store", ...init });
  } catch (cause) {
    throw new ApiError(0, `Cannot reach the backend at ${base}. Start it with docker compose up, or run start_api.bat. (${String(cause)})`);
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      /* a non-JSON error page: the status line is the best we have */
    }
    throw new ApiError(response.status, describeError(body, response.status));
  }
  return (await response.json()) as T;
}

// --------------------------------------------------------------- responses

export type FieldRecord = {
  name: string;
  group: string;
  dtype: string;
  min: number | null;
  max: number | null;
  median_default: number | null;
  allowed_values: number[] | null;
  required: boolean;
  shap_rank: number | null;
  used_for?: string;
};

/** group name -> its questions, in interview order. */
export type FormSchema = Record<string, FieldRecord[]>;

export type Area = {
  id: string;
  label: string;
  region: number;
  survey_label?: string;
  region_name?: string;
  zone?: string | null;
  woreda?: string | null;
  zone_verified?: boolean;
  woreda_verified?: boolean;
  index?: number;
};

export type RiskBand = { label: string; lower: number; upper: number };

export type Meta = {
  version: Record<string, unknown>;
  caveats: string[];
  risk_bands: RiskBand[];
  regions: { code: number; name: string }[];
  field_labels: Record<string, string>;
  field_help: Record<string, string>;
  derived_fields: Record<string, string[]>;
  threshold: number | null;
  min_answers: number;
};

export type Factor = {
  feature: string;
  source_field: string;
  encoded_name: string;
  contribution: number;
  direction: string;
};

export type Recommendation = {
  id: string;
  category: string;
  prompt: string;
  triggered_by: string;
  value: number | null;
};

/** One scored household. `probability` is null when too few questions were answered. */
export type PredictResult = {
  probability: number | null;
  risk_band: string;
  band_meaning: string;
  threshold: number | null;
  flagged: boolean;
  flag_meaning: string;
  n_features_supplied: number;
  n_predictive_supplied: number;
  n_features_expected: number;
  sufficient_data: boolean;
  warnings: string[];
  caveats: string[];
  top_factors: Factor[];
  cluster: { id: number; name: string } | null;
  recommendations: Recommendation[];
  model_version: Record<string, unknown>;
};

/** Where the browser should call. Re-exported so pages import one thing. */
export const apiBaseUrl = clientApiUrl;

// ------------------------------------------------------------------ calls

export const getMeta = (base = serverApiUrl()) => request<Meta>(base, "/api/meta");

export const getSchema = (full = false, base = serverApiUrl()) =>
  request<FormSchema>(base, `/api/schema?full=${full ? "true" : "false"}`);

export const getAreas = (base = serverApiUrl()) => request<Area[]>(base, "/api/areas");

/** Answers keyed by field name. Omit a question entirely to leave it unknown. */
export type HouseholdAnswers = Record<string, number | string | null>;

export const predict = (household: HouseholdAnswers, base = clientApiUrl()) =>
  request<PredictResult>(base, "/api/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(household),
  });

/**
 * Score a whole table. The endpoint returns the input rows with probability,
 * band, cluster and recommendation count appended, already sorted by risk --
 * so the client does not re-sort, and an upload that arrives unsorted cannot
 * quietly present the lowest-risk households first.
 *
 * Every field name that is not a predictor is carried through untouched and
 * never scored: a real extract has identifiers, reference codes and notes, and
 * rejecting the file for an extra column would make this path unusable.
 */
export const postPredictBatch = (rows: HouseholdAnswers[], base = clientApiUrl()) =>
  request<BatchRow[]>(base, "/api/predict_batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rows),
  });

export type BatchRow = HouseholdAnswers & {
  probability: number | null;
  risk_band: string;
  cluster: string | null;
  n_recommendations: number;
};

/** Alias so callers can catch one name for both request kinds. */
export { ApiError as PredictError };
