/**
 * The EthioFoodCast mark: an E whose spine is a wheat stalk and whose three arms
 * are bars in the risk ramp's own colours, on a white tile. This is the compact
 * drawing (three leaves a side) that stays legible at header and favicon sizes;
 * public/logo.svg is the detailed version for large use. Decorative: the text
 * beside it carries the name.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 128 128"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="128" height="128" rx="27" fill="#ffffff" />
      <g transform="translate(8.75 14)">
        <path
          fill="#0b2a45"
          d="M14.6 0C18.2 3.4 19.4 8 17.2 13.5V100H12V13.5C9.8 8 11 3.4 14.6 0ZM10.4 30Q-0.2 29.6 -0.6 10Q10 10.6 10.4 30ZM18.8 30Q29.4 29.6 29.8 10Q19.2 10.6 18.8 30ZM10.4 55.5Q-0.2 55.1 -0.6 35.5Q10 36.1 10.4 55.5ZM18.8 55.5Q29.4 55.1 29.8 35.5Q19.2 36.1 18.8 55.5ZM10.4 81Q-0.2 80.6 -0.6 61Q10 61.6 10.4 81ZM18.8 81Q29.4 80.6 29.8 61Q19.2 61.6 18.8 81Z"
        />
        <path fill="#b4632b" d="M33.5 0H99.5A11 11 0 0 1 99.5 22H33.5Z" />
        <path fill="#e0b071" d="M33.5 39H83A11 11 0 0 1 83 61H33.5Z" />
        <path fill="#e8d79c" d="M20 86Q27 84 32 78H65A11 11 0 0 1 65 100H20Z" />
      </g>
    </svg>
  );
}
