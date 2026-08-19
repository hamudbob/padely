import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getMyProfile, updateMyProfile, uploadAvatar, Profile } from "../../lib/supabase/profileQueries";
import {
  changePassword,
  updateHostPrefs,
  signOutHost,
  deleteMyAccount,
  InvalidCredentialsError,
} from "../../lib/supabase/auth";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { amIAdmin } from "../../lib/supabase/adminQueries";
import { useBackNav } from "../../lib/useBackNav";
import { evaluatePassword } from "../../lib/passwordPolicy";
import PasswordField from "../auth/PasswordField";
import PasswordStrength from "../auth/PasswordStrength";

/**
 * Settings — everything about *you* that you can change, behind the gear on the
 * You tab.
 *
 * "How do I change my password" was one of the three questions people kept
 * asking, and until now the honest answer was "you can't from in here" — the
 * only route was signing out and using the forgot-password email. That's the
 * headline of this screen.
 *
 * Saving is per-section rather than one big Save at the bottom. These are four
 * unrelated things, and a single button implying they commit together would be
 * a lie — the password change in particular has its own failure mode.
 */
const SIDES = [
  { key: "L" as const, label: "Left", hint: "Backhand side" },
  { key: "R" as const, label: "Right", hint: "Forehand side" },
];

const BIO_MAX = 280;

