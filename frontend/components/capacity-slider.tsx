"use client";

/**
 * CapacitySlider -- how many households this team can actually follow up.
 *
 * The list is only useful against a real capacity: 484 ranked households with
 * two field teams is a different document from the same list with forty. The
 * slider changes how many rows are shown and reports coverage honestly.
 *
 * It deliberately does NOT show a predicted precision for the chosen coverage.
 * The only measured figure is at the top 25%, so it is shown as a historical
 * benchmark with that stated, at equal weight -- never as an expected value.
 */

export function CapacitySlider({
  total,
  rankable,
  value,
  onChange,
  historicalPrecision,
}: {
  total: number;
  rankable: number;
  value: number;
  onChange: (capacity: number) => void;
  /** precision_at_25pct, a past measurement at one coverage. */
  historicalPrecision?: number | null;
}) {
  const max = Math.max(1, rankable);
  const coverage = rankable > 0 ? (value / rankable) * 100 : 0;

  return (
    <div className="capacity">
      <label htmlFor="capacity" className="capacity-label">
        <strong>Assessment capacity</strong>
        <span className="tabular">
          {value} of {rankable} rankable
        </span>
      </label>
      <input
        id="capacity"
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <p className="small">
        Covers <strong>{coverage.toFixed(1)}%</strong> of the {rankable} households that could be
        ranked{total > rankable ? ` (${total - rankable} of ${total} could not be scored and are excluded, not ranked last)` : ""}.
      </p>
      {typeof historicalPrecision === "number" ? (
        <p className="small precision-note">
          <strong>A past result, not a promise:</strong> in testing, {Math.round(historicalPrecision * 100)}%
          of the top quarter of the list were food insecure. This selection covers {coverage.toFixed(0)}%;
          the wider the selection, the lower that share is likely to be.
        </p>
      ) : null}
    </div>
  );
}
