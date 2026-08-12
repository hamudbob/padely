/**
 * Password policy for signup and password reset.
 *
 * Four rules, in the order people naturally fix them:
 *   1. at least 8 characters
 *   2. upper- and lowercase letters
 *   3. at least one number
 *   4. not an obvious password
 *
 * Rule 4 is the one that actually matters. "Password1" satisfies rules 1–3
 * perfectly and is one of the most-guessed passwords in existence, so we check
 * the thing itself rather than just its character classes: a list of common
 * passwords, keyboard runs, counting sequences, single repeated characters, and
 * anything built out of the person's own name or email.
 *
 * All of this is a UX layer, not the security boundary — it stops people from
 * *choosing* a bad password. The real enforcement is Supabase's own minimum
 * length plus the leaked-password (HIBP) check in Authentication → Policies,
 * which sees passwords this file never can.
 */

export type RuleId = "length" | "case" | "number" | "notCommon";

export interface PasswordRule {
  id: RuleId;
  label: string;
  met: boolean;
}

export type Strength = "empty" | "weak" | "fair" | "good" | "strong";

export interface PasswordVerdict {
  rules: PasswordRule[];
  /** Every rule satisfied — the form may submit. */
  valid: boolean;
  strength: Strength;
  /** 0–4, for the segmented meter. */
  score: number;
  /** Set only when rule 4 fails, so we can say *why* it's guessable. */
  weakReason: string | null;
}

/**
 * The passwords that show up at the top of every breach corpus, plus the ones
 * this app invites specifically (padel, padelier, the sport's vocabulary).
 * Deliberately short: it catches the lazy 95% without shipping a dictionary.
 * The real long tail is Supabase's HIBP check.
 */
const COMMON = new Set([
  "password", "passwort", "pass", "passcode", "letmein", "welcome", "admin", "administrator",
  "qwerty", "qwertyuiop", "azerty", "asdf", "asdfgh", "asdfghjkl", "zxcvbn", "zxcvbnm",
  "iloveyou", "sunshine", "princess", "dragon", "monkey", "football", "baseball", "master",
  "shadow", "superman", "batman", "trustno", "freedom", "whatever", "starwars", "computer",
  "michael", "jennifer", "jordan", "hunter", "ranger", "buster", "soccer", "harley",
  "abc", "abcd", "abcde", "abcdef", "abcdefg", "test", "testing", "temp", "temporary",
  "changeme", "secret", "login", "user", "guest", "root", "default", "example", "sample",
  "money", "qazwsx", "qwe", "asd", "zaq", "hello", "helloworld", "god", "love", "sex",
  "padel", "padelier", "padelclub", "tennis", "americano", "court", "smash", "racket", "racquet",
  "jakarta", "indonesia", "bandung", "surabaya",
  // Common in Indonesia specifically.
  "sayang", "cinta", "rahasia", "bismillah", "aku", "kamu", "namaku",
]);

/** Rows on a QWERTY board, plus the number row — for run detection. */
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];

/**
 * Fold the cheap disguises people use to smuggle a common word past a checker:
 * leetspeak substitutions, then trailing digits and punctuation. "P@ssw0rd!23"
 * and "Password" have to look the same to us, because they look the same to an
 * attacker's cracking rules.
 */
function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[3€]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/0/g, "o")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/9/g, "g")
    .replace(/[^a-z]/g, "");
}

/** Every character the same — "aaaaaaaa", "11111111". */
function isSingleRepeat(s: string): boolean {
  return s.length > 0 && new Set(s).size === 1;
}

/**
 * One character held down — "Aaaaaaa1" passes every character-class rule and is
 * trivially guessable, so the padding has to be caught on its own rather than
 * only as a whole-string repeat.
 */
function hasHeldKey(s: string): boolean {
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    run = s[i] === s[i - 1] ? run + 1 : 1;
    if (run >= 4) return true;
  }
  return false;
}

/** A short unit repeated to length — "abcabcabc", "1212121212". */
function isRepeatedUnit(s: string): boolean {
  for (let unit = 1; unit <= Math.floor(s.length / 2); unit++) {
    if (s.length % unit !== 0) continue;
    const head = s.slice(0, unit);
    if (s.split("").every((c, i) => c === head[i % unit])) return true;
  }
  return false;
}

/**
 * A straight run of 6+ along the alphabet, the number line, or a keyboard row —
 * forwards or backwards. Six is the threshold because "abc" inside an otherwise
 * fine password is not a problem; "abcdef" as the password is.
 */
