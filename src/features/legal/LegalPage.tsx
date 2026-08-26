import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import PageHeader from "../shell/PageHeader";
import { Doc, Lang, LEGAL_UI, CONTACT_EMAIL } from "./legalContent";

const LANG_KEY = "padelier.about.lang";

/**
 * The shared renderer for /privacy and /terms.
 *
 * One component, two documents, because the only thing that differs is the
 * text — and legal pages that look different from each other make people
 * wonder which one is current.
 *
 * Read as a document, not an accordion. About/FAQ collapses because you arrive
 * with one question; nobody arrives at a privacy policy with one question, and
 * hiding clauses behind taps is exactly the pattern these documents exist to
 * work against. Everything is open, in order, deep-linkable by clause.
 *
 * Language toggle shares About's storage key on purpose: choosing Indonesian
 * once should hold across every page that has an Indonesian version. The
 * Indonesian text is the operative one — the header says so in both languages.
 */
export default function LegalPage({ doc, other }: { doc: Doc; other: "privacy" | "terms" }) {
  const location = useLocation();
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

  // Scroll to a linked clause once it's rendered.
  useEffect(() => {
    const key = location.hash.replace(/^#/, "");
    if (!key) return;
    requestAnimationFrame(() => {
      document.getElementById(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.hash]);

  const t = LEGAL_UI[lang];

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade">
      <PageHeader
        className="mb-6"
        trailing={
          <button
            onClick={() => setLang((l) => (l === "en" ? "id" : "en"))}
            className="h-9 px-3 rounded-full border border-line bg-surface text-[12px] font-semibold text-ink-2 active:scale-95 transition-transform shrink-0"
          >
            {t.other}
          </button>
        }
      />

      <h1 className="font-serif text-[28px] font-medium tracking-tight text-graphite leading-[1.1]">
        {doc.title[lang]}
      </h1>
      <p className="text-[11.5px] text-warm-gray mt-2">
        {t.updatedLabel} {doc.updated[lang]}
      </p>
      <p className="text-[11.5px] text-warm-gray mt-1.5 leading-relaxed italic">{t.note}</p>

      <div className="mt-5 space-y-3">
        {doc.intro.map((p, i) => (
          <p key={i} className="text-[13.5px] text-ink-2 leading-relaxed">
            {p[lang]}
          </p>
        ))}
      </div>

      {doc.sections.map((s, i) => (
        <section key={s.key} id={s.key} className="mt-8 scroll-mt-6">
          {/* Numbered so a clause can be pointed at in an email — "see 6" is
              easier to say than the whole heading, in either language. */}
          <h2 className="text-[15px] font-semibold text-graphite leading-snug flex gap-2.5">
            <span className="font-mono tnum text-[13px] text-gold-ink mt-[3px] shrink-0">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{s.title[lang]}</span>
          </h2>

          {s.body && (
            <div className="mt-2.5 space-y-2.5 pl-[30px]">
              {s.body.map((p, j) => (
                <p key={j} className="text-[13px] text-ink-2 leading-relaxed">
                  {p[lang]}
                </p>
              ))}
            </div>
          )}

          {s.items && (
            <dl className="mt-3 pl-[30px] space-y-3">
              {s.items.map((it, j) => (
                <div key={j} className="rounded-2xl bg-surface border border-line px-4 py-3">
                  <dt className="text-[13px] font-semibold text-graphite">{it.t[lang]}</dt>
                  <dd className="text-[12.5px] text-ink-2 leading-relaxed mt-1">{it.d[lang]}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}

      <div className="mt-9 rounded-2xl border border-dashed border-line bg-surface px-4 py-5 text-center">
        <p className="text-[13px] font-semibold text-graphite">{t.contactHeading}</p>
        <p className="text-[12.5px] text-ink-2 leading-relaxed mt-1">{t.contactBody}</p>
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="inline-block mt-2 text-[13.5px] font-semibold text-gold-ink active:opacity-70"
        >
          {CONTACT_EMAIL}
        </a>
      </div>

      <p className="text-[12px] text-warm-gray text-center mt-6">
        <Link to={`/${other}`} className="font-semibold text-gold-ink">
          {other === "privacy" ? t.seePrivacy : t.seeTerms}
        </Link>
        <span className="mx-2" aria-hidden>
          ·
        </span>
        <Link to="/about" className="font-semibold text-gold-ink">
          {lang === "id" ? "Cara kerjanya" : "How it all works"}
        </Link>
        <span className="mx-2" aria-hidden>
          ·
        </span>
        {/* Findable from the policy that describes it, not only from Settings —
            the person most likely to want it has already left. */}
        <Link to="/delete-account" className="font-semibold text-gold-ink">
          {lang === "id" ? "Hapus akun" : "Delete account"}
        </Link>
      </p>

      <p className="text-[11px] text-warm-gray text-center mt-4">
        Padelier
        <span className="mx-1.5" aria-hidden>
          ·
        </span>
        v2.0.0
      </p>
    </div>
  );
}
