import { Routes, Route } from "react-router-dom";
import HomePage from "./features/home/HomePage";
import LoginPage from "./features/auth/LoginPage";
import RequireHost from "./features/auth/RequireHost";
import JoinPage from "./features/join/JoinPage";
import CreateSessionPage from "./features/create-session/CreateSessionPage";
import HostLivePage from "./features/host-live/HostLivePage";
import PublicLivePage from "./features/public-live/PublicLivePage";
import FinalSummaryPage from "./features/final-summary/FinalSummaryPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/join" element={<JoinPage />} />
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
    </Routes>
  );
}
