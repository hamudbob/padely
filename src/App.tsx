import { useEffect, useRef } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import HomePage from "./features/home/HomePage";
import LoginPage from "./features/auth/LoginPage";
import ResetPasswordPage from "./features/auth/ResetPasswordPage";
import OnboardingPage from "./features/auth/OnboardingPage";
import AppShell from "./features/shell/AppShell";
import LaunchVeil from "./features/shell/LaunchVeil";
import PlayPage from "./features/play/PlayPage";
import SubShell from "./features/shell/SubShell";
import AboutPage from "./features/about/AboutPage";
import ErrorCodesPage from "./features/help/ErrorCodesPage";
import FeaturePage from "./features/discover/FeaturePage";
import FeaturesIndexPage from "./features/discover/FeaturesIndexPage";
import LegalPage from "./features/legal/LegalPage";
import DeleteAccountPage from "./features/legal/DeleteAccountPage";
import { PRIVACY, TERMS } from "./features/legal/legalContent";
import SettingsPage from "./features/settings/SettingsPage";
import ProfilePage from "./features/profile/ProfilePage";
import RequireHost from "./features/auth/RequireHost";
import { useHostSession } from "./lib/supabase/useHostSession";
import { useDeepLinks } from "./lib/useDeepLinks";
import { usePushNotifications } from "./lib/usePushNotifications";
import { useEdgeSwipeBack } from "./lib/useEdgeSwipeBack";
import { useScrollRestoration } from "./lib/useScrollRestoration";
import WatchPage from "./features/watch/WatchPage";
import CreateSessionPage from "./features/create-session/CreateSessionPage";
import HostLivePage from "./features/host-live/HostLivePage";
import PublicLivePage from "./features/public-live/PublicLivePage";
import FinalSummaryPage from "./features/final-summary/FinalSummaryPage";
import TeamsPage from "./features/teams/TeamsPage";
import TeamDetailPage from "./features/teams/TeamDetailPage";
import LeaguePage from "./features/teams/LeaguePage";
import ChampionsPage from "./features/teams/ChampionsPage";
import MembersPage from "./features/teams/MembersPage";
import EventPage from "./features/teams/EventPage";
import PublicProfilePage from "./features/public-profile/PublicProfilePage";
import NotificationsPage from "./features/notifications/NotificationsPage";
import AppNotice from "./features/shell/AppNotice";
import AdminPage from "./features/admin/AdminPage";
import AdminUserPage from "./features/admin/AdminUserPage";
import AdminSessionPage from "./features/admin/AdminSessionPage";
import RequireAdmin from "./features/admin/RequireAdmin";

/**
 * Safety net for password recovery. Supabase only redirects to URLs on the
 * project's allow-list; anything else silently falls back to the Site URL. That
 * used to drop people on the home screen (already signed in, with no way to set
 * a password) — the recovery token was simply consumed and lost. Here we spot
 * the `type=recovery` token in the URL no matter which route it landed on and
 * hand it to /reset-password with the hash intact.
 */
function useRecoveryRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const hash = window.location.hash;
    const isRecovery = hash.includes("type=recovery") || hash.includes("error_code=otp_expired");
    if (isRecovery && location.pathname !== "/reset-password") {
      navigate(`/reset-password${hash}`, { replace: true });
    }
    // Runs once per mount; the hash is only present on the landing navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * "/" serves two audiences. A visitor gets the public landing page; someone
 * signed in gets sent to Play, which is what "home" means once you have an
 * account. Doing the switch here rather than inside HomePage keeps every
 * existing link to "/" — the wordmark in a dozen headers — correct for both.
 */
function RootRoute() {
  const { user, loading } = useHostSession();
  if (loading) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8 safe-top">
        <p className="text-sm text-warm-gray">One moment…</p>
      </div>
    );
  }
  return user ? <Navigate to="/play" replace /> : <HomePage />;
}

