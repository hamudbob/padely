import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./client";

export interface HostSessionState {
  user: User | null;
  loading: boolean;
}

/**
 * Tracks whether a host is actually logged in, live. Used to guard pages
 * that require auth (Create Session, Host Live) so we fail fast with a clear
 * message instead of letting someone fill out the whole wizard and only
 * discover they're not logged in when Start Session hits Supabase.
 */
export function useHostSession(): HostSessionState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}
