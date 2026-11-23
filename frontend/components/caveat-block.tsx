import { ProvenanceChip, type Provenance } from "./provenance-chip";

/**
 * CaveatBlock -- the three facts that are never behind a tooltip.
 *
 * The brief is explicit that the 61% baseline, "bands are descriptive, not
 * calibrated", and "top_factors are sensitivities, not causes" travel next to
 * the number. This renders them at full weight, with the model version they
 * came from, so a screenshot or a printout still carries them.
 */

export type CaveatBlockProps = {
  caveats: string[];
  /** Attaches the provenance chip; omit on pages that state it elsewhere. */
  provenance?: Provenance;
  title?: string;
};

export function CaveatBlock({ caveats, provenance, title = "What this number is not" }: CaveatBlockProps) {
  if (caveats.length === 0) return null;

  return (
    <aside className="caveats">
      <div className="caveat-head">
        <h3>{title}</h3>
        {provenance ? <ProvenanceChip {...provenance} /> : null}
      </div>
      <ul className="plain">
        {caveats.map((caveat) => (
          <li key={caveat} className="small">
            {caveat}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * The two facts the brief says must accompany every risk figure. Kept here so
 * no screen can quietly drop one of them.
 */
export function AlwaysVisibleFacts({ observedRate }: { observedRate: number | null }) {
  return (
    <ul className="plain facts">
      <li className="small">
        {observedRate === null ? "—" : `${Math.round(observedRate * 100)}%`} of held-out households
        were food insecure, so answering &ldquo;insecure&rdquo; every time scores{" "}
        {observedRate === null ? "—" : `${Math.round(observedRate * 100)}%`}. The model has to beat
        that to be worth anything.
      </li>
      <li className="small">
        Bands are descriptive groupings of the score, not calibrated categories of assistance. A
        household just under a cut point is not meaningfully different from one just over it.
      </li>
      <li className="small">
        The listed factors are how sensitive <em>this prediction</em> was to each answer. They are
        not causes and they do not sum to the score.
      </li>
    </ul>
  );
}
