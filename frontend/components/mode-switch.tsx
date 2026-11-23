"use client";

import { useEffect, useState } from "react";

import { LENSES, useLens } from "@/lib/lens";

/**
 * ModeSwitch and DensityToggle -- the chrome controls from the brief.
 *
 * The lens control is a segmented control, not a dropdown: it is the primary
 * statement of what kind of reading is happening, and it should be visible
 * without a click. It never changes which data exists.
 *
 * Density is a separate axis the brief asks for: lens decides how much detail
 * shows, density decides how tightly it is set. Both are stored so a field
 * assessor's choice survives a reload on a shared tablet.
 */

const DENSITY_KEY = "efc.density";
type Density = "comfortable" | "compact";

const DENSITIES: { id: Density; label: string; hint: string }[] = [
  { id: "comfortable", label: "Aa", hint: "Comfortable reading size" },
  { id: "compact", label: "aa", hint: "Compact: more rows on screen" },
];

export function ModeSwitch() {
  const { lens, setLens } = useLens();

  return (
    <div className="mode-switch" role="radiogroup" aria-label="Reading mode">
      {LENSES.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="radio"
          aria-checked={lens === entry.id}
          title={entry.hint}
          className={lens === entry.id ? "mode-option active" : "mode-option"}
          onClick={() => setLens(entry.id)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}

export function DensityToggle() {
  const [density, setDensity] = useState<Density>("comfortable");

  // Restored after mount, so server and client markup agree.
  useEffect(() => {
    const stored = window.localStorage.getItem(DENSITY_KEY);
    const next: Density = stored === "compact" ? "compact" : "comfortable";
    setDensity(next);
    document.documentElement.dataset.density = next;
  }, []);

  const set = (next: Density) => {
    setDensity(next);
    window.localStorage.setItem(DENSITY_KEY, next);
    document.documentElement.dataset.density = next;
  };

  return (
    <div className="mode-switch density" role="radiogroup" aria-label="Text density">
      {DENSITIES.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="radio"
          aria-checked={density === entry.id}
          title={entry.hint}
          aria-label={entry.hint}
          className={density === entry.id ? "mode-option active" : "mode-option"}
          onClick={() => set(entry.id)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
