/** Original Sign Selector wordmark, served locally without third-party requests. */
export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="cc-brand-content">
      <img
        src={`/brand/signselector/logo-${inverse ? "light" : "ink"}.png`}
        width={330}
        height={102}
        alt="Sign Selector"
        decoding="async"
      />
      <small className="cc-brand-tagline">COLD CALLER TOOL</small>
    </span>
  );
}
