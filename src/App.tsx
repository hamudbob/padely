import { useEffect } from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import HomePage from "./features/home/HomePage";
import LoginPage from "./features/auth/LoginPage";
import ResetPasswordPage from "./features/auth/ResetPasswordPage";
import ProfilePage from "./features/profile/ProfilePage";
import RequireHost from "./features/auth/RequireHost";
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

export default function App() {
  useRecoveryRedirect();
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      {/* Where Supabase's password-recovery email lands. */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/profile"
        element={
          <RequireHost>
            <ProfilePage />
          </RequireHost>
        }
      />
      {/* Watch and Join are one flow now: enter a code → live session view,
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
      <Route path="/session/:sessionId/final" element={<FinalSummaryPage />} />
      <Route path="/live/:publicToken" element={<PublicLivePage />} />
      <Route path="/u/:userId" element={<PublicProfilePage />} />
      <Route path="/e/:eventId" element={<EventPage />} />
      <Route
        path="/teams"
        element={
          <RequireHost>
            <TeamsPage />
          </RequireHost>
        }
      />
      <Route
        path="/teams/:teamId"
        element={
          <RequireHost>
            <TeamDetailPage />
          </RequireHost>
        }
      />
      <Route
        path="/teams/:teamId/league"
        element={
          <RequireHost>
            <LeaguePage />
          </RequireHost>
        }
      />
      <Route
        path="/teams/:teamId/champions"
        element={
          <RequireHost>
            <ChampionsPage />
          </RequireHost>
        }
      />
      <Route
        path="/teams/:teamId/members"
        element={
          <RequireHost>
            <MembersPage />
          </RequireHost>
        }
      />
      <Route
        path="/notifications"
        element={
          <RequireHost>
            <NotificationsPage />
          </RequireHost>
        }
      />
    </Routes>
  );
}
