"use client";

import { useEffect, useMemo, useState } from "react";

import regionalData from "@/data/artifacts/regional_summary.json";
import { int, num, pct } from "@/lib/format";

type Position = [number, number];
type PolygonCoordinates = Position[][];
type Geometry =
  | { type: "Polygon"; coordinates: PolygonCoordinates }
  | { type: "MultiPolygon"; coordinates: PolygonCoordinates[] };
type BoundaryFeature = {
  properties: { shapeName: string };
  geometry: Geometry;
};
type BoundaryCollection = { features: BoundaryFeature[] };
type RegionSummary = {
  region_code: number;
  region: string;
  n: number;
  suppressed: boolean;
  note?: string;
  mean_risk?: number;
  observed_rate?: number;
  flagged_share?: number;
  high_share?: number;
  n_areas?: number;
  agricultural_accuracy?: number;
  top_cluster?: string;
};
type MapRegion = {
  shapeName: string;
  summary: RegionSummary | undefined;
  path: string;
};
type MapMetric = "mean_risk" | "observed_rate";

const summaries = regionalData as unknown as RegionSummary[];
const WIDTH = 620;
const HEIGHT = 560;
const PADDING = 18;
const LOW_COLOR: readonly [number, number, number] = [239, 227, 184];
const HIGH_COLOR: readonly [number, number, number] = [180, 99, 43];
const SHAPE_REGION_ALIASES: Record<string, string> = {
  "Beneshangul Gumu": "Benishangul-Gumuz",
  Hareri: "Harari",
  SNNPR: "SNNP",
};

function regionName(shapeName: string): string {
  return SHAPE_REGION_ALIASES[shapeName] ?? shapeName;
}

function polygonsOf(geometry: Geometry): PolygonCoordinates[] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function mapColor(value: number | undefined, min: number, max: number): string {
  if (value === undefined) return "#ddd9d0";
  const ratio = max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const mix = (start: number, end: number) => Math.round(start + (end - start) * ratio);
  const color = [
    mix(LOW_COLOR[0], HIGH_COLOR[0]),
    mix(LOW_COLOR[1], HIGH_COLOR[1]),
    mix(LOW_COLOR[2], HIGH_COLOR[2]),
  ];
  return `rgb(${color.join(", ")})`;
}

function formatMetric(value: number | undefined, metric: MapMetric): string {
  if (value === undefined) return "summary unavailable";
  return metric === "mean_risk" ? num(value, 2) : pct(value, 1);
}

