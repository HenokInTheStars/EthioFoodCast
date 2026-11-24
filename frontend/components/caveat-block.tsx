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
