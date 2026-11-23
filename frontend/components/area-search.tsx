"use client";

import { useDeferredValue, useMemo, useState } from "react";

/**
 * AreaSearch -- searchable 427-area picker.
 *
 * 427 options is past the point where a <select> is usable: a assessor knows the
 * woreda or the zone, not the surrogate id, and the labels carry "(approx.)" for
 * a reason that deserves to be seen rather than hidden in a title attribute.
 * The verification flags (zone_verified, woreda_verified) are shown on each
 * result, because they are the honest confidence in the label.
 */

export type AreaOption = {
  id: string;
  label: string;
  region_name?: string;
  zone?: string | null;
  woreda?: string | null;
  zone_verified?: boolean;
  woreda_verified?: boolean;
};

export function AreaSearch({
  areas,
  value,
  onChange,
  label = "Surveyed area the household belongs to",
  help = "The model uses the surveyed area as graph context. Choose the area the household was surveyed in.",
}: {
  areas: AreaOption[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  help?: string;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);

  const matches = useMemo(() => {
    const needle = deferred.trim().toLowerCase();
    if (needle.length === 0) return areas.slice(0, 40);
    const scored: { area: AreaOption; score: number }[] = [];
    for (const area of areas) {
      const haystack = `${area.label} ${area.region_name ?? ""} ${area.zone ?? ""} ${area.woreda ?? ""}`.toLowerCase();
      const at = haystack.indexOf(needle);
      if (at === -1) continue;
      // Prefer a match at the start of the label, then anywhere in the label,
      // then only in the region name.
      scored.push({ area, score: at === 0 ? 0 : haystack.startsWith(needle) ? 1 : 2 });
    }
    return scored.sort((a, b) => a.score - b.score).slice(0, 40).map((entry) => entry.area);
  }, [areas, deferred]);

  const selected = areas.find((area) => area.id === value);

  return (
    <div className="field area-field">
      <label htmlFor="area-search">{label}</label>
      <input
        id="area-search"
        type="search"
        autoComplete="off"
        placeholder="Search by woreda, zone or region — 427 areas"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className="help">{help}</p>

      {selected ? (
        <p className="small">
          Selected: <strong>{selected.label}</strong>
          {typeof selected.zone_verified === "boolean" ? (
            <span className="faint">
              {" "}
              · zone {selected.zone ?? "not named"} ({selected.zone_verified ? "verified" : "inferred"}) ·
              woreda {selected.woreda ?? "not named"} ({selected.woreda_verified ? "verified" : "inferred"})
            </span>
          ) : null}
        </p>
      ) : null}

      <ul className="area-results" aria-label="Matching areas">
        {matches.length === 0 ? (
          <li className="small faint">No area matches “{deferred}”. Try a shorter word.</li>
        ) : (
          matches.map((area) => (
            <li key={area.id}>
              <button
                type="button"
                className={area.id === value ? "area-option selected" : "area-option"}
                onClick={() => onChange(area.id)}
              >
                <span>{area.label}</span>
                <span className="faint small">
                  {area.region_name}
                  {area.zone ? ` · ${area.zone}` : ""}
                  {` · zone ${area.zone_verified ? "verified" : "inferred"}`}
                  {` · woreda ${area.woreda_verified ? "verified" : "inferred"}`}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
      {deferred.trim().length === 0 && areas.length > 40 ? (
        <p className="small faint">Showing the first 40 of {areas.length}. Type to narrow.</p>
      ) : null}
    </div>
  );
}
