/**
 * Email validation for the sign-in / sign-up screen.
 *
 * Three layers, cheapest first:
 *
 *   1. Shape — stricter than the browser's `type="email"`, which accepts `a@b`.
 *   2. Typo suggestion — a one-character slip on a big provider ("gmial.com")
 *      is offered back as a tappable correction rather than an error, because
 *      the address is *probably* wrong but we can't be certain.
 *   3. Deliverability — a DNS lookup for the domain's mail servers. This is the
 *      only layer that catches a domain which simply doesn't exist, which is
 *      the failure that actually strands people: the account gets created, the
 *      confirmation mail hard-bounces, and the "check your email" screen waits
 *      forever for something that will never arrive.
 *
 * Layer 3 FAILS OPEN by design. If DNS is unreachable, slow, or blocked, we let
 * the signup through — a working address must never be rejected because a
 * third-party resolver had a bad minute. It only ever blocks on a definitive
 * negative answer.
 *
 * Bouncing mail is not free, either: Supabase's shared SMTP has a low bounce
 * tolerance, and enough dead addresses can get sending throttled project-wide —
 * which would break confirmations and password resets for everybody.
 */

/**
 * Deliberately stricter than the spec. The full RFC 5322 grammar permits
 * quoted local parts and bracketed IP domains, which no real signup needs and
 * which no mail provider people actually use would issue.
 */
const SHAPE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/** Providers common enough that a near-miss is far more likely a typo than a real domain. */
const BIG_PROVIDERS = [
  "gmail.com", "googlemail.com",
  // ymail.com and rocketmail.com are real Yahoo domains — listed so they're
  // treated as exact matches rather than "corrected" into gmail.com.
  "yahoo.com", "yahoo.co.id", "yahoo.co.uk", "ymail.com", "rocketmail.com",
  "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
  "aol.com", "gmx.com", "zoho.com", "mail.com", "yandex.com",
];

/** Throwaway inboxes — an account here is unreachable within days. */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "throwawaymail.com", "yopmail.com", "getnada.com",
  "trashmail.com", "sharklasers.com", "dispostable.com", "maildrop.cc",
  "fakeinbox.com", "mytemp.email", "moakt.com", "emailondeck.com",
]);

/**
 * Damerau-Levenshtein (optimal string alignment), capped at `max`.
 *
 * Plain Levenshtein counts a transposition as two edits, which would miss
 * "gmial.com" — and swapping two adjacent letters is the single most common way
 * people mistype a familiar domain. Counting it as one edit is the whole reason
 * this isn't the textbook algorithm.
 */
function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  // Three rows: i-2, i-1, and current — the i-2 row is what makes transposition
  // a single step.
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1); // adjacent swap
      }
      row[j] = v;
      best = Math.min(best, v);
    }
    if (best > max) return max + 1; // whole row already past the cap
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

export interface ShapeResult {
  /** Cleaned address to actually submit — trimmed and lowercased. */
  normalised: string;
  /** Null when the shape is fine. */
  error: string | null;
  /** A full corrected address to offer, e.g. "hamud@gmail.com". */
  suggestion: string | null;
}

/**
 * Layers 1 and 2 — synchronous, safe to run on every keystroke.
 *
 * Lowercasing the whole address is safe in practice: the local part is
 * technically case-sensitive per spec, but no provider anyone signs up with
 * treats it that way, and Supabase stores emails lowercased regardless. Doing
 * it here means "Hamud@Gmail.com" and "hamud@gmail.com" can't become two
 * accounts.
 */
