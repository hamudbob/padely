import { getMyTeams } from "./teamQueries";
import { getClubEvents, ClubEvent } from "./eventQueries";

/**
 * "When do I play next?" — the one question the old home screen couldn't
 * answer, because scheduled sessions only ever appeared inside the club that
 * owned them.
 *
 * Pure composition of two existing queries: no new tables, no new RPC, no
 * change to how events or RSVPs work. getClubEvents already filters to
 * scheduled, future, non-cancelled events and sorts them ascending, so all
 * that's left is to fan out across the caller's clubs and merge.
 *
 * The fan-out is one request per club. That's fine at the scale this runs at —
 * people belong to one or two clubs, not fifty — and the alternative (a new
 * cross-club RPC) would mean writing exactly the query logic getClubEvents
 * already contains. If someone ever joins enough clubs for this to matter, the
 * fix is a single RPC, not a rewrite of the caller.
 */
export interface UpcomingEvent extends ClubEvent {
  clubName: string;
}

export async function getMyUpcomingEvents(limit = 3): Promise<UpcomingEvent[]> {
  const teams = await getMyTeams();
  if (teams.length === 0) return [];

  const perClub = await Promise.all(
    teams.map(async (team) => {
      try {
        const events = await getClubEvents(team.id);
        return events.map((e) => ({ ...e, clubName: team.name }));
      } catch {
        // One unreadable club must not blank the whole strip.
        return [];
      }
    }),
  );

  return perClub
    .flat()
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, limit);
}
