import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Back navigation that returns to the ACTUAL previous page when the user
 * arrived here by navigating inside the app, and only falls back to a sensible
 * default when the page was opened cold — a deep link, a shared URL, or a hard
 * refresh — where there is no in-app history entry to pop.
 *
 * React Router stamps the very first history entry of a session with the key
 * "default"; any entry pushed by in-app navigation gets a unique key. So a key
 * of "default" is our reliable signal that going back would leave the app (or
 * do nothing), and we route to `fallback` instead.
 */
export function useBackNav(fallback: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (location.key && location.key !== "default") navigate(-1);
    else navigate(fallback);
  }, [navigate, location.key, fallback]);
}
