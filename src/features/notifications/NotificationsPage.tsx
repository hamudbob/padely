import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  deleteNotification,
  AppNotification,
} from "../../lib/supabase/notificationQueries";
import { respondInvite } from "../../lib/supabase/clubJoinQueries";
import { useBackNav } from "../../lib/useBackNav";

function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const back = useBackNav("/profile");
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    getNotifications().then(setItems).catch(() => setItems([]));
  }
  useEffect(() => {
    load();
    // Mark everything read shortly after opening the panel.
    markAllNotificationsRead().catch(() => undefined);
  }, []);

  async function openTarget(n: AppNotification) {
    if (!n.read) markNotificationRead(n.id).catch(() => undefined);
    const token = (n.data?.public_token as string | undefined) ?? null;
    const eventId = (n.data?.event_id as string | undefined) ?? null;
    const clubId = (n.data?.club_id as string | undefined) ?? null;
    if (token) navigate(`/live/${token}`); // a started session → open the live view
    else if (eventId) navigate(`/e/${eventId}`); // a scheduled session → open its page
    else if (clubId) navigate(`/teams/${clubId}`);
  }

  function dismiss(n: AppNotification) {
    setItems((prev) => (prev ? prev.filter((x) => x.id !== n.id) : prev)); // optimistic
    deleteNotification(n.id).catch(() => load());
  }

  async function respond(n: AppNotification, accept: boolean) {
    const inviteId = n.data?.invite_id as string | undefined;
    if (!inviteId) return;
    setBusy(n.id);
    try {
      await respondInvite(inviteId, accept);
      const clubId = n.data?.club_id as string | undefined;
      markNotificationRead(n.id).catch(() => undefined);
      if (accept && clubId) navigate(`/teams/${clubId}`);
      else load();
    } catch {
      load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade">
      <div className="flex items-center justify-between mb-5">
        <button onClick={back} aria-label="Back" className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform">‹</button>
        <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
          Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
        </div>
        <div className="w-9" />
      </div>

      <h1 className="font-serif text-[26px] font-medium tracking-tight text-graphite mb-4">Notifications</h1>

      {items === null ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-[64px] rounded-2xl skeleton" />)}</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-10 text-center">
          <p className="text-[13px] text-warm-gray">Nothing yet. Team invites and requests will show up here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const isInvite = n.type === "invite" && !!n.data?.invite_id;
            return (
              <div key={n.id} className={`relative rounded-2xl border px-4 py-3 ${n.read ? "border-line bg-surface" : "border-gold/40 bg-gold-soft/40"}`}>
                <button
                  onClick={() => dismiss(n)}
                  aria-label="Dismiss notification"
                  className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full text-warm-gray flex items-center justify-center text-[15px] leading-none active:scale-90 active:text-ink transition-transform"
                >
                  ×
                </button>
                <button onClick={() => openTarget(n)} className="w-full text-left">
                  <div className="flex items-start gap-2 pr-6">
                    {!n.read && <span className="w-2 h-2 rounded-full bg-gold mt-1.5 shrink-0" aria-hidden />}
                    <div className="flex-1 min-w-0">
                      <b className="block text-[14px] font-semibold text-graphite">{n.title}</b>
                      {n.body && <p className="text-[12.5px] text-ink-2 mt-0.5 leading-snug">{n.body}</p>}
                      <p className="text-[10.5px] text-warm-gray mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                  </div>
                </button>
                {isInvite && (
                  <div className="flex gap-2 mt-2.5">
                    <button onClick={() => respond(n, true)} disabled={busy === n.id} className="flex-1 rounded-full bg-graphite text-ivory text-[12.5px] font-semibold py-2 disabled:opacity-40">Accept</button>
                    <button onClick={() => respond(n, false)} disabled={busy === n.id} className="flex-1 rounded-full border border-line text-ink-2 text-[12.5px] font-semibold py-2 bg-surface disabled:opacity-40">Decline</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
