import { FormEvent, useEffect, useRef, useState } from "react";
import ErrorNote from "../shell/ErrorNote";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getMyProfile, updateMyProfile, uploadAvatar } from "../../lib/supabase/profileQueries";
import { updateHostPrefs, completeOnboarding } from "../../lib/supabase/auth";
import { useHostSession } from "../../lib/supabase/useHostSession";

/**
 * /welcome — the setup screen a new account lands on after confirming its email.
 *
 * Sign-up itself is now just email + password, so this is where identity is
 * actually set: name, photo, court side, gender. Two steps rather than one long
 * form, because the first question is the only one that's required and asking it
 * alone gets a much higher completion rate than a wall of fields.
 *
 * Only the name is mandatory. Everything else can be skipped and changed later
 * in the profile — but the defaults matter, so we ask now while there's
 * attention to spend: a player with no side set makes the fixed-position
 * Americano scheduler guess.
 */
type Step = "name" | "details";

const SIDES = [
  { key: "L" as const, label: "Left", hint: "Backhand side" },
  { key: "R" as const, label: "Right", hint: "Forehand side" },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading: sessionLoading } = useHostSession();

  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"M" | "F" | null>(null);
  const [side, setSide] = useState<"L" | "R" | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const next = (() => {
    const raw = params.get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  })();

  // Seed the name field from whatever we already know, so the common case is
  // "confirm this" rather than "type this from nothing".
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getMyProfile()
      .then((p) => {
        if (cancelled || !p) return;
        const metaName = (user.user_metadata?.name as string | undefined) ?? "";
        const seed = metaName || (p.displayName === "Player" ? "" : p.displayName);
        setName(seed);
        if (p.avatarUrl) setAvatarPreview(p.avatarUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);

  function pickAvatar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setError(null);
    setAvatarFile(file);
    // Local preview — the real upload happens on save, so someone who backs out
    // hasn't already written a file to storage.
    setAvatarPreview(URL.createObjectURL(file));
  }

  function handleNameNext(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter your name so teammates know who you are.");
      return;
    }
    setError(null);
    setStep("details");
  }

  /** Saves whatever has been filled in and leaves. Used by both Finish and Skip. */
  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await updateMyProfile({ displayName: name.trim() });
      if (avatarFile) {
        // Never let a failed image upload cost them the whole setup — the name
        // is already saved, and they can add a photo from the profile later.
        await uploadAvatar(avatarFile).catch(() => undefined);
      }
      if (gender || side) {
        await updateHostPrefs({
          ...(gender ? { gender } : {}),
          ...(side ? { preferredSide: side } : {}),
        }).catch(() => undefined);
      }
      // Non-fatal on purpose. Everything the person actually typed is already
      // saved by this point; failing the whole screen on the bookkeeping flag
      // would strand them behind a "couldn't save" message for work that did in
      // fact save. Worst case the flag is unset and they see this once more.
      await completeOnboarding().catch(() => undefined);
      navigate(next, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? `Couldn't save that — ${err.message}`
          : "Couldn't save that just now. Check your connection and try again.",
      );
      setSaving(false);
    }
  }

  if (sessionLoading) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8">
        <p className="text-[13px] text-warm-gray mt-16 text-center">One moment…</p>
      </div>
    );
  }

  const initial = (name.trim()[0] ?? "").toUpperCase();
  const hasOptional = Boolean(avatarFile || gender || side);
  const primaryBtn =
    "w-full flex items-center justify-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-40 disabled:active:scale-100";

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8 safe-top safe-bottom flex flex-col">
      <div className="font-wordmark text-[20px] font-semibold text-graphite flex items-baseline leading-none justify-center mb-8">
        Padelier<span className="ml-[3px] w-[6px] h-[6px] rounded-full bg-gold inline-block" aria-hidden />
      </div>

      {/* Two dots, not a percentage — the whole thing is short and a progress
          bar would oversell how much is left. */}
      <div className="flex items-center justify-center gap-1.5 mb-7" aria-hidden>
        {(["name", "details"] as Step[]).map((s) => (
          <span
            key={s}
            className={`h-[3px] rounded-full transition-all duration-300 ${
              s === step ? "w-6 bg-graphite" : "w-3 bg-stone"
            }`}
          />
        ))}
      </div>

      {step === "name" ? (
        <form onSubmit={handleNameNext} className="anim-fade flex flex-col flex-1">
          <h1 className="font-serif text-[28px] font-medium tracking-tight text-graphite leading-[1.1]">
            You're in. What should we call you?
          </h1>
          <p className="text-[13.5px] text-ink-2 mt-3 mb-6 leading-relaxed">
            This is the name teammates see on lineups, league tables and the Champions Hall.
          </p>

          <input
            className="w-full rounded-2xl border border-line bg-surface px-3.5 py-3 text-ink text-[16px] placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55"
            placeholder="Your name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            autoFocus
            autoComplete="name"
            maxLength={40}
            required
          />
          <ErrorNote error={error} where="OnboardingPage" className="mt-2" />

          <div className="mt-auto pt-8">
            <button type="submit" disabled={!name.trim()} className={primaryBtn}>
              Continue
            </button>
          </div>
        </form>
      ) : (
        <div className="anim-fade flex flex-col flex-1">
          <h1 className="font-serif text-[28px] font-medium tracking-tight text-graphite leading-[1.1]">
            Nice to meet you, {name.trim().split(" ")[0]}.
          </h1>
          <p className="text-[13.5px] text-ink-2 mt-3 mb-6 leading-relaxed">
            A few optional details. Your side helps the scheduler build fairer pairings — you can change any of this later.
          </p>

          {/* ── Photo ─────────────────────────────────────────────────────── */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-3.5 mb-6 text-left active:opacity-70 transition-opacity"
          >
            <span className="relative w-[62px] h-[62px] rounded-full bg-gold-soft border border-line flex items-center justify-center overflow-hidden shrink-0">
              {avatarPreview ? (
                <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="font-serif text-[24px] text-gold-ink">{initial}</span>
              )}
              <span className="absolute -bottom-0.5 -right-0.5 w-[22px] h-[22px] rounded-full bg-graphite text-ivory flex items-center justify-center border-2 border-ivory">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            </span>
            <span>
              <span className="block text-[14px] font-semibold text-graphite">
                {avatarPreview ? "Change photo" : "Add a photo"}
              </span>
              <span className="block text-[12px] text-warm-gray mt-0.5">Optional — helps people spot you</span>
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickAvatar(e.target.files?.[0])}
          />

          {/* ── Side ──────────────────────────────────────────────────────── */}
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2">Preferred side</p>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {SIDES.map((s) => {
              const on = side === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSide(on ? null : s.key)}
                  aria-pressed={on}
                  className={`rounded-2xl border px-3 py-3 text-left transition-colors ${
                    on ? "border-graphite bg-graphite text-ivory" : "border-line bg-surface text-graphite"
                  }`}
                >
                  <span className="block text-[14px] font-semibold">{s.label}</span>
                  <span className={`block text-[11.5px] mt-0.5 ${on ? "text-ivory/70" : "text-warm-gray"}`}>{s.hint}</span>
                </button>
              );
            })}
          </div>

          {/* ── Gender ────────────────────────────────────────────────────── */}
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2">Gender</p>
          <p className="text-[11.5px] text-warm-gray mb-2 -mt-1">Used only to build mixed-format rounds.</p>
          <div className="grid grid-cols-2 gap-2">
            {(["M", "F"] as const).map((g) => {
              const on = gender === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(on ? null : g)}
                  aria-pressed={on}
                  className={`rounded-2xl border px-3 py-2.5 text-[14px] font-semibold transition-colors ${
                    on ? "border-graphite bg-graphite text-ivory" : "border-line bg-surface text-graphite"
                  }`}
                >
                  {g === "M" ? "Male" : "Female"}
                </button>
              );
            })}
          </div>

          <ErrorNote error={error} where="OnboardingPage" className="mt-2" />

          <div className="mt-auto pt-8 space-y-2">
            <button type="button" onClick={finish} disabled={saving} className={primaryBtn}>
              {saving ? "Saving…" : hasOptional ? "Finish" : "Skip for now"}
            </button>
            {/* One button, relabelled. Showing both "Finish" and "Skip" would be
                two controls that do exactly the same thing — finish() only ever
                saves what's actually been filled in, and either way the name is
                stored and onboarding is marked done so this never reappears. */}
            <p className="text-[11.5px] text-warm-gray text-center leading-relaxed">
              You can add or change all of this later in your profile.
              <br />
              New to Padelier? <Link to="/about" className="font-semibold text-gold-ink">See how it works</Link>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
