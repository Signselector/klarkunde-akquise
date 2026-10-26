/** Country flags as small SVGs. Emoji flags show up as plain letters on Windows, so they are drawn here. */
const STRIPES: Record<string, string[]> = {
  DE: ["#000000", "#DD0000", "#FFCE00"],
  AT: ["#ED2939", "#FFFFFF", "#ED2939"],
  NL: ["#AE1C28", "#FFFFFF", "#21468B"],
};

export function Flag({ code, size = 22 }: { code: string; size?: number }) {
  const colors = STRIPES[code];
  if (!colors) return null;
  return (
    <svg
      width={size}
      height={Math.round((size * 2) / 3)}
      viewBox="0 0 3 2"
      aria-hidden="true"
      focusable="false"
      style={{ borderRadius: 3, boxShadow: "0 0 0 1px rgb(0 0 0 / 18%)", flexShrink: 0 }}
    >
      {colors.map((c, i) => (
        <rect key={i} y={i * (2 / 3)} width="3" height={2 / 3 + 0.01} fill={c} />
      ))}
    </svg>
  );
}
