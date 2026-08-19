import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import PageHeader from "../shell/PageHeader";
import FeaturePoster from "./FeaturePoster";
import { PAGE_UI, featureBySlug } from "./featureContent";
import { Lang } from "../about/aboutContent";

const LANG_KEY = "padelier.about.lang";

/**
 * /f/:slug — one feature, explained, with the way to start it at the bottom.
 *
 * The shape is deliberate and the same every time: a poster you can recognise
 * at a glance, one line that promises something, what it is, how a round
 * actually works, who it suits, what it isn't good at, and then the button.
 *
 * The "worth knowing" section is the part that makes these worth reading. A
 * page that only sells its feature is an advert; a page that says "Mexicano
 * needs signal between rounds, pick Americano if you have none" is the reason
 * someone trusts the next page too.
 *
 * The CTA sticks to the bottom of the screen rather than sitting at the end of
 * the scroll, because the decision to start a session is usually made in the
 * first three seconds and it shouldn't require reading to the end to act on.
 */
export default function FeaturePage() {
  const { slug } = useParams();
  const feature = slug ? featureBySlug(slug) : undefined;
  const [lang, setLang] = useState<Lang>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(LANG_KEY) : null;
    if (saved === "en" || saved === "id") return saved;
    return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("id") ? "id" : "en";
  });

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* private mode — the choice just won't persist */
    }
  }, [lang]);

  // An unknown slug is a stale link, not an error worth a page of its own.
  if (!feature) return <Navigate to="/features" replace />;

  const t = PAGE_UI[lang];

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top anim-fade">
      <PageHeader
        fallback="/features"
        className="mb-5"
        trailing={
          <button
            onClick={() => setLang((l) => (l === "en" ? "id" : "en"))}
            className="text-[11px] font-bold uppercase tracking-[0.12em] text-warm-gray border border-line rounded-full px-2.5 py-1.5 bg-surface active:opacity-70"
          >
            {lang === "en" ? "ID" : "EN"}
          </button>
        }
      />

      <FeaturePoster kind={feature.poster} />

      <h1 className="font-serif text-[30px] font-medium tracking-tight text-graphite mt-5 leading-tight">
        {feature.name[lang]}
      </h1>
      <p className="text-[15px] text-ink-2 leading-relaxed mt-2">{feature.promise[lang]}</p>

      {feature.what[lang].map((para, i) => (
        <p key={i} className="text-[14px] text-ink-2 leading-relaxed mt-3">
          {para}
        </p>
      ))}

      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mt-7 mb-2.5">{t.howItWorks}</h2>
      <ol className="rounded-2xl border border-line bg-surface overflow-hidden">
        {feature.steps[lang].map((step, i) => (
          <li key={i} className="flex gap-3 px-4 py-3 border-t border-line first:border-t-0">
            <span className="font-mono tnum text-[12px] font-semibold text-gold-ink shrink-0 mt-[2px]">{i + 1}</span>
            <span className="text-[13.5px] text-ink-2 leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>

      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mt-6 mb-2.5">{t.bestFor}</h2>
      <ul className="space-y-1.5">
        {feature.bestFor[lang].map((item, i) => (
          <li key={i} className="flex gap-2.5 text-[13.5px] text-ink-2 leading-relaxed">
            <span className="text-gold-ink shrink-0" aria-hidden>
              ·
            </span>
            {item}
          </li>
        ))}
      </ul>

      {feature.notFor && (
        <div className="rounded-2xl bg-gold-soft px-4 py-3.5 mt-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-ink">{t.notFor}</p>
          <p className="text-[13.5px] text-gold-ink leading-relaxed mt-1.5">{feature.notFor[lang]}</p>
        </div>
      )}

      <Link
        to="/features"
        className="block text-center text-[12.5px] font-semibold text-warm-gray mt-7 active:opacity-70"
      >
        {t.allFeatures} ›
      </Link>

      {/* Room for the sticky bar, so the last line isn't hidden behind it. */}
      <div className="h-[104px]" />

      {/* The action, always reachable. Same material as the tab bar so it
          reads as chrome rather than as part of the article. */}
      <div className="fixed bottom-0 inset-x-0 z-40 tabbar-material border-t border-line">
        <div className="mx-auto max-w-sm px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Link
            to={feature.cta.to}
            className="block w-full text-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
          >
            {feature.cta.label[lang]}
          </Link>
          {feature.ctaNote && (
            <p className="text-[11px] text-warm-gray text-center mt-1.5 leading-snug">{feature.ctaNote[lang]}</p>
          )}
        </div>
      </div>
    </div>
  );
}
