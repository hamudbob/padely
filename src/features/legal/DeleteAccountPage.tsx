import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../shell/PageHeader";
import { DELETE_ACCOUNT, CONTACT_EMAIL, LEGAL_UI, Lang } from "./legalContent";

const LANG_KEY = "padelier.about.lang";

/**
 * /delete-account — a public page, reachable with no account and no app.
 *
 * The deletion itself has worked since migration 0037 and lives in Settings.
 * What was missing is this: Google Play requires a URL somebody can open AFTER
 * uninstalling, that says how to delete their account and what happens to the
 * data. Someone who has removed the app has no other route, and no way to find
 * out what was kept.
 *
 * Deliberately not behind RequireHost, not behind anything. A page about
 * leaving that asks you to sign in first is the joke everyone has already made.
 */
export default function DeleteAccountPage() {
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

  const d = DELETE_ACCOUNT;
  const t = d.ui[lang];
  const shared = LEGAL_UI[lang];
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t.subject)}`;

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade">
      <PageHeader
        className="mb-6"
        fallback="/"
        trailing={
          <button
            onClick={() => setLang((l) => (l === "en" ? "id" : "en"))}
            className="h-9 px-3 rounded-full border border-line bg-surface text-[12px] font-semibold text-ink-2 active:scale-95 transition-transform shrink-0"
          >
            {shared.other}
          </button>
        }
      />

      <h1 className="font-serif text-[28px] font-medium tracking-tight text-graphite leading-[1.1]">
        {d.title[lang]}
      </h1>
      <p className="text-[11.5px] text-warm-gray mt-2">
        {shared.updatedLabel} {d.updated[lang]}
      </p>

      <div className="mt-5 space-y-3">
        {d.intro.map((p, i) => (
          <p key={i} className="text-[13.5px] text-ink-2 leading-relaxed">
            {p[lang]}
          </p>
        ))}
      </div>

      {/* Route 1: the app, which is instant and needs nobody's help. Listed
          first because it's the better answer for anyone who still has it. */}
      <section className="mt-8">
        <h2 className="text-[15px] font-semibold text-graphite">{d.inApp.title[lang]}</h2>
        <ol className="mt-3 space-y-2.5">
          {d.inApp.steps.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-2xl bg-surface border border-line px-4 py-3">
              <span className="font-mono tnum text-[12px] text-gold-ink mt-[2px] shrink-0">{i + 1}</span>
              <span className="text-[13px] text-ink-2 leading-relaxed">{s[lang]}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Route 2: the reason this page exists at all. */}
      <section className="mt-8">
        <h2 className="text-[15px] font-semibold text-graphite">{d.byEmail.title[lang]}</h2>
        <div className="mt-2.5 space-y-2.5">
          {d.byEmail.body.map((p, i) => (
            <p key={i} className="text-[13px] text-ink-2 leading-relaxed">
              {p[lang]}
            </p>
          ))}
        </div>
        <a
          href={mailto}
          className="mt-4 w-full flex items-center justify-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
        >
          {t.emailCta}
        </a>
        <p className="text-[12px] text-warm-gray text-center mt-2">{CONTACT_EMAIL}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-[15px] font-semibold text-graphite">{d.erased.title[lang]}</h2>
        <ul className="mt-3 rounded-2xl bg-surface border border-line divide-y divide-line">
          {d.erased.items.map((it, i) => (
            <li key={i} className="px-4 py-2.5 text-[13px] text-ink-2 leading-relaxed">
              {it[lang]}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-[15px] font-semibold text-graphite">{d.kept.title[lang]}</h2>
        <div className="mt-2.5 space-y-2.5">
          {d.kept.body.map((p, i) => (
            <p key={i} className="text-[13px] text-ink-2 leading-relaxed">
              {p[lang]}
            </p>
          ))}
        </div>
      </section>

      {/* Terracotta, not red: this is a warning about permanence, not an error. */}
      <p className="mt-8 rounded-2xl border border-loss/30 bg-loss-soft px-4 py-3.5 text-[13px] text-loss leading-relaxed">
        {d.warning[lang]}
      </p>

      <p className="text-[12px] text-warm-gray text-center mt-8">
        <Link to="/privacy" className="font-semibold text-gold-ink">
          {t.back}
        </Link>
        <span className="mx-2" aria-hidden>
          ·
        </span>
        <Link to="/" className="font-semibold text-gold-ink">
          Padelier
        </Link>
      </p>
    </div>
  );
}