export default function App() {
  useRecoveryRedirect();
  // Everything the OS hands the native app comes through here: the OAuth
  // return, and later a shared /e/<id> link tapped in a group chat. No-op in a
  // browser.
  useDeepLinks();
  // Attaches the APNs listeners: the device token when it arrives or rotates,
  // and taps. Does NOT ask for permission — that happens at the moments where
  // saying yes makes sense (see lib/push.ts). No-op in a browser.
  usePushNotifications();

  // Drag from the left edge to go back, with the screen following your thumb.
  // The wrapper below is what moves; nothing else in the tree knows about it.
  // See lib/useEdgeSwipeBack.ts for why this isn't WKWebView's own gesture.
  const swipeRef = useRef<HTMLDivElement>(null);
  useEdgeSwipeBack(swipeRef);

  // New screens start at the top; going back returns you to where you were.
  // React Router does neither on its own — it leaves the window's scroll
  // offset alone, which is why the league table used to open halfway down.
  useScrollRestoration();

  return (
    <>
      {/* First thing painted, and the only thing visible until it leaves.
          Nothing at all in a browser. */}
      <LaunchVeil />
      {/* Above the router so one announcement reaches every screen, including
          the signed-out ones. Renders nothing at all when there's no message,
          which is its normal state. */}
      <AppNotice />
      <div ref={swipeRef}>
      <Routes>
      <Route path="/" element={<RootRoute />} />
      <Route path="/login" element={<LoginPage />} />
      {/* Public: it has to work as a link pasted into a group chat by someone
          who hasn't signed up yet. */}
      <Route path="/about" element={<AboutPage />} />
      {/* Public on purpose: someone who hit an error on a shared live link has
          no account and still needs to look the code up. */}
      <Route path="/codes" element={<ErrorCodesPage />} />
      {/* Feature pages. Public and shareable: a host pastes /f/mexicano into a
          group chat to explain the format, and the CTA at the bottom is then
          the way in for whoever hasn't got an account yet. */}
      <Route path="/features" element={<FeaturesIndexPage />} />
      <Route path="/f/:slug" element={<FeaturePage />} />
      {/* Public for the same reason, and for one more: a privacy notice that
          only a signed-in person can read is no notice at all — it has to be
          readable *before* someone hands over an email address. */}
      {/* Public, unauthenticated, and it must stay that way: Play requires a
          URL someone can open AFTER uninstalling the app. */}
      <Route path="/delete-account" element={<DeleteAccountPage />} />
      <Route path="/privacy" element={<LegalPage doc={PRIVACY} other="terms" />} />
      <Route path="/terms" element={<LegalPage doc={TERMS} other="privacy" />} />
      {/* Where Supabase's password-recovery email lands. */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {/* First run after email confirmation: name, photo, side, gender.
          RequireHost redirects here until profiles.onboarded_at is set. */}
      <Route
        path="/welcome"
        element={
          <RequireHost>
            <OnboardingPage />
          </RequireHost>
        }
      />
      {/* ── The three tabs. Everything inside shares the bottom bar. ────────
          Sub-pages (a club, a session, settings) deliberately live OUTSIDE the
          shell: they're a level down, they carry their own back button, and a
          tab bar there would offer to teleport you out of a flow you're in. */}
      <Route
        element={
          <RequireHost>
            <AppShell />
          </RequireHost>
        }
      >
        <Route path="/play" element={<PlayPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      {/* ── Places you drill into: these KEEP the tab bar ────────────────
          A club, its league, its champions, its members, your notifications,
          your settings. You're browsing, not doing — leaving costs nothing, so
          being able to jump straight to another tab is a convenience. */}
      <Route
        element={
          <RequireHost>
            <SubShell />
          </RequireHost>
        }
      >
        <Route path="/teams/:teamId" element={<TeamDetailPage />} />
        <Route path="/teams/:teamId/league" element={<LeaguePage />} />
        <Route path="/teams/:teamId/champions" element={<ChampionsPage />} />
        <Route path="/teams/:teamId/members" element={<MembersPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* The operator's view. RequireAdmin only decides what to RENDER —
            every admin RPC re-checks is_admin server-side, so shipping these
            two screens in everyone's bundle grants nobody anything. */}
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/u/:userId"
          element={
            <RequireAdmin>
              <AdminUserPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/s/:sessionId"
          element={
            <RequireAdmin>
              <AdminSessionPage />
            </RequireAdmin>
          }
        />
      </Route>

      {/* Places that are ALSO shareable links. Same screens for a member and a
          stranger, so they can't sit behind RequireHost — SubShell draws the
          tab bar only when someone is actually signed in. */}
      <Route element={<SubShell />}>
        <Route path="/e/:eventId" element={<EventPage />} />
        <Route path="/session/:sessionId/final" element={<FinalSummaryPage />} />
      </Route>

      {/* ── Tasks: NO tab bar ─────────────────────────────────────────────
          Code entry, the create wizard, a live session. You're partway through
          something and leaving costs you progress, so a permanent shortcut out
          is a hazard rather than a convenience. They each carry PageHeader
          instead, which keeps the wordmark (and a way home) on screen.

          Watch and Join are one flow now: enter a code → live session view,
          where you can watch, claim your spot, or join as a new player. */}
      <Route path="/join" element={<WatchPage />} />
      <Route path="/watch" element={<WatchPage />} />
      <Route
        path="/create"
        element={
          <RequireHost>
            <CreateSessionPage />
          </RequireHost>
        }
      />
      <Route
        path="/session/:sessionId/host"
        element={
          <RequireHost>
            <HostLivePage />
          </RequireHost>
        }
      />
      <Route path="/live/:publicToken" element={<PublicLivePage />} />
      <Route path="/u/:userId" element={<PublicProfilePage />} />
      {/* A mistyped or stale URL lands on "/", which then routes by session
          state — never a blank screen. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </div>
    </>
  );
}
