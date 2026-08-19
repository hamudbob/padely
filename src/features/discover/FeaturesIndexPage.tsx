import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../shell/PageHeader";
import FeaturePoster from "./FeaturePoster";
import { FEATURES } from "./featureContent";
import { Lang } from "../about/aboutContent";

const LANG_KEY = "padelier.about.lang";

const FAMILY_TITLE: Record<string, Record<Lang, string>> = {
  format: { en: "Ways to play", id: "Cara bermain" },
  scoring: { en: "How scoring works", id: "Cara penilaian" },
  club: { en: "For a group", id: "Untuk kelompok" },
  you: { en: "Your game", id: "Permainanmu" },
  together: { en: "Playing together", id: "Bermain bersama" },
};

/**
 * /features — everything the app does, one card each.
 *
 * This is the destination the Play tab's slideshow will point into, and the
 * page to send someone who asks "so what does it actually do". Cards rather
 * than a list: the posters are the fastest way to tell a Mexicano page from a
 * Team Sparring one, and they were drawn for exactly this.
 */
export default function FeaturesIndexPage() {
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

  const families = Object.keys(FAMILY_TITLE).filter((family) => FEATURES.some((f) => f.family === family));

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade">
      <PageHeader
        fallback="/play"
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

      <h1 className="font-serif text-[28px] font-medium tracking-tight text-graphite leading-tight">
        {lang === "en" ? "Everything Padelier does" : "Semua yang bisa Padelier lakukan"}
      </h1>
      <p className="text-[13.5px] text-ink-2 leading-relaxed mt-2">
        {lang === "en"
          ? "Pick a way to play, or see what a club gives you. Every page ends with the button that starts it."
          : "Pilih cara bermain, atau lihat apa yang kamu dapat dari sebuah klub. Setiap halaman diakhiri tombol untuk langsung memulai."}
      </p>

      {families.map((family) => (
        <div key={family} className="mt-7">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray px-1 mb-2.5">
            {FAMILY_TITLE[family][lang]}
          </p>
          <div className="space-y-3">
            {FEATURES.filter((f) => f.family === family).map((f) => (
              <Link key={f.slug} to={`/f/${f.slug}`} className="block active:opacity-70 transition-opacity">
                <FeaturePoster kind={f.poster} slug={f.slug} />
                <p className="font-serif text-[19px] font-medium text-graphite mt-2 leading-tight">{f.name[lang]}</p>
                <p className="text-[12.5px] text-warm-gray leading-relaxed mt-0.5">{f.promise[lang]}</p>
              </Link>
            ))}
          </div>
        </div>
      ))}

      <p className="text-[12px] text-warm-gray text-center mt-8 leading-relaxed">
        {lang === "en"
          ? "That's all of it. Every page ends with the button that starts the thing it describes."
          : "Itu semuanya. Setiap halaman diakhiri tombol untuk langsung memulai apa yang dijelaskannya."}
      </p>
    </div>
  );
}
