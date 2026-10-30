/** Country flags as small SVGs. Emoji flags show up as plain letters on Windows, so they are drawn here. */
const STRIPES: Record<string, string[]> = {
  DE: ["#000000", "#DD0000", "#FFCE00"],
  AT: ["#ED2939", "#FFFFFF", "#ED2939"],
  NL: ["#AE1C28", "#FFFFFF", "#21468B"],
};

/** Union Jack for the English language switch. */
function UnionJack({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={Math.round(size / 2)}
      viewBox="0 0 60 30"
      aria-hidden="true"
      focusable="false"
      style={{ borderRadius: 3, boxShadow: "0 0 0 1px rgb(0 0 0 / 18%)", flexShrink: 0 }}
    >
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 60,30 M60,0 0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 60,30 M60,0 0,30" stroke="#C8102E" strokeWidth="2" />
      <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

export function Flag({ code, size = 22 }: { code: string; size?: number }) {
  if (code === "EN") return <UnionJack size={size} />;
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
