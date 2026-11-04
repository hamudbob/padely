import { useEffect, useState } from "react";
import { getLocalSession } from "../../lib/offline/localSession";
import { syncProblem, friendlyReason, SyncProblem } from "../../lib/offline/syncProblem";

/**
 * A line on the host screen when this phone's copy isn't reaching the server.
 * See syncProblem.ts for when it speaks and when it stays quiet. Re-checks
 * every few seconds; it reads localStorage, so that costs nothing.
 */
export default function SyncStatusBanner({ sessionId }: { sessionId: string }) {
  const [problem, setProblem] = useState<SyncProblem | null>(null);

  useEffect(() => {
    const check = () => {
      const online = typeof navigator === "undefined" || !("onLine" in navigator) || navigator.onLine;
      setProblem(syncProblem(getLocalSession(sessionId), Date.now(), online));
    };
    check();
    const t = window.setInterval(check, 5000);
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, [sessionId]);

  if (!problem) return null;

  let title: string;
  let body: string;
  if (problem.kind === "offline") {
    title = "No signal";
    body = problem.neverUploaded
      ? "Everything is saved on this phone. It uploads by itself when you're back online; until then players can't join by code."
      : "Everything is saved on this phone and uploads by itself when you're back online.";
  } else if (problem.kind === "refused") {
    title = problem.neverUploaded ? "This session hasn't reached the server" : "Latest changes haven't reached the server";
    const why = problem.reason ? friendlyReason(problem.reason) : "It's still trying.";
    body = problem.neverUploaded
      ? `${why} Until it does, players can't join by code and it won't appear in your club. Everything is safe on this phone; keep the app open and it retries every minute.`
      : `${why} Everything is safe on this phone, and it retries every minute.`;
  } else {
    title = "Latest changes haven't reached the server";
    body = `Nothing has uploaded for ${problem.minutes} minutes. Everything is safe on this phone; it keeps retrying.`;
  }

  return (
    <div role="status" className="mb-4 rounded-2xl border border-loss/25 bg-loss-soft/60 px-3.5 py-3">
      <p className="text-[12.5px] font-semibold text-loss">{title}</p>
      <p className="text-[12px] text-ink-2 mt-0.5 leading-snug">{body}</p>
    </div>
  );
}
