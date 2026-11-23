"use client";

import { useMemo, useState } from "react";

import areasData from "@/data/areas.json";
import driversData from "@/data/artifacts/drivers.json";
import regionalData from "@/data/artifacts/regional_summary.json";
import { RegionMap } from "@/components/region-map";
import { int, num, pct } from "@/lib/format";

type Area = {
  id: string;
  label: string;
  region_code: number;
  region_name: string;
  zone: string | null;
  woreda: string | null;
  zone_verified?: boolean;
  woreda_verified?: boolean;
};

type RegionSummary = {
  region_code: number;
  region: string;
  n: number;
  suppressed: boolean;
  note?: string;
  mean_risk?: number;
  observed_rate?: number;
  n_areas?: number;
};

const areas = areasData as Area[];
const regions = regionalData as unknown as RegionSummary[];
const areaContext = driversData.fields.find((field) => field.field === "area_context");

export default function SpatialPage() {
  const [regionCode, setRegionCode] = useState("all");
  const [search, setSearch] = useState("");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");

  const regionOptions = useMemo(
    () => [...new Map(areas.map((area) => [area.region_code, area.region_name])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1])),
    [],
  );
  const visibleAreas = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return areas.filter((area) => {
      if (regionCode !== "all" && area.region_code !== Number(regionCode)) return false;
      return query.length === 0
        || `${area.label} ${area.region_name} ${area.zone ?? ""} ${area.woreda ?? ""}`
          .toLocaleLowerCase()
          .includes(query);
    });
  }, [regionCode, search]);
  const selectedArea = visibleAreas.find((area) => area.id === areaId) ?? visibleAreas[0];
  const selectedRegion = selectedArea
    ? regions.find((region) => region.region_code === selectedArea.region_code)
    : undefined;
  const regionAreaCount = selectedArea
    ? areas.filter((area) => area.region_code === selectedArea.region_code).length
    : 0;

  return (
    <>
      <h1>Regional map</h1>
      <p className="muted">
        Compare predicted risk and actual food insecurity region by region, then look up any survey area to
        see its region, zone and woreda.
      </p>


      <RegionMap />

      <div className="filters">
        <label>
          Region
          <select value={regionCode} onChange={(event) => setRegionCode(event.target.value)}>
            <option value="all">All regions</option>
            {regionOptions.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>
        <label className="grow">
          Find an area
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search region, zone, woreda, or label"
          />
        </label>
        <label className="grow">
          Survey area
          <select
            value={selectedArea?.id ?? ""}
            onChange={(event) => setAreaId(event.target.value)}
            disabled={visibleAreas.length === 0}
          >
            {visibleAreas.map((area) => (
              <option key={area.id} value={area.id}>{area.label} — {area.region_name}</option>
            ))}
          </select>
        </label>
      </div>

      {selectedArea ? (
        <>
          <p className="small faint">
            Showing {int(visibleAreas.length)} of {int(areas.length)} areas.
          </p>
          <div className="grid spatial-grid">
            <section className="card" aria-labelledby="selected-area-heading">
              <h2 id="selected-area-heading">{selectedArea.label}</h2>
              <p className="small muted">Survey-area name match; not a precise household location.</p>
              <dl className="detail-list">
                <div><dt>Region</dt><dd>{selectedArea.region_name}</dd></div>
                <div>
                  <dt>Zone</dt>
                  <dd>{selectedArea.zone ?? "Not identified"}{" "}
                    <span className="tag">{selectedArea.zone_verified ? "verified" : "inferred"}</span>
                  </dd>
                </div>
                <div>
                  <dt>Woreda</dt>
                  <dd>{selectedArea.woreda ?? "Not identified"}{" "}
                    <span className="tag">{selectedArea.woreda_verified ? "verified" : "inferred"}</span>
                  </dd>
                </div>
                <div><dt>Areas listed in region</dt><dd>{int(regionAreaCount)}</dd></div>
              </dl>
            </section>

            <section className="card" aria-labelledby="region-summary-heading">
              <h2 id="region-summary-heading">Region summary</h2>
              {!selectedRegion || selectedRegion.suppressed ? (
                <>
                  <p className="stat">Withheld</p>
                  <p className="small muted">
                    {selectedRegion?.note ?? "No reportable regional summary is available."} A
                    withheld value is not zero.
                  </p>
                </>
              ) : (
                <>
                  <p className="small faint">{int(selectedRegion.n)} test households</p>
                  <dl className="detail-list">
                    <div><dt>Average score</dt><dd>{num(selectedRegion.mean_risk, 2)}</dd></div>
                    <div><dt>Food insecure</dt><dd>{pct(selectedRegion.observed_rate, 1)}</dd></div>
                    <div><dt>Survey areas</dt><dd>{int(selectedRegion.n_areas)}</dd></div>
                  </dl>
                  <p className="small muted">
                    Figures for the whole region, not for this area or any household.
                  </p>
                </>
              )}
            </section>
          </div>
        </>
      ) : (
        <p className="empty-state">No surveyed area matches those filters.</p>
      )}

      <section className="readiness-panel spatial-context" aria-labelledby="model-context-heading">
        <h2 id="model-context-heading">Why the survey area matters</h2>
        <p>
          The model learns patterns from each survey area and its neighbouring areas. On the test households,
          leaving that information out changed a score by {num(areaContext?.mean_abs, 2)} on average (on a scale
          of 0 to 1), more than any single answer. This shows how the model works; it does not mean an area
          causes food insecurity.
        </p>
        <p className="small faint">
          The map shows region-level figures only. Household and village locations are never shown.
        </p>
      </section>
    </>
  );
}
