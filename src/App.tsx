import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import HomePage from "./features/home/HomePage";
import LoginPage from "./features/auth/LoginPage";
import ResetPasswordPage from "./features/auth/ResetPasswordPage";
import OnboardingPage from "./features/auth/OnboardingPage";
import AppShell from "./features/shell/AppShell";
import PlayPage from "./features/play/PlayPage";
import SubShell from "./features/shell/SubShell";
import SettingsPage from "./features/settings/SettingsPage";
import ProfilePage from "./features/profile/ProfilePage";
import RequireHost from "./features/auth/RequireHost";
import { useHostSession } from "./lib/supabase/useHostSession";
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
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8">
        <p className="text-sm text-warm-gray">One moment…</p>
      </div>
    );
  }
  return user ? <Navigate to="/play" replace /> : <HomePage />;
}

export default function App() {
  useRecoveryRedirect();
  return (
    <Routes>
      <Route path="/" element={<RootRoute />} />
      <Route path="/login" element={<LoginPage />} />
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
  );
}