export function RegionMap() {
  const [boundaries, setBoundaries] = useState<BoundaryCollection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState("Afar");
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const [metric, setMetric] = useState<MapMetric>("mean_risk");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/ethiopia-admin1.geojson", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Boundary file request failed with HTTP ${response.status}.`);
        }
        const data = (await response.json()) as BoundaryCollection;
        if (!Array.isArray(data.features) || data.features.length === 0) {
          throw new Error("The boundary file contains no regions.");
        }
        setBoundaries(data);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, []);

  const mapRegions = useMemo<MapRegion[]>(() => {
    if (!boundaries) return [];

    const allPositions = boundaries.features.flatMap((feature) =>
      polygonsOf(feature.geometry).flatMap((polygon) => polygon.flat()),
    );
    const longitudes = allPositions.map(([longitude]) => longitude);
    const latitudes = allPositions.map(([, latitude]) => latitude);
    const minLon = Math.min(...longitudes);
    const maxLon = Math.max(...longitudes);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const latitudeCorrection = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const projectedWidth = (maxLon - minLon) * latitudeCorrection;
    const projectedHeight = maxLat - minLat;
    const scale = Math.min(
      (WIDTH - PADDING * 2) / projectedWidth,
      (HEIGHT - PADDING * 2) / projectedHeight,
    );
    const offsetX = (WIDTH - projectedWidth * scale) / 2;
    const offsetY = (HEIGHT - projectedHeight * scale) / 2;
    const project = ([longitude, latitude]: Position): [number, number] => [
      offsetX + (longitude - minLon) * latitudeCorrection * scale,
      offsetY + (maxLat - latitude) * scale,
    ];

    return boundaries.features.map((feature) => {
      const polygons = polygonsOf(feature.geometry);
      const path = polygons
        .flatMap((polygon) =>
          polygon.map((ring) => {
            const points = ring.map(project);
            return points.length
              ? `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`
              : "";
          }),
        )
        .join("");

      return {
        shapeName: feature.properties.shapeName,
        summary: summaries.find((region) => region.region === regionName(feature.properties.shapeName)),
        path,
      };
    });
  }, [boundaries]);

  const selectedRegion = mapRegions.find((region) => region.shapeName === selectedName);
  const activeName = hoveredName ?? selectedName;
  const activeRegion = mapRegions.find((region) => region.shapeName === activeName);
  const activeSummary = activeRegion?.summary;
  const metricLabel = metric === "mean_risk" ? "Mean model score" : "Observed food insecurity rate";
  const reportableValues = mapRegions
    .filter((region) => !region.summary?.suppressed)
    .map((region) => region.summary?.[metric])
    .filter((value): value is number => typeof value === "number");
  const metricMin = Math.min(...reportableValues);
  const metricMax = Math.max(...reportableValues);

  return (
    <section className="region-map-section" aria-labelledby="region-map-heading">
      <div className="region-map-header">
        <div>
          <h2 id="region-map-heading">Regional food-insecurity picture</h2>
          <p className="small muted">
            Hover or focus a region to preview it; click or use the region selector to choose it.
            No household or enumeration-area locations are plotted.
          </p>
        </div>
        <span className="tag">Region-level only</span>
      </div>

      <div className="region-map-controls" role="group" aria-label="Map measure">
        <span className="small">Shade regions by:</span>
        <button
          type="button"
          className={`region-map-toggle${metric === "mean_risk" ? " active" : ""}`}
          aria-pressed={metric === "mean_risk"}
          onClick={() => setMetric("mean_risk")}
        >
          Mean model score
        </button>
        <button
          type="button"
          className={`region-map-toggle${metric === "observed_rate" ? " active" : ""}`}
          aria-pressed={metric === "observed_rate"}
          onClick={() => setMetric("observed_rate")}
        >
          Observed rate
        </button>
      </div>

      {loadError ? (
        <p className="region-map-error" role="alert">
          Regional boundaries could not be loaded: {loadError}
        </p>
      ) : !boundaries ? (
        <p className="small muted" role="status">Loading regional boundaries…</p>
      ) : (
        <>
          <div className="region-map-controls">
            <label className="region-map-select">
              Region
              <select
                value={selectedName}
                onChange={(event) => {
                  setSelectedName(event.target.value);
                  setHoveredName(null);
                }}
              >
                {mapRegions.map((region) => (
                  <option key={region.shapeName} value={region.shapeName}>
                    {region.summary?.region ?? regionName(region.shapeName)}
                    {region.summary?.suppressed ? " — unavailable" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="region-map-layout">
            <div className="region-map-canvas">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="group"
              aria-labelledby="region-map-heading region-map-description"
            >
              <desc id="region-map-description">
                Administrative-region polygons shaded by {metricLabel.toLowerCase()} where
                reportable. Withheld regions are hatched. Select a region to see its summary.
              </desc>
              <defs>
                <pattern
                  id="region-map-hatch"
                  width="8"
                  height="8"
                  patternTransform="rotate(45)"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="8" height="8" fill="#e7e3db" />
                  <line x1="0" x2="0" y2="8" stroke="#827b70" strokeWidth="2" />
                </pattern>
              </defs>
              <g>
                {mapRegions.map((region) => {
                  const value = region.summary?.suppressed ? undefined : region.summary?.[metric];
                  const isSelected = region.shapeName === selectedRegion?.shapeName;
                  const label = region.summary?.region ?? regionName(region.shapeName);
                  return (
                    <path
                      key={region.shapeName}
                      d={region.path}
                      className={`region-map-shape${hoveredName === region.shapeName ? " hovered" : ""}`}
                      fill={region.summary?.suppressed ? "url(#region-map-hatch)" : mapColor(value, metricMin, metricMax)}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      aria-label={`${label}: ${
                        value === undefined
                          ? "summary withheld or unavailable"
                          : `${metricLabel.toLowerCase()} ${formatMetric(value, metric)}, ${int(region.summary?.n)} households`
                      }`}
                      onClick={() => {
                        setSelectedName(region.shapeName);
                        setHoveredName(null);
                      }}
                      onMouseEnter={() => setHoveredName(region.shapeName)}
                      onMouseLeave={() => setHoveredName(null)}
                      onFocus={() => setHoveredName(region.shapeName)}
                      onBlur={() => setHoveredName(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedName(region.shapeName);
                          setHoveredName(null);
                        }
                      }}
                    >
                      <title>{label}: {metricLabel} {formatMetric(value, metric)}</title>
                    </path>
                  );
                })}
                <path
                  className="region-map-boundary-network"
                  d={mapRegions.map((region) => region.path).join("")}
                  aria-hidden="true"
                />
              </g>
            </svg>
          </div>

          <div className="region-map-details" aria-live="polite">
            <h3>{activeSummary?.region ?? activeRegion?.shapeName ?? "Region summary"}</h3>
            {!activeSummary || activeSummary.suppressed ? (
              <>
                <span className="tag">Withheld or unavailable</span>
                <p className="small muted">
                  {activeSummary?.note ?? "No reportable summary is available."} A blank map cell
                  is not zero risk.
                </p>
              </>
            ) : (
              <>
                <p className="stat">
                  {metric === "mean_risk"
                    ? num(activeSummary[metric], 2)
                    : pct(activeSummary[metric], 1)}
                </p>
                <p className="small">{metricLabel} · {int(activeSummary.n)} held-out households</p>
                <dl className="detail-list region-map-stat-list">
                  <div><dt>Mean model score</dt><dd>{num(activeSummary.mean_risk, 2)}</dd></div>
                  <div><dt>Observed food insecurity</dt><dd>{pct(activeSummary.observed_rate, 1)}</dd></div>
                  <div><dt>Flagged for follow-up</dt><dd>{pct(activeSummary.flagged_share, 1)}</dd></div>
                  <div><dt>High score band</dt><dd>{pct(activeSummary.high_share, 1)}</dd></div>
                  <div><dt>Survey areas</dt><dd>{int(activeSummary.n_areas)}</dd></div>
                </dl>
                <p className="small faint">
                  Largest profile: {activeSummary.top_cluster ?? "Not available"}.
                  {activeSummary.agricultural_accuracy !== undefined
                    ? ` Evaluation accuracy: ${pct(activeSummary.agricultural_accuracy, 1)}.`
                    : ""}
                </p>
              </>
            )}
            <p className="small faint">
              Regional average only; not a prediction for an individual household or a current
              condition estimate.
            </p>
          </div>
        </div>
        </>
      )}

      <ul className="region-map-legend" aria-label="Map legend">
        <li>
          {metricLabel}: {formatMetric(metricMin, metric)}
          <span className="legend-gradient" aria-hidden="true" />
          {formatMetric(metricMax, metric)}
        </li>
        <li><span className="legend-swatch legend-suppressed" /> Withheld / unavailable</li>
      </ul>
      <p className="small faint">
        Colour is a relative comparison across reportable regions, not an eligibility category or a
        calibrated risk band. Boundary: simplified geoBoundaries Ethiopia ADM1 (2016), sourced from
        Open Africa / Code for Ethiopia.{" "}
        <a href="https://www.geoboundaries.org/api/current/gbOpen/ETH/ADM1/" target="_blank" rel="noreferrer">
          Boundary details
        </a>{" "}
        ·{" "}
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
          CC BY 4.0
        </a>
        .
      </p>
    </section>
  );
}
