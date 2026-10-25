/** Original Sign Selector wordmark, served locally without third-party requests. */
export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`cc-brand-content${inverse ? "" : " cc-brand-chip"}`}>
      <img
        src={`/brand/signselector/logo-light.png`}
        width={330}
        height={102}
        alt="Sign Selector"
        decoding="async"
      />
      <small>Cold Caller · Team-Akquise</small>
    </span>
  );
}
