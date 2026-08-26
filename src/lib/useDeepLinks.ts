import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { handleDeepLink, onDeepLink } from "./native";

/**
 * Mounted once, inside the Router. Everything the OS hands the app arrives
 * here: the OAuth return, and later a shared session link tapped in WhatsApp.
 *
 * There is nothing to do on the signed-in case. The Supabase client fires its
 * own auth state change when exchangeCodeForSession succeeds, LoginPage is
 * already watching for it, and the routing that follows — onboarding, or
 * wherever they were headed — is the same code path the web sign-in uses. A
 * navigate() here would race it.
 */
export function useDeepLinks(onAuthError?: (message: string) => void) {
  const navigate = useNavigate();

  useEffect(() => {
    return onDeepLink((url) => {
      void handleDeepLink(url).then((result) => {
        if (result.kind === "path") navigate(result.path);
        else if (result.kind === "auth-error") onAuthError?.(result.message);
      });
    });
  }, [navigate, onAuthError]);
}
