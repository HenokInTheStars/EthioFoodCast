/**
 * Number and label formatting. The design brief is explicit: three decimals
 * maximum, tabular figures, and `0.5211760401725769` renders as `0.52`. Raw
 * float precision implies accuracy the model does not claim.
 */

const PLACEHOLDER = "\u2014"; // em dash: "not available", never a fake 0

export function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return PLACEHOLDER;
  const rounded = Math.abs(value) < 1 ? value : Math.round(value);
  const text = rounded.toFixed(Math.min(digits, 3));
  // Strip trailing zeros only after a decimal point. A blanket /\.?0+$/ would
  // turn the integer 100 into "1".
  return (text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text) || "0";
}

export function pct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return PLACEHOLDER;
  return `${(value * 100).toFixed(Math.min(digits, 3))}%`;
}

export function int(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? PLACEHOLDER : Math.round(value).toLocaleString("en");
}

/**
 * The risk ramp is four steps of dry straw to deep clay, monotonic in
 * lightness so it survives greyscale printing, with no red or green: green
 * reads "eligible", red reads "punished", and this gets printed.
 */
const RAMP: Record<string, string> = {
  high: "ramp-high",
  moderate: "ramp-moderate",
  low: "ramp-low",
};

export function rampClass(band: string | null | undefined): string {
  const key = (band ?? "").trim().toLowerCase();
  return RAMP[key] ?? "ramp-unknown";
}

/** band word -> short, print-safe description. Bands are not assistance categories. */
export const BAND_NOTE = "descriptive, not calibrated";
