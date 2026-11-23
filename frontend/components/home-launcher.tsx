"use client";

import { useEffect, useState } from "react";

import areasData from "@/data/areas.json";
import { AreaSearch } from "@/components/area-search";
import { ASSESS_DRAFT_KEY, ASSESS_RECENTS_KEY, type RecentAssessment } from "@/lib/local-data";
import { num } from "@/lib/format";

type Draft = { answers?: Record<string, string>; areaId?: string; savedAt?: string };
type Area = {
  id: string;
  label: string;
  region_name: string;
  zone: string | null;
  woreda: string | null;
  zone_verified: boolean;
  woreda_verified: boolean;
};

const areas = areasData as Area[];

export function HomeLauncher() {
  const [areaId, setAreaId] = useState("");
  const [hasDraft, setHasDraft] = useState(false);
  const [recents, setRecents] = useState<RecentAssessment[]>([]);

  useEffect(() => {
    try {
      const rawDraft = window.localStorage.getItem(ASSESS_DRAFT_KEY);
      if (rawDraft) {
        const draft = JSON.parse(rawDraft) as Draft;
        const hasAnswers = Boolean(draft.answers && Object.keys(draft.answers).length > 0);
        setHasDraft(hasAnswers);
        if (typeof draft.areaId === "string") setAreaId(draft.areaId);
      }
      const rawRecents = window.localStorage.getItem(ASSESS_RECENTS_KEY);
      if (rawRecents) {
        const parsed = JSON.parse(rawRecents) as RecentAssessment[];
        if (Array.isArray(parsed)) setRecents(parsed.slice(0, 5));
      }
    } catch {
      setHasDraft(false);
      setRecents([]);
    }
  }, []);

  function startAssessment() {
    if (!areaId) return;
    try {
      const existing = window.localStorage.getItem(ASSESS_DRAFT_KEY);
      if (!existing) {
        window.localStorage.setItem(
          ASSESS_DRAFT_KEY,
          JSON.stringify({ answers: {}, areaId, savedAt: new Date().toISOString() }),
        );
      }
    } catch {
      // The assessment remains usable if this browser does not allow local storage.
    }
  }

  const selectedArea = areas.find((area) => area.id === areaId);

  return (
    <section className="card home-launcher" aria-labelledby="launcher-title">
      <h2 id="launcher-title">Start a household assessment</h2>
      <p className="small muted">
        Choose the surveyed area first. The area supplies neighbourhood context and can strongly affect a score.
        Area labels may be approximate.
      </p>
      <AreaSearch
        areas={areas}
        value={areaId}
        onChange={setAreaId}
        help="Search by area, woreda, zone or region. Verification labels describe the area name, not the household."
      />
      {selectedArea ? (
        <p className="small">
          Selected: <strong>{selectedArea.label}</strong> ({selectedArea.region_name}); zone{" "}
          {selectedArea.zone_verified ? "verified" : "inferred"}, woreda{" "}
          {selectedArea.woreda_verified ? "verified" : "inferred"}.
        </p>
      ) : null}
      <a
        className={`button-link${areaId ? "" : " disabled"}`}
        href={areaId ? "/assess" : undefined}
        aria-disabled={!areaId}
        onClick={(event) => {
          if (!areaId) {
            event.preventDefault();
            return;
          }
          startAssessment();
        }}
      >
        {hasDraft ? "Continue saved assessment" : "Start assessment"}
      </a>
      <p className="small faint">Drafts are stored in this browser only, on this device.</p>

      {recents.length > 0 ? (
        <div className="recent-assessments">
          <h3>Recent on this device</h3>
          <ul className="plain small">
            {recents.map((recent) => (
              <li key={`${recent.scoredAt}-${recent.areaId}`}>
                {recent.areaLabel} · {recent.riskBand}
                {recent.probability === null ? "" : ` · score ${num(recent.probability, 2)}`} ·{" "}
                {new Date(recent.scoredAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
