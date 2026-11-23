"use client";

import { useDeferredValue, useMemo, useState } from "react";

import areasData from "@/data/areas.json";
import summaryData from "@/data/artifacts/area_names.json";
import { int, pct } from "@/lib/format";

/**
 * /areas -- the 427 surveyed areas, and how much to trust each label.
 *
 * The brief insists the "(approx.)" in every area label deserves a real page
 * rather than a tooltip, and this is that page: the names were derived by
 * matching survey codes to OCHA administrative boundaries, and the summary says
 * how often that match was verified. Zone names verified 85.7% of the time,
 * woreda names only 22.5% -- a gap large enough that hiding it would make the
 * woreda column look more certain than it is.
 *
 * No coordinates are exported, so this is a table and not a choropleth. A map
 * would need an external boundary file, and drawing points would imply a
 * precision the data does not have.
 */

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

const areas = areasData as Area[];
const summary = (summaryData as { summary: Record<string, unknown> }).summary;

export default function AreasPage() {
  const [query, setQuery] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const deferred = useDeferredValue(query);

  const filtered = useMemo(() => {
    const needle = deferred.trim().toLowerCase();
    return areas.filter((area) => {
      if (verifiedOnly && !area.zone_verified) return false;
      if (needle.length === 0) return true;
      return `${area.label} ${area.region_name} ${area.woreda ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [deferred, verifiedOnly]);

  const zoneVerified = areas.filter((area) => area.zone_verified).length;
  const woredaVerified = areas.filter((area) => area.woreda_verified).length;

  return (
    <>
      <h1>Survey areas</h1>
      <p className="muted">
        Every household is scored together with the area where it was surveyed. Area names were matched from
        survey codes to official boundaries; where the match is not confirmed, the name carries “(approx.)”.
      </p>

      <div className="grid" style={{ marginBottom: "var(--rhythm)" }}>
        <div className="card">
          <h3>Surveyed areas</h3>
          <div className="stat">{int(areas.length)}</div>
          <div className="small faint">used when scoring a household</div>
        </div>
        <div className="card">
          <h3>Zone name verified</h3>
          <div className="stat">{pct(areas.length ? zoneVerified / areas.length : null, 1)}</div>
          <div className="small faint">
            {int(zoneVerified)} of {int(areas.length)} areas
          </div>
        </div>
        <div className="card">
          <h3>Woreda name verified</h3>
          <div className="stat">{pct(areas.length ? woredaVerified / areas.length : null, 1)}</div>
          <div className="small faint">
            {int(woredaVerified)} of {int(areas.length)} areas
          </div>
        </div>
      </div>

      <h2>How a name was assigned</h2>
      <p className="small">
        {String(summary.rule ?? "Survey code group majority name.")} Source:{" "}
        {String(summary.source ?? "OCHA administrative boundaries.")} A zone name is marked verified
        when the survey zone code and the administrative zone agree; a woreda name is verified only
        when the survey woreda code matches. Everything else is inferred, and the label says so.
      </p>
      <p className="small muted">
        The woreda column is far less verified than the zone column. Treat a woreda name as a hint
        about location, not an identifier.
      </p>

      <div className="filters">
        <label className="grow">
          Search
          <input
            type="search"
            value={query}
            placeholder="Woreda, zone or region"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(event) => setVerifiedOnly(event.target.checked)}
          />
          Zone-verified only
        </label>
      </div>

      <p className="small">
        Showing <strong>{int(Math.min(filtered.length, 300))}</strong> of {int(filtered.length)}{" "}
        matching areas.
      </p>


      <table>
        <thead>
          <tr>
            <th>Area</th>
            <th>Region</th>
            <th>Zone</th>
            <th>Woreda</th>
            <th>Name confidence</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 300).map((area) => (
            <tr key={area.id}>
              <td className="small">{area.label}</td>
              <td className="small">{area.region_name}</td>
              <td className="small">
                {area.zone ?? "—"}
                <span className={area.zone_verified ? "tag ok" : "tag"}>
                  {area.zone_verified ? "verified" : "inferred"}
                </span>
              </td>
              <td className="small">
                {area.woreda ?? "—"}
                <span className={area.woreda_verified ? "tag ok" : "tag"}>
                  {area.woreda_verified ? "verified" : "inferred"}
                </span>
              </td>
              <td className="small faint">
                {area.zone_verified && area.woreda_verified
                  ? "both verified"
                  : area.zone_verified
                    ? "zone only"
                    : area.woreda_verified
                      ? "woreda only"
                      : "neither"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {filtered.length === 0 ? <p className="muted">No area matches that search.</p> : null}

      <p className="footnote small">
        {Number(summary.areas_without_zone_name ?? 0) > 0
          ? `${int(Number(summary.areas_without_zone_name))} areas have no zone name at all and show only a region. `
          : ""}
        Area locations are never shown, only names.
      </p>
    </>
  );
}
