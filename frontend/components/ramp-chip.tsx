import { BAND_NOTE, rampClass } from "@/lib/format";

/**
 * RampChip -- the band as a chip on the risk ramp.
 *
 * The band word always travels with "descriptive, not calibrated" somewhere in
 * the block, and the chip itself carries the word rather than relying on colour
 * alone: the ramp is lightness-monotonic for print, but a chip with no label
 * still fails in greyscale and in colour-vision deficiency.
 */

export function RampChip({
  band,
  withNote = false,
  size = "chip",
}: {
  band: string | null | undefined;
  withNote?: boolean;
  size?: "chip" | "chip-lg";
}) {
  return (
    <span className="chip-wrap">
      <span className={`chip ${rampClass(band)} ${size}`}>{band ?? "—"}</span>
      {withNote ? <span className="small faint">{BAND_NOTE}</span> : null}
    </span>
  );
}

/**
 * The ramp itself, drawn as its own legend: four dry-straw-to-clay steps, no
 * red and no green. Also used as the print-safe colour key.
 */
export function RampLegend() {
  const steps = [
    { key: "Low", className: "ramp-low" },
    { key: "Moderate", className: "ramp-moderate" },
    { key: "High", className: "ramp-high" },
  ];
  return (
    <div className="ramp-legend" role="list" aria-label="Risk bands">
      {steps.map((step) => (
        <span className="ramp-legend-step" role="listitem" key={step.key}>
          <span className={`swatch ${step.className}`} aria-hidden="true" />
          <span className="small">{step.key}</span>
        </span>
      ))}
    </div>
  );
}
