# App Store listing

Everything App Store Connect asks for, written out so it can be pasted in
rather than composed under time pressure at submission. Character limits are
Apple's and are hard caps — the counts in brackets are what's written here.

Google Play differs in a few fields; the differences are noted at the end.

---

## Name and subtitle

**App name** (30 max) — [8]

    Padelier

**Subtitle** (30 max) — [29]

    Run a padel session properly

Not "padel session manager". A subtitle sits under the name in search results
and is the only line most people read; it should say what changes for them, not
what category of software this is.

**Promotional text** (170 max, editable without a new build) — [113]

    Fair rounds, one-tap scores, a live leaderboard. Set up a session in
    a minute, then put your phone down and play.

This is the field to change for a launch push or a new format — it updates
without shipping a build, unlike the description.

---

## Description (4000 max) — [~1,750]

    Padelier runs the night so you don't have to.

    Pick a format, add the players, and it builds every round for you —
    who partners whom, who sits out, and when. Scores go in with one tap
    on the court. The board updates itself.

    SEVEN WAYS TO PLAY
    Americano — partner everyone in the room, one round at a time.
    Mexicano — the leaderboard decides the next round's pairings.
    Mix Americano and Mix Mexicano — every team one man and one woman.
    Fixed Partner — you and your partner, all night.
    Fixed Position — always your side of the court.
    Team Sparring — two teams, one scoreboard.

    FAIR BY DEFAULT
    Nobody sits out twice in a row while somebody else plays every round.
    Padelier tracks who has played and who has rested, and evens it out —
    even when a format is pulling the other way.

    A RATING THAT MEANS SOMETHING
    Every result moves your rating, using Glicko-2 — the system that
    knows the difference between beating someone above you and beating
    someone below you, and that a new player's number is a guess until
    it isn't.

    FOR CLUBS
    Schedule a session, share a link, and see who's in before you book
    the courts. Set a cap and the extras join a waiting list that
    promotes itself when someone drops out. A league table across the
    season, and a Champions Hall for whoever keeps winning.

    ON COURT
    Enter a score in one tap. Anyone can watch the live board from a
    link — no account needed. Late arrival? They join with a code, and
    the next round includes them.

    IT WORKS WHEN THE SIGNAL DOESN'T
    Indoor courts are where phone signal goes to die. Scores you enter
    without signal are kept and sent when you're back.

    NO ADS, NO TRACKING
    No advertising, no analytics, nothing sold to anyone. Delete your
    account from Settings and your name, email and photo are erased
    immediately.

    Free to use.

---

## Keywords (100 max, comma-separated, no spaces after commas) — [96]

    padel,americano,mexicano,padel scoring,round robin,tournament,club,
    leaderboard,rating,scoreboard

Rules worth remembering: the app name and subtitle are already indexed, so
repeating "padelier" or "session" here wastes characters. Singular covers
plural. Don't use a competitor's name.

---

## Category, rating, and the rest

| Field | Value |
|---|---|
| Primary category | Sports |
| Secondary category | Utilities |
| Age rating | 17+ — see below |
| Price | Free |
| In-app purchases | None |
| Support URL | https://padelier.id/about |
| Marketing URL | https://padelier.id |
| Privacy policy URL | https://padelier.id/privacy |
| Copyright | 2026 Padelier |

**Age rating.** The terms say 18 and over, so the questionnaire has to reflect
it rather than claim 4+. The reason is user-generated content, not anything in
the app itself: profiles carry a photo and free text that other people see.
Answer the questionnaire honestly — "Infrequent/Mild" for nothing, and declare
user-generated content — and it lands at 17+.

---

## App Privacy — the questionnaire

Apple asks per data type: is it collected, is it linked to the user, is it used
to track. **Nothing in Padelier is used for tracking** — there is no
advertising SDK, no analytics, no third-party tools of any kind. Answer "No" to
tracking throughout.

| Data type | Collected | Linked | Purpose |
|---|---|---|---|
| Email address | Yes | Yes | App functionality (sign-in, session invitations) |
| Name | Yes | Yes | App functionality (shown on lineups and boards) |
| Photos | Yes | Yes | App functionality (optional profile picture) |
| User content — other | Yes | Yes | App functionality (optional bio) |
| Sports/fitness | Yes | Yes | App functionality (results, ratings) |
| User ID | Yes | Yes | App functionality |
| Coarse location | No | — | — |
| Contacts | No | — | — |
| Identifiers for advertising | No | — | — |
| Usage data | No | — | — |
| Diagnostics | Yes | No | App functionality (crash and error reports, not linked to an identity) |

The last row is the error reporter — client errors are recorded so a failure
that a screen catches still reaches the admin console. It stores the message
and the route, not who was on it.

---

## Review notes

Paste this into "Notes" at submission. It answers the two things a reviewer
will ask before they ask them.

    DEMO ACCOUNT
    Email: <a real account on production>
    Password: <its password>
    This account hosts a club with a scheduled session and past results,
    so every screen has content in it.

    HOW TO SEE THE APP WORKING
    1. Play tab -> Start a session -> Americano -> add four names -> Start.
    2. Tap a court, enter a score, tap Save. The board reorders itself.
    3. Next round — the pairings are computed from the results.

    ABOUT GUIDELINE 4.2
    Padelier is a tool for running a live sporting event, not a
    repackaged website. It generates fair round pairings, keeps a
    Glicko-2 rating across sessions, and continues to accept scores with
    no network connection — indoor padel courts rarely have signal —
    syncing when it returns. Score entry uses the Taptic Engine.

    REPORTING AND BLOCKING
    Profiles are user-generated (name, photo, bio). Any signed-in player
    can report or block another from the "..." menu on a public profile.
    Blocked players are hidden in both directions. Reports reach an
    in-app moderation queue.

    ACCOUNT DELETION
    Settings -> Delete account, effective immediately. Also documented
    for people who have uninstalled at https://padelier.id/delete-account

---

## Screenshots

Six, in this order. Apple shows the first two or three in search results, so
the argument has to be made by then.

1. **A live session mid-round** — two courts, real names, a score being
   entered. The product doing its job, first.
2. **The leaderboard** — ordered, with a rating column.
3. **Format picker** — the seven formats. Breadth, in one glance.
4. **A club's scheduled session** — the RSVP card, "8/12 in", names visible.
5. **A player profile** — record, rating trend, partners and rivals.
6. **Final summary** — the podium at the end of a night.

Required sizes: 6.9" (1320 × 2868) and 6.5" (1242 × 2688). A 6.9" set alone is
accepted and scaled; supplying both looks better on older devices.

Caption each in six words or fewer, burned into the image above the screenshot,
not left to the App Store's own caption field:

    1. Every round, worked out for you
    2. The board sorts itself
    3. Seven formats, one app
    4. See who's in before you book
    5. A rating that means something
    6. Somebody has to win

**Take them on the simulator against padelier-v2**, with invented but plausible
names. Never production: real members' names and faces in a public store
listing is a privacy problem you cannot take back.

---

## Google Play, where it differs

- **Short description** (80 max) — [78]

      Fair rounds, one-tap scores, a live leaderboard. Padel sessions, run properly.

- **Full description** — same text as above; Play allows 4000 too.
- **Feature graphic** — 1024 × 500, required, with no equivalent on iOS. The P.
  mark on graphite with the subtitle beside it.
- **Data safety form** — the same answers as Apple's, filled in separately.
- **Account deletion URL** — https://padelier.id/delete-account. Required, and
  the reason that page exists.
- **Content rating questionnaire** — IARC, run through Play's own flow.
