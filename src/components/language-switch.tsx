import { setLang, useLang, useT, type Lang } from "@/lib/i18n";
import { Flag } from "@/components/flag";

const OPTIONS: { lang: Lang; label: string; flag: string }[] = [
  { lang: "de", label: "Deutsch", flag: "DE" },
  { lang: "en", label: "English", flag: "EN" },
];

/** DE / EN switch, styled like the country switcher (flags in a segmented control). */
export function LanguageSwitch() {
  const lang = useLang();
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t("Sprache")} className="cc-lang-seg">
      {OPTIONS.map((o) => (
        <button
          key={o.lang}
          type="button"
          role="radio"
          aria-checked={lang === o.lang}
          title={o.label}
          aria-label={o.label}
          onClick={() => setLang(o.lang)}
        >
          <Flag code={o.flag} />
        </button>
      ))}
    </div>
  );
}
