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
    <div className="area-field">
      <label htmlFor="area-search" className="area-field-label">
        {label}
      </label>
      <p className="help">{help}</p>
      <div className="search-input">
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          id="area-search"
          type="search"
          autoComplete="off"
          placeholder={`Search ${areas.length} areas by woreda, zone or region`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {selected ? (
        <div className="area-selected" role="status">
          <span className="area-selected-label">Selected area</span>
          <strong>{selected.label}</strong>
          <span className="area-meta">
            {selected.region_name}
            {selected.zone ? ` · ${selected.zone}` : ""}
          </span>
          {typeof selected.zone_verified === "boolean" ? (
            <span className="area-badges">
              <span className={selected.zone_verified ? "badge verified" : "badge"}>
                Zone {selected.zone_verified ? "verified" : "inferred"}
              </span>
              <span className={selected.woreda_verified ? "badge verified" : "badge"}>
                Woreda {selected.woreda_verified ? "verified" : "inferred"}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      <ul className="area-results" aria-label="Matching areas">
        {matches.length === 0 ? (
          <li className="area-empty">No area matches “{deferred}”. Try a shorter word.</li>
        ) : (
          matches.map((area) => (
            <li key={area.id}>
              <button
                type="button"
                className={area.id === value ? "area-option selected" : "area-option"}
                aria-pressed={area.id === value}
                onClick={() => onChange(area.id)}
              >
                <span className="area-option-name">{area.label}</span>
                <span className="area-meta">
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
      <p className="area-count">
        {deferred.trim().length === 0 && areas.length > 40
          ? `Showing 40 of ${areas.length} areas. Type to narrow the list.`
          : `${matches.length} matching area${matches.length === 1 ? "" : "s"}${matches.length === 40 ? " (first 40 shown)" : ""}.`}
      </p>
    </div>
  );
}