function hasLongRun(lower: string): boolean {
  if (lower.length < 6) return false;

  // Alphabet / number line: consecutive code points in one direction.
  let run = 1;
  let dir = 0;
  for (let i = 1; i < lower.length; i++) {
    const step = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    if (step === 1 || step === -1) {
      if (step === dir) run++;
      else {
        dir = step;
        run = 2;
      }
      if (run >= 6) return true;
    } else {
      run = 1;
      dir = 0;
    }
  }

  // Keyboard rows, in both directions.
  for (const row of KEYBOARD_ROWS) {
    const back = row.split("").reverse().join("");
    for (let i = 0; i + 6 <= row.length; i++) {
      if (lower.includes(row.slice(i, i + 6)) || lower.includes(back.slice(i, i + 6))) return true;
    }
  }
  return false;
}

/**
 * Personal information: their own name or the local part of their email. These
 * are the first things anyone targeting a specific person tries, and they're
 * printed right next to the password box on this very form.
 */
function usesPersonalInfo(lower: string, name?: string, email?: string): boolean {
  const parts: string[] = [];
  if (name) parts.push(...name.toLowerCase().split(/[^a-z0-9]+/i));
  if (email) parts.push(...email.toLowerCase().split("@")[0].split(/[^a-z0-9]+/i));
  // 4+ characters only, so an initial or a two-letter surname doesn't trip it.
  return parts.some((p) => p.length >= 4 && lower.includes(p));
}

export interface PolicyContext {
  name?: string;
  email?: string;
}

/** Why rule 4 failed, phrased as something the person can act on. */
function findWeakReason(password: string, ctx: PolicyContext): string | null {
  const lower = password.toLowerCase();
  const core = normalise(password);

  if (isSingleRepeat(password)) return "That's the same character repeated.";
  if (hasHeldKey(lower)) return "Four or more of the same character in a row is easy to guess.";
  if (password.length >= 6 && isRepeatedUnit(lower)) return "That's a short pattern on repeat.";
  if (hasLongRun(lower)) return "Straight runs like “abcdef” or “123456” are the first thing guessed.";
  if (core.length >= 3 && COMMON.has(core)) return "That's one of the most common passwords in the world.";
  if (usesPersonalInfo(lower, ctx.name, ctx.email)) return "Avoid your own name or email — those get tried first.";
  if (/^\d+$/.test(password)) return "Digits alone are quick to guess — mix in some letters.";
  // A common word carrying the whole password ("padelclub", "welcomehome") is
  // still a common word — normalise() already stripped any digits and symbols,
  // so what's left has to be more than a bit of padding around a known word.
  for (const word of COMMON) {
    if (word.length >= 5 && core.includes(word) && core.length <= word.length + 2) {
      return "That's built around a very common word.";
    }
  }
  return null;
}

export function evaluatePassword(password: string, ctx: PolicyContext = {}): PasswordVerdict {
  const weakReason = password.length > 0 ? findWeakReason(password, ctx) : null;

  const rules: PasswordRule[] = [
    { id: "length", label: "At least 8 characters", met: password.length >= 8 },
    {
      id: "case",
      label: "An uppercase and a lowercase letter",
      met: /[a-z]/.test(password) && /[A-Z]/.test(password),
    },
    { id: "number", label: "At least one number", met: /\d/.test(password) },
    { id: "notCommon", label: "Not an obvious password", met: password.length > 0 && weakReason === null },
  ];

  const valid = rules.every((r) => r.met);

  // The meter rewards length beyond the minimum, because length is what actually
  // buys resistance to guessing — but it can never read above "fair" while a
  // rule is still unmet, so the bar and the checklist never contradict.
  let score = 0;
  if (password.length > 0) {
    const met = rules.filter((r) => r.met).length;
    // Always at least one lit segment once they've started typing, so the meter
    // reads as "here's where you are" rather than as a broken control.
    if (valid) score = password.length >= 12 ? 4 : 3;
    else score = Math.max(1, Math.min(met, 2));
  }

  const strength: Strength =
    password.length === 0 ? "empty" : score <= 1 ? "weak" : score === 2 ? "fair" : score === 3 ? "good" : "strong";

  return { rules, valid, strength, score, weakReason };
}

export const STRENGTH_LABEL: Record<Strength, string> = {
  empty: "",
  weak: "Weak",
  fair: "Getting there",
  good: "Good",
  strong: "Strong",
};
