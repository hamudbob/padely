import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import PageHeader from "../shell/PageHeader";
import { GROUPS, UI, CONTACT_EMAIL, Lang } from "./aboutContent";

const LANG_KEY = "padelier.about.lang";

/**
 * /about — the explainer for everything the app does.
 *
 * Public on purpose: it should work as a link pasted into a group chat before
 * anyone has an account, which is also why it doesn't carry the tab bar.
 *
 * Accordion rather than one long scroll. Twelve-odd answers read as a wall if
 * they're all open; collapsed, the questions themselves become a table of
 * contents you can skim in about ten seconds.
 *
 * Deep-linkable: /about#compensation opens that answer and scrolls to it, so
 * the app can send someone straight to the explanation they need instead of
 * dropping them at the top of a manual.
 */
export default function AboutPage() {
  const location = useLocation();
  const [lang, setLang] = useState<Lang>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(LANG_KEY) : null;
    if (saved === "en" || saved === "id") return saved;
    // Default to the browser's language rather than assuming — most readers
    // here are Indonesian, but a shared link travels.
    return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("id") ? "id" : "en";
  });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* private mode — the choice just won't persist */
    }
  }, [lang]);

  // Open and reveal whatever the URL hash points at.
  useEffect(() => {
    const key = location.hash.replace(/^#/, "");
    if (!key) return;
    setOpen(key);
    // After the accordion has expanded, not before.
    requestAnimationFrame(() => {
      document.getElementById(key)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [location.hash]);

  const t = UI[lang];

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

      <h1 className="font-serif text-[28px] font-medium tracking-tight text-graphite leading-[1.1]">{t.title}</h1>
      <p className="text-[13.5px] text-warm-gray mt-2.5 leading-relaxed">{t.intro}</p>

      {GROUPS.map((group) => (
        <section key={group.key} className="mt-8">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-warm-gray">{group.title[lang]}</h2>
          <p className="text-[12.5px] text-ink-2 mt-1.5 mb-3 leading-relaxed">{group.blurb[lang]}</p>

          <div className="rounded-2xl border border-line bg-surface overflow-hidden">
            {group.entries.map((entry, i) => {
              const isOpen = open === entry.key;
              return (
                <div key={entry.key} id={entry.key} className={i > 0 ? "border-t border-line" : undefined}>
                  <button
                    onClick={() => setOpen(isOpen ? null : entry.key)}
                    aria-expanded={isOpen}
                    className="w-full flex items-start gap-3 px-4 py-3.5 text-left active:bg-surface-2 transition-colors"
                  >
                    <span className="flex-1 text-[14px] font-semibold text-graphite leading-snug">{entry.q[lang]}</span>
                    <span
                      className={`text-stone text-[15px] shrink-0 mt-0.5 transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`}
                      aria-hidden
                    >
                      ›
                    </span>
                  </button>

                  {/* Grid trick: animates to the content's real height without
                      hard-coding one, so a two-line answer and a six-paragraph
                      one both open cleanly. */}
                  <div
                    className="grid transition-[grid-template-rows] duration-300 ease-out"
                    style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                  >
                    <div className="overflow-hidden">
                      <div className="px-4 pb-4 space-y-2.5">
                        {entry.a[lang].map((para, j) => (
                          <p key={j} className="text-[13px] text-ink-2 leading-relaxed">
                            {para}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="mt-9 rounded-2xl border border-dashed border-line bg-surface px-4 py-5 text-center">
        <p className="text-[13px] text-ink-2 leading-relaxed">{t.contact}</p>
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="inline-block mt-2 text-[13.5px] font-semibold text-gold-ink active:opacity-70"
        >
          {CONTACT_EMAIL}
        </a>
      </div>

      <p className="text-[11px] text-warm-gray text-center mt-6">
        Padelier
        <span className="mx-1.5" aria-hidden>·</span>
        v2.0.0
      </p>
    </div>
  );
}
