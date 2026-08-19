import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import PageHeader from "../shell/PageHeader";
import { CATALOGUE, isAutomatic } from "../../lib/errors";
import { FAMILIES, PAGE_UI, USER_HELP } from "./errorHelpContent";
import { CONTACT_EMAIL, Lang } from "../about/aboutContent";

const LANG_KEY = "padelier.about.lang";

/**
 * /codes — every error code, and what to do about it.
 *
 * Deliberately its own page rather than a section of /about. About answers
 * "how does this work" for someone who is curious; this answers "what do I do
 * now" for someone who is stuck, and those two people want opposite things.
 * Someone holding a code wants a search box and one short answer, not a
 * chapter of a manual.
 *
 * Public, like /about — a spectator who hit an error on a shared live link
 * has no account and still needs to read this.
 *
 * Deep-linkable per code: an error message links to /codes#PLR-2002, which
 * opens that code, pinned, at the top. That link IS the support flow, and it
 * works before anyone contacts anybody.
 */
export default function ErrorCodesPage() {
  const location = useLocation();
  const [lang, setLang] = useState<Lang>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(LANG_KEY) : null;
    if (saved === "en" || saved === "id") return saved;
    return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("id") ? "id" : "en";
  });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* private mode — the choice just won't persist */
    }
  }, [lang]);

  // Arriving from an error message: /codes#PLR-2002 pins and opens that code.
  useEffect(() => {
    const key = location.hash.replace(/^#/, "").toUpperCase();
    if (!key) return;
    setQuery(key);
    setOpen(key);
  }, [location.hash]);

  const t = PAGE_UI[lang];
  const term = query.trim().toUpperCase();

  /** What the person typed, if it looks like a code at all. */
  const typedCode = /^PLR-/.test(term) ? term : null;
  const typedIsAutomatic = typedCode !== null && isAutomatic(typedCode);
  const typedIsKnown = typedCode !== null && CATALOGUE[typedCode] !== undefined;

  const matches = useMemo(() => {
    if (!term) return null;
    return Object.keys(CATALOGUE).filter(
      (code) =>
        code.includes(term) ||
        CATALOGUE[code].title.toUpperCase().includes(term),
    );
  }, [term]);

  function helpFor(code: string): { what: string; do: string } {
    const entry = USER_HELP[code];
    const family = FAMILIES[code.replace("PLR-", "").charAt(0)];
    return {
      what: entry ? entry.what[lang] : family?.what[lang] ?? "",
      do: entry ? entry.do[lang] : family?.do[lang] ?? "",
    };
  }

  function mailto(code: string | null): string {
    const subject = encodeURIComponent(`Padelier ${code ?? "problem"}`);
    const body = encodeURIComponent(
      `${code ? `Code: ${code}\n` : ""}What I was doing:\n\n\nWhen: ${new Date().toISOString()}\n`,
    );
    return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  }

  function CodeRow({ code }: { code: string }) {
    const entry = CATALOGUE[code];
    const isOpen = open === code;
    const help = helpFor(code);
    return (
      <div id={code} className="border-t border-line first:border-t-0">
        <button
          onClick={() => setOpen(isOpen ? null : code)}
          aria-expanded={isOpen}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left active:bg-surface-2 transition-colors"
        >
          <span className="min-w-0">
            <span className="font-mono text-[12px] font-semibold text-gold-ink tracking-[0.04em]">{code}</span>
            <span className="block text-[13.5px] text-graphite truncate">{entry.title}</span>
          </span>
          <span className={`text-stone text-[15px] shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>
            ›
          </span>
        </button>
        {isOpen && (
          <div className="px-4 pb-4 anim-fade">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-warm-gray">{t.whatHappened}</p>
            <p className="text-[13.5px] text-ink-2 leading-relaxed mt-1">{help.what}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-warm-gray mt-3">{t.whatToDo}</p>
            <p className="text-[13.5px] text-ink-2 leading-relaxed mt-1">{help.do}</p>
            <a
              href={mailto(code)}
              className="inline-block mt-3 text-[12.5px] font-semibold text-graphite border border-line rounded-full px-3.5 py-2 bg-ivory active:opacity-70"
            >
              {t.stuckCta}
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade">
      <PageHeader
        className="mb-6"
        trailing={
          <button
            onClick={() => setLang((l) => (l === "en" ? "id" : "en"))}
            className="text-[11px] font-bold uppercase tracking-[0.12em] text-warm-gray border border-line rounded-full px-2.5 py-1.5 bg-surface active:opacity-70"
          >
            {lang === "en" ? "ID" : "EN"}
          </button>
        }
      />

      <h1 className="font-serif text-[26px] font-medium tracking-tight text-graphite">{t.title}</h1>
      <p className="text-[13px] text-ink-2 leading-relaxed mt-2">{t.intro}</p>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.search}
        aria-label={t.searchLabel}
        autoCapitalize="characters"
        spellCheck={false}
        className="w-full rounded-2xl border border-line bg-surface px-3.5 py-3 text-[16px] font-mono text-ink placeholder:font-sans placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55 mt-4"
      />

      {/* An automatic code is a real answer, not a miss — say so rather than
          showing "no results" to someone holding a valid reference. */}
      {typedIsAutomatic && !typedIsKnown && (
        <div className="rounded-2xl bg-gold-soft px-4 py-3.5 mt-3">
          <p className="text-[13px] font-semibold text-gold-ink">{t.unlisted}</p>
          <p className="text-[12.5px] text-gold-ink/90 leading-relaxed mt-1">{t.unlistedBody}</p>
          <a
            href={mailto(typedCode)}
            className="inline-block mt-2.5 text-[12.5px] font-semibold text-graphite border border-gold-ink/25 rounded-full px-3.5 py-2 bg-ivory active:opacity-70"
          >
            {t.stuckCta}
          </a>
        </div>
      )}

      {matches !== null && matches.length === 0 && !typedIsAutomatic && (
        <p className="text-[13px] text-warm-gray leading-relaxed mt-3">{t.noMatch}</p>
      )}

      {/* Search results: a flat list, because when you're looking one up you
          don't care which family it belongs to. */}
      {matches !== null && matches.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface overflow-hidden mt-3">
          {matches.map((code) => (
            <CodeRow key={code} code={code} />
          ))}
        </div>
      )}

      {/* The whole catalogue, by family, when nothing is being searched. */}
      {matches === null &&
        Object.entries(FAMILIES).map(([digit, family]) => {
          const codes = Object.keys(CATALOGUE)
            .filter((c) => c.startsWith(`PLR-${digit}`))
            .sort();
          if (codes.length === 0) return null;
          return (
            <div key={digit} className="mt-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray px-1">
                {family.title[lang]}
              </p>
              <p className="text-[12.5px] text-warm-gray leading-relaxed px-1 mt-1 mb-2">{family.what[lang]}</p>
              <div className="rounded-2xl border border-line bg-surface overflow-hidden">
                {codes.map((code) => (
                  <CodeRow key={code} code={code} />
                ))}
              </div>
            </div>
          );
        })}

      <div className="rounded-2xl bg-surface border border-line px-4 py-4 mt-7">
        <p className="text-[14px] font-semibold text-graphite">{t.stuckTitle}</p>
        <p className="text-[12.5px] text-ink-2 leading-relaxed mt-1">{t.stuckBody}</p>
        <a
          href={mailto(typedCode)}
          className="block w-full text-center mt-3 rounded-full px-4 py-3 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
        >
          {t.stuckCta}
        </a>
      </div>
    </div>
  );
}
