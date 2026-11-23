"use client";

import { useId, useState } from "react";

/**
 * ProvenanceChip -- "where did this number come from", attached to every figure.
 *
 * The brief makes this a Phase-0 component because in a multi-lens design it is
 * the only thing that stops four visual dialects from asserting numbers
 * differently. The chip states the source and the protocol; the detail is one
 * click away, never behind a tooltip (tooltips do not survive print, and this
 * product gets printed).
 *
 * It never claims more than the artifact does. If a protocol is unknown, the
 * chip says so rather than inventing one.
 */

export type Provenance = {
  /** Short label shown on the chip, e.g. "held-out seed 0". */
  source: string;
  /** The measurement protocol, shown when opened. */
  protocol?: string;
  /** When the artifact was produced, if known. */
  generatedAt?: string;
  /** Caveat that must render at equal weight, not as an asterisk. */
  note?: string;
};

export function ProvenanceChip({ source, protocol, generatedAt, note }: Provenance) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const hasDetail = Boolean(protocol || note || generatedAt);

  return (
    <span className="provenance">
      <button
        type="button"
        className="chip chip-provenance"
        aria-expanded={hasDetail ? open : undefined}
        aria-controls={hasDetail ? id : undefined}
        disabled={!hasDetail}
        onClick={() => setOpen((was) => !was)}
      >
        {source}
      </button>
      {hasDetail && open ? (
        <span className="provenance-detail" id={id}>
          {protocol ? <span className="small">{protocol}</span> : null}
          {generatedAt ? (
            <span className="small faint">
              {" "}
              data generated {generatedAt.slice(0, 10)}
            </span>
          ) : null}
          {note ? <span className="small provenance-note">{note}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