export function checkEmailShape(raw: string): ShapeResult {
  const normalised = raw.trim().toLowerCase();

  if (normalised.length === 0) {
    return { normalised, error: "Please enter your email.", suggestion: null };
  }
  if (normalised.length > 254) {
    return { normalised, error: "That email is too long.", suggestion: null };
  }
  if (!normalised.includes("@")) {
    return { normalised, error: "That's missing the @ — check it again.", suggestion: null };
  }
  if (!SHAPE.test(normalised)) {
    return { normalised, error: "That doesn't look like a complete email address.", suggestion: null };
  }

  const domain = normalised.slice(normalised.lastIndexOf("@") + 1);

  if (DISPOSABLE.has(domain)) {
    return {
      normalised,
      error: "That's a temporary inbox — please use an email you'll still have next season.",
      suggestion: null,
    };
  }

  // An exact match on any known provider is final — never offer a "correction"
  // for an address that's already right. Checked before the distance loop
  // because e.g. yahoo.co.id is 2 edits from yahoo.com and would otherwise be
  // "helpfully" rewritten into the wrong domain.
  if (BIG_PROVIDERS.includes(domain)) {
    return { normalised, error: null, suggestion: null };
  }

  // Near-miss on a big provider: offer it, don't enforce it. Someone really
  // might own a domain a letter away from gmail.com, so this stays a suggestion.
  const local = normalised.slice(0, normalised.lastIndexOf("@"));
  let bestProvider: string | null = null;
  let bestDistance = 3;
  for (const provider of BIG_PROVIDERS) {
    // One edit for short domains, two for longer ones — the longer the domain,
    // the less likely a 2-edit neighbour is a real address someone owns.
    const limit = provider.length >= 9 ? 2 : 1;
    const d = editDistance(domain, provider, limit);
    if (d <= limit && d < bestDistance) {
      bestDistance = d;
      bestProvider = provider;
    }
  }
  if (bestProvider) {
    return { normalised, error: null, suggestion: `${local}@${bestProvider}` };
  }

  return { normalised, error: null, suggestion: null };
}

export type DomainVerdict = "ok" | "no-mail" | "no-domain" | "unknown";

/**
 * Layer 3 — ask public DNS whether the domain can receive mail at all.
 *
 * Google's resolver is used because it answers over HTTPS with CORS enabled, so
 * a browser can call it directly and we need no backend of our own. A domain
 * with no MX record may still accept mail at its A record (an old but legal
 * fallback), so we check MX first and treat a bare A record as good enough.
 *
 * NOTE: if the Content-Security-Policy from the security audit gets applied,
 * `https://dns.google` has to be added to `connect-src` or this call is blocked
 * by the browser — which fails open, so signup keeps working, but the check
 * silently stops catching anything.
 */
export async function checkEmailDomain(email: string, timeoutMs = 2500): Promise<DomainVerdict> {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (!domain) return "unknown";

  const ask = async (type: "MX" | "A") => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(
        `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`,
        { signal: controller.signal, headers: { Accept: "application/dns-json" } },
      );
      if (!res.ok) return null;
      return (await res.json()) as { Status?: number; Answer?: unknown[] };
    } catch {
      return null; // network error, timeout, CSP block → unknown, never a rejection
    } finally {
      clearTimeout(timer);
    }
  };

  const mx = await ask("MX");
  if (!mx || typeof mx.Status !== "number") return "unknown";

  // 3 = NXDOMAIN. The domain itself isn't registered, so this is a typo every
  // time — "jhkas.com" rather than a real host with unusual mail routing.
  if (mx.Status === 3) return "no-domain";
  if (mx.Status !== 0) return "unknown";
  if (Array.isArray(mx.Answer) && mx.Answer.length > 0) return "ok";

  // Registered, but no MX. Fall back to an A record before giving up.
  const a = await ask("A");
  if (!a || typeof a.Status !== "number") return "unknown";
  if (a.Status === 0 && Array.isArray(a.Answer) && a.Answer.length > 0) return "ok";
  return "no-mail";
}

/** Message for a verdict that should block, or null when it shouldn't. */
export function domainVerdictError(verdict: DomainVerdict): string | null {
  switch (verdict) {
    case "no-domain":
      return "We can't find that email's domain — check it for a typo.";
    case "no-mail":
      return "That domain can't receive email, so a confirmation link would never arrive.";
    default:
      return null; // "ok" and "unknown" both proceed
  }
}
