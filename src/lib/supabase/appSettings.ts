import { useEffect, useState } from "react";
import { supabase } from "./client";

/**
 * The one row the whole app reads on load (0043).
 *
 * It exists so a problem at 8pm doesn't need a deploy: an announcement that
 * reaches every screen, and a pause on new signups. Deliberately readable by
 * anon as well as authenticated — the person who most needs to be told
 * something is wrong is the one who can't sign in.
 *
 * Failure is silent by design. If this call fails, or the migration hasn't
 * been run, the app behaves exactly as it did before the table existed: no
 * banner, signups open. A settings lookup must never be the reason someone
 * can't use the app.
 */
export interface AppSettings {
  bannerMessage: string | null;
  bannerTone: "info" | "warn";
  signupsPaused: boolean;
  maintenanceMessage: string | null;
}

const NONE: AppSettings = {
  bannerMessage: null,
  bannerTone: "info",
  signupsPaused: false,
  maintenanceMessage: null,
};

type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;

/** Cached for the page's lifetime: this is read on several screens and the
 *  value changes about once a month. */
let cached: Promise<AppSettings> | null = null;

export function getAppSettings(): Promise<AppSettings> {
  if (!cached) {
    cached = rpc("get_app_settings", {})
      .then(({ data, error }) => {
        if (error || !data) return NONE;
        const row = data as {
          banner_message?: string | null;
          banner_tone?: string | null;
          signups_paused?: boolean | null;
          maintenance_message?: string | null;
        };
        return {
          bannerMessage: row.banner_message ?? null,
          bannerTone: row.banner_tone === "warn" ? "warn" : "info",
          signupsPaused: row.signups_paused === true,
          maintenanceMessage: row.maintenance_message ?? null,
        } as AppSettings;
      })
      .catch(() => NONE);
  }
  return cached;
}

/** Forget the cache — the admin screen calls this after saving so the banner
 *  updates without a reload. */
export function invalidateAppSettings(): void {
  cached = null;
}

export function useAppSettings(): AppSettings {
  const [settings, setSettings] = useState<AppSettings>(NONE);
  useEffect(() => {
    let cancelled = false;
    getAppSettings().then((s) => {
      if (!cancelled) setSettings(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return settings;
}
