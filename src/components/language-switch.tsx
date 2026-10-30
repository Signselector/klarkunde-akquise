import { Flag } from "@/components/flag";
import { setLang, useLang, useT, type Lang } from "@/lib/i18n";

const OPTIONS: { lang: Lang; flag: string; label: string }[] = [
  { lang: "de", flag: "DE", label: "Deutsch" },
  { lang: "en", flag: "EN", label: "English" },
];

/** Flags below the main navigation: switches the language of the interface. */
export function LanguageSwitch() {
  const lang = useLang();
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t("Sprache")} className="cc-lang-switch" data-lang={lang}>
      <span className="cc-lang-thumb" aria-hidden="true" />
      {OPTIONS.map((o) => (
        <button
          key={o.lang}
          type="button"
          role="radio"
          aria-checked={lang === o.lang}
          title={o.label}
          aria-label={o.label}
          className="cc-lang-option"
          onClick={() => setLang(o.lang)}
        >
          <Flag code={o.flag} size={14} />
          <span className="cc-lang-code">{o.lang.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}
