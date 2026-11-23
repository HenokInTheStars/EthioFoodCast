import { int } from "@/lib/format";

/**
 * Histogram -- the raw score distribution, not a smoothed curve.
 *
 * The brief asks for the raw histogram on /situation, with the flag threshold
 * drawn in as a line rather than shaded as a "good zone". A threshold is a
 * single chosen operating point on one metric; shading it implies the model is
 * right up to it and wrong past it, which the metrics do not support.
 *
 * Bars are rendered as a flex row with heights from the data, and every bar is
 * labelled with its count so the chart still reads when printed in greyscale.
 */

export function Histogram({
  edges,
  counts,
  threshold,
  height = 96,
}: {
  edges: number[];
  counts: number[];
  threshold?: number | null;
  height?: number;
}) {
  const max = counts.reduce((biggest, count) => Math.max(biggest, count), 0);
  if (max === 0) return <p className="small faint">No scored households to plot.</p>;

  // Which bar contains the threshold, so the marker lines up with a column.
  let thresholdIndex = -1;
  if (typeof threshold === "number") {
    thresholdIndex = edges.findIndex(
      (edge, index) => index < edges.length - 1 && threshold < (edges[index + 1] ?? Infinity),
    );
  }

  return (
    <figure className="histogram">
      <div className="histogram-plot" style={{ height }}>
        {counts.map((count, index) => (
          <div className="histogram-col" key={index}>
            <div
              className={`histogram-bar ${index <= thresholdIndex ? "flagged" : ""}`}
              style={{ height: `${(count / max) * 100}%` }}
              title={`${edges[index]?.toFixed(1)}–${edges[index + 1]?.toFixed(1)}: ${int(count)} households`}
            >
              <span className="histogram-count small">{int(count)}</span>
            </div>
          </div>
        ))}
        {thresholdIndex >= 0 ? (
          <div
            className="histogram-threshold"
            style={{ left: `${((thresholdIndex + 1) / counts.length) * 100}%` }}
          >
            <span className="small">cut-off {threshold?.toFixed(2)}</span>
          </div>
        ) : null}
      </div>
      <figcaption className="small faint">
        {edges[0]?.toFixed(1)} to {edges[edges.length - 1]?.toFixed(1)} score,{" "}
        {int(counts.reduce((total, count) => total + count, 0))} households. Households to the right
        of the line are flagged for a follow-up visit.
      </figcaption>
    </figure>
  );
}
