/**
 * The EthioFoodCast mark: three rising bars in the risk ramp's own colours on a
 * white tile. It reuses the ramp on purpose, so the brand never introduces a
 * fourth "risk-like" colour. Decorative: the text beside it carries the name.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="7" fill="#ffffff" />
      <rect x="7" y="17" width="5" height="8" rx="1.2" fill="#e8d79c" />
      <rect x="13.5" y="12" width="5" height="13" rx="1.2" fill="#e0b071" />
      <rect x="20" y="7" width="5" height="18" rx="1.2" fill="#b4632b" />
    </svg>
  );
}