export default function SettingsPage() {
  const navigate = useNavigate();
  // The only way into /admin from the UI. It appears for admins and for
  // nobody else — the route itself is guarded server-side either way.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    amIAdmin()
      .then((ok) => !cancelled && setIsAdmin(ok))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const back = useBackNav("/profile");
  const { user } = useHostSession();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [gender, setGender] = useState<"M" | "F" | null>(null);
  const [side, setSide] = useState<"L" | "R" | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsMsg, setPrefsMsg] = useState<string | null>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwFocused, setPwFocused] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const verdict = useMemo(
    () => evaluatePassword(newPw, { name, email: user?.email ?? undefined }),
    [newPw, name, user?.email],
  );

  useEffect(() => {
    getMyProfile()
      .then((p) => {
        if (!p) return;
        setProfile(p);
        setName(p.displayName === "Player" ? "" : p.displayName);
        setBio(p.bio ?? "");
        setAvatarPreview(p.avatarUrl);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const g = user?.user_metadata?.gender as "M" | "F" | undefined;
    const s = user?.user_metadata?.preferred_side as "L" | "R" | undefined;
    if (g) setGender(g);
    if (s) setSide(s);
  }, [user]);

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileErr("Please choose an image file.");
      return;
    }
    setProfileErr(null);
    setUploading(true);
    setAvatarPreview(URL.createObjectURL(file));
    try {
      const url = await uploadAvatar(file);
      setAvatarPreview(url);
      setProfileMsg("Photo updated.");
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : "Couldn't upload that photo.");
      setAvatarPreview(profile?.avatarUrl ?? null);
    } finally {
      setUploading(false);
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setProfileErr("Your name can't be empty.");
      return;
    }
    setSavingProfile(true);
    setProfileErr(null);
    setProfileMsg(null);
    try {
      const updated = await updateMyProfile({ displayName: name.trim(), bio });
      setProfile(updated);
      setProfileMsg("Saved.");
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePrefs(nextGender: "M" | "F" | null, nextSide: "L" | "R" | null) {
    setGender(nextGender);
    setSide(nextSide);
    setSavingPrefs(true);
    setPrefsMsg(null);
    try {
      await updateHostPrefs({
        ...(nextGender ? { gender: nextGender } : {}),
        ...(nextSide ? { preferredSide: nextSide } : {}),
      });
      setPrefsMsg("Saved.");
    } catch {
      setPrefsMsg(null);
    } finally {
      setSavingPrefs(false);
    }
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setPwErr(null);
    setPwMsg(null);
    if (!verdict.valid) {
      setPwFocused(true);
      setPwErr("Please meet all the requirements below.");
      return;
    }
    if (currentPw === newPw) {
      setPwErr("That's the password you already have.");
      return;
    }
    setSavingPw(true);
    try {
      await changePassword(currentPw, newPw);
      setCurrentPw("");
      setNewPw("");
      setPwMsg("Password changed. It'll be needed next time you log in.");
    } catch (err) {
      setPwErr(
        err instanceof InvalidCredentialsError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't change your password.",
      );
    } finally {
      setSavingPw(false);
    }
  }

  /**
   * Deletion asks for the word, not for a second "are you sure?".
   * A confirm dialog is dismissed by reflex; typing DELETE can't be.
   */
  async function handleDelete() {
    if (confirmText.trim().toUpperCase() !== "DELETE") return;
    setDeleting(true);
    setDelErr(null);
    try {
      await deleteMyAccount();
      navigate("/", { replace: true });
    } catch (err) {
      setDelErr(
        err instanceof Error
          ? `Couldn't delete the account — ${err.message}`
          : "Couldn't delete the account just now. Check your connection and try again.",
      );
      setDeleting(false);
    }
  }

  async function handleSignOut() {
    if (!confirm("Sign out of Padelier on this device?")) return;
    try {
      await signOutHost();
    } finally {
      navigate("/", { replace: true });
    }
  }

  const initial = (name.trim()[0] ?? "?").toUpperCase();
  // One row open at a time. The old page laid every editor out flat, so the
  // three things people came for — a name, a side, a password — were buried
  // under two thousand pixels of forms they weren't using.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const toggle = (key: string) => setOpenRow((current) => (current === key ? null : key));

  const card = "rounded-2xl border border-line bg-surface px-4 py-4";
  const label = "text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray";
  const input =
    "w-full rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-[16px] text-ink placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55";
  const primaryBtn =
    "w-full flex items-center justify-center rounded-full px-4 py-3 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-40 disabled:active:scale-100";

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={back}
          aria-label="Back"
          className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform"
        >
          ‹
        </button>
        <span className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
          Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
        </span>
        <div className="w-9" />
      </div>

      {/* ── Who you are ────────────────────────────────────────────────
          Identity first, as a single object rather than three cards. The
          photo, the name and the email describe one thing, and seeing them
          together is how you know you're in the right account. */}
      <div className="flex items-center gap-3.5 mb-6">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          aria-label={avatarPreview ? "Change photo" : "Add a photo"}
          className="relative w-[62px] h-[62px] rounded-full bg-gold-soft border border-line flex items-center justify-center overflow-hidden shrink-0 active:opacity-70 transition-opacity disabled:opacity-50"
        >
          {avatarPreview ? (
            <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="font-serif text-[24px] text-gold-ink">{initial}</span>
          )}
          <span className="absolute inset-x-0 bottom-0 bg-graphite/70 text-ivory text-[9px] font-semibold py-[3px] text-center leading-none">
            {uploading ? "…" : "EDIT"}
          </span>
        </button>
        <span className="min-w-0">
          <h1 className="font-serif text-[24px] font-medium tracking-tight text-graphite truncate leading-tight">
            {name.trim() || "Your name"}
          </h1>
          <span className="block text-[12.5px] text-warm-gray truncate">{user?.email}</span>
        </span>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickAvatar(e.target.files?.[0])} />
      </div>

      {/* ── You ────────────────────────────────────────────────────────── */}
      <p className={`${label} mb-2 px-1`}>You</p>
      <div className="rounded-2xl border border-line bg-surface overflow-hidden mb-5">
        <button
          type="button"
          onClick={() => toggle("profile")}
          aria-expanded={openRow === "profile"}
          className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-surface-2 transition-colors"
        >
          <span className="text-[14px] font-semibold text-graphite">Name and bio</span>
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-[12.5px] text-warm-gray truncate max-w-[150px]">
              {bio.trim() ? bio.trim() : "No bio yet"}
            </span>
            <span className={`text-stone text-[15px] shrink-0 transition-transform ${openRow === "profile" ? "rotate-90" : ""}`} aria-hidden>›</span>
          </span>
        </button>

        {openRow === "profile" && (
          <form onSubmit={saveProfile} className="px-4 pb-4 pt-1 border-t border-line anim-fade">
            <input className={`${input} mb-2.5`} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            <textarea
              className={`${input} resize-none leading-relaxed`}
              placeholder="A line about you — how long you've played, your favourite shot, anything."
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
              rows={3}
              maxLength={BIO_MAX}
            />
            <div className="flex items-center justify-between mt-1.5 mb-3">
              <span className="text-[11.5px] text-warm-gray">Shown on your public profile</span>
              <span className={`text-[11px] tnum font-mono ${bio.length > BIO_MAX - 30 ? "text-gold-ink" : "text-warm-gray"}`}>
                {bio.length}/{BIO_MAX}
              </span>
            </div>
            {profileErr && <p className="text-[13px] text-loss mb-2">{profileErr}</p>}
            {profileMsg && <p className="text-[13px] text-win mb-2">{profileMsg}</p>}
            <button type="submit" disabled={savingProfile || !name.trim()} className={primaryBtn}>
              {savingProfile ? "Saving…" : "Save"}
            </button>
          </form>
        )}

        <div className="h-px bg-line" />

        <button
          type="button"
          onClick={() => toggle("playing")}
          aria-expanded={openRow === "playing"}
          className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-surface-2 transition-colors"
        >
          <span className="text-[14px] font-semibold text-graphite">Playing preferences</span>
          <span className="flex items-center gap-2">
            {/* The summary is the point of a collapsed row: your side and
                gender are readable without opening anything. */}
            <span className="text-[12.5px] text-warm-gray">
              {[SIDES.find((s) => s.key === side)?.label, gender === "M" ? "Male" : gender === "F" ? "Female" : null]
                .filter(Boolean)
                .join(" · ") || "Not set"}
            </span>
            <span className={`text-stone text-[15px] shrink-0 transition-transform ${openRow === "playing" ? "rotate-90" : ""}`} aria-hidden>›</span>
          </span>
        </button>

        {openRow === "playing" && (
          <div className="px-4 pb-4 pt-1 border-t border-line anim-fade">
            <div className="flex items-center justify-between mb-2">
              <p className={label}>Preferred side</p>
              {savingPrefs && <span className="text-[11px] text-warm-gray">Saving…</span>}
              {!savingPrefs && prefsMsg && <span className="text-[11px] text-win">{prefsMsg}</span>}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {SIDES.map((s) => {
                const on = side === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => savePrefs(gender, on ? null : s.key)}
                    aria-pressed={on}
                    className={`rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                      on ? "border-graphite bg-graphite text-ivory" : "border-line bg-surface text-graphite"
                    }`}
                  >
                    <span className="block text-[13.5px] font-semibold">{s.label}</span>
                    <span className={`block text-[11px] mt-0.5 ${on ? "text-ivory/70" : "text-warm-gray"}`}>{s.hint}</span>
                  </button>
                );
              })}
            </div>
            <p className={`${label} mb-1`}>Gender</p>
            <p className="text-[11.5px] text-warm-gray mb-2">Used only to build mixed-format rounds.</p>
            <div className="grid grid-cols-2 gap-2">
              {(["M", "F"] as const).map((g) => {
                const on = gender === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => savePrefs(on ? null : g, side)}
                    aria-pressed={on}
                    className={`rounded-2xl border px-3 py-2.5 text-[13.5px] font-semibold transition-colors ${
                      on ? "border-graphite bg-graphite text-ivory" : "border-line bg-surface text-graphite"
                    }`}
                  >
                    {g === "M" ? "Male" : "Female"}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Help ───────────────────────────────────────────────────────
          Both answers people arrive with: how the thing works, and what the
          code on that red message meant. */}
      <p className={`${label} mb-2 px-1`}>Help</p>
      <div className="rounded-2xl border border-line bg-surface overflow-hidden mb-5">
        <Link to="/about" className="flex items-center justify-between gap-3 px-4 py-3.5 active:bg-surface-2 transition-colors">
          <span>
            <span className="block text-[14px] font-semibold text-graphite">How Padelier works</span>
            <span className="block text-[12px] text-warm-gray mt-0.5">Formats, scoring, clubs and your rating</span>
          </span>
          <span className="text-stone text-[15px] shrink-0" aria-hidden>›</span>
        </Link>
        <div className="h-px bg-line" />
        <Link to="/codes" className="flex items-center justify-between gap-3 px-4 py-3.5 active:bg-surface-2 transition-colors">
          <span>
            <span className="block text-[14px] font-semibold text-graphite">Error codes</span>
            <span className="block text-[12px] text-warm-gray mt-0.5">Look up any code the app has shown you</span>
          </span>
          <span className="text-stone text-[15px] shrink-0" aria-hidden>›</span>
        </Link>
        <div className="h-px bg-line" />
        <Link to="/about#offline" className="flex items-center justify-between gap-3 px-4 py-3.5 active:bg-surface-2 transition-colors">
          <span>
            <span className="block text-[14px] font-semibold text-graphite">Playing without signal</span>
            <span className="block text-[12px] text-warm-gray mt-0.5">What happens to scores on a court with no bars</span>
          </span>
          <span className="text-stone text-[15px] shrink-0" aria-hidden>›</span>
        </Link>
      </div>

      {/* ── Account ────────────────────────────────────────────────────── */}
      <p className={`${label} mb-2 px-1`}>Account</p>
      <div className="rounded-2xl border border-line bg-surface overflow-hidden mb-5">
        {profile && (
          <>
            <Link to={`/u/${profile.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 active:bg-surface-2 transition-colors">
              <span className="text-[14px] font-semibold text-graphite">Your public profile</span>
              <span className="text-stone text-[15px] shrink-0" aria-hidden>›</span>
            </Link>
            <div className="h-px bg-line" />
          </>
        )}

        {isAdmin && (
          <>
            <Link to="/admin" className="flex items-center justify-between gap-3 px-4 py-3.5 active:bg-surface-2 transition-colors">
              <span className="text-[14px] font-semibold text-gold-ink">Admin dashboard</span>
              <span className="text-stone text-[15px] shrink-0" aria-hidden>›</span>
            </Link>
            <div className="h-px bg-line" />
          </>
        )}

        <button
          type="button"
          onClick={() => toggle("password")}
          aria-expanded={openRow === "password"}
          className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-surface-2 transition-colors"
        >
          <span className="text-[14px] font-semibold text-graphite">Change password</span>
          <span className={`text-stone text-[15px] shrink-0 transition-transform ${openRow === "password" ? "rotate-90" : ""}`} aria-hidden>›</span>
        </button>

        {openRow === "password" && (
          <form onSubmit={submitPassword} className="px-4 pb-4 pt-1 border-t border-line anim-fade">
            <div className="space-y-2.5">
              <PasswordField
                value={currentPw}
                onChange={setCurrentPw}
                placeholder="Current password"
                autoComplete="current-password"
                required
              />
              <PasswordField
                value={newPw}
                onChange={setNewPw}
                placeholder="New password"
                autoComplete="new-password"
                minLength={8}
                required
                onFocus={() => setPwFocused(true)}
                onBlur={() => setPwFocused(false)}
                describedBy="settings-password-policy"
              />
              <div id="settings-password-policy" aria-live="polite">
                <PasswordStrength verdict={verdict} show={pwFocused || newPw.length > 0} />
              </div>
            </div>
            {pwErr && <p className="text-[13px] text-loss mt-2">{pwErr}</p>}
            {pwMsg && <p className="text-[13px] text-win mt-2">{pwMsg}</p>}
            <button
              type="submit"
              disabled={savingPw || !currentPw || !newPw || !verdict.valid}
              className={`${primaryBtn} mt-3`}
            >
              {savingPw ? "Changing…" : "Change password"}
            </button>
            <p className="text-[11.5px] text-warm-gray mt-2 leading-relaxed">
              We ask for your current password so a borrowed phone can't be used to lock you out.
            </p>
          </form>
        )}

        <div className="h-px bg-line" />
        <button
          onClick={handleSignOut}
          className="w-full text-left px-4 py-3.5 text-[14px] font-semibold text-ink-2 active:bg-surface-2 transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* ── Legal ──────────────────────────────────────────────────────
          Reachable from inside the app, not only from the logged-out home.
          Someone deciding whether to delete their account is exactly the
          person who wants to read what happens to their data. */}
      <p className={`${label} mb-2 px-1`}>Legal</p>
      <div className="rounded-2xl border border-line bg-surface overflow-hidden mb-5">
        <Link to="/privacy" className="flex items-center justify-between gap-3 px-4 py-3.5 active:bg-surface-2 transition-colors">
          <span className="text-[14px] text-ink-2">Privacy policy</span>
          <span className="text-stone text-[15px] shrink-0" aria-hidden>›</span>
        </Link>
        <div className="h-px bg-line" />
        <Link to="/terms" className="flex items-center justify-between gap-3 px-4 py-3.5 active:bg-surface-2 transition-colors">
          <span className="text-[14px] text-ink-2">Terms of use</span>
          <span className="text-stone text-[15px] shrink-0" aria-hidden>›</span>
        </Link>
      </div>

      {/* ── Deleting the account ───────────────────────────────────────
          Last, quiet, and collapsed — but still here rather than behind an
          email request. Erasure is a right, and a right you have to ask a
          stranger for by email isn't much of one. The consequences are shown
          before the button, not after it. */}
      <div className="rounded-2xl border border-line bg-surface overflow-hidden mb-3">
        <button
          type="button"
          onClick={() => toggle("delete")}
          aria-expanded={openRow === "delete"}
          className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-surface-2 transition-colors"
        >
          <span className="text-[14px] font-semibold text-loss">Delete account</span>
          <span className={`text-stone text-[15px] shrink-0 transition-transform ${openRow === "delete" ? "rotate-90" : ""}`} aria-hidden>›</span>
        </button>

        {openRow === "delete" && (
          <div className="px-4 pb-4 pt-3 border-t border-line anim-fade">
            <p className="text-[12.5px] text-ink-2 leading-relaxed">
              Your name, email, password, photo and bio are erased straight away, and you're signed out
              everywhere. Matches you played stay as anonymous records — other people were in them, and
              their history is built from the same scores.
            </p>
            <p className="text-[12px] text-warm-gray leading-relaxed mt-2">
              This can't be undone, and the same email can be used to start again from scratch.
            </p>

            {!confirmingDelete ? (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="w-full rounded-full border-[1.5px] border-loss/35 text-loss bg-surface px-4 py-3 font-semibold text-[13.5px] mt-3 active:scale-[0.99] transition-transform"
              >
                Delete my account
              </button>
            ) : (
              <div className="mt-3 anim-fade">
                <label htmlFor="confirm-delete" className="block text-[12.5px] text-ink-2 mb-2">
                  Type <span className="font-mono font-semibold text-graphite">DELETE</span> to confirm.
                </label>
                <input
                  id="confirm-delete"
                  value={confirmText}
                  onChange={(e) => {
                    setConfirmText(e.target.value);
                    setDelErr(null);
                  }}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className={input}
                  placeholder="DELETE"
                />
                {delErr && <p className="text-[13px] text-loss mt-2">{delErr}</p>}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => {
                      setConfirmingDelete(false);
                      setConfirmText("");
                      setDelErr(null);
                    }}
                    disabled={deleting}
                    className="flex-1 rounded-full border-[1.5px] border-line text-ink-2 bg-surface px-4 py-3 font-semibold text-[13.5px] active:scale-[0.99] transition-transform disabled:opacity-40"
                  >
                    Keep it
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting || confirmText.trim().toUpperCase() !== "DELETE"}
                    className="flex-1 rounded-full bg-loss text-ivory px-4 py-3 font-semibold text-[13.5px] active:scale-[0.99] transition-transform disabled:opacity-40 disabled:active:scale-100"
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
