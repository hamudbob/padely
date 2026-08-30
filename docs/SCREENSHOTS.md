# Shooting the App Store screenshots

Six images, taken on the simulator, against **padelier-v2**. Never production —
the screenshots go on a public page, and real members' names and faces cannot be
taken back off it.

The hard part of a store screenshot is not the photography, it is having
something worth photographing. An empty leaderboard, or one reading "Player 1,
Player 2", says the app has never been used. So the first job is to populate the
staging database, and that is a script rather than an evening of tapping.

---

## 1. Populate padelier-v2

    cd "~/Apps by Me/padel-app"
    ./scripts/seed-demo.sh

It asks for the padelier-v2 connection string and reads it silently — Supabase →
padelier-v2 → Connect, Session pooler tab if your network is IPv4-only. It
refuses to run against a database with more than twenty real profiles in it, so
a mis-pasted production string stops rather than doing damage.

It is safe to re-run. Every row it creates has an id beginning `dddd`, and it
deletes those before inserting. Nothing else in the database is touched.

Or, without a terminal: open `supabase/seed/seed_demo.sql`, copy the whole file,
and paste it into the Supabase SQL editor on **padelier-v2**. It runs there too.
What you lose is the guard — the SQL editor will cheerfully run it against
production if that is the project you happen to have open, so check the project
name at the top left before you press Run.

### What you get

**Kemang Padel Club**, owned by Ana, with fourteen members:

| | Name | Rating | |
|---|---|---|---|
| 1 | Ana Prameswari | 1712 | owner |
| 2 | Bagas Nugroho | ~1681 | admin |
| 3 | Sari Wijaya | 1655 | |
| 4 | Rizky Pratama | 1634 | |
| 5 | Nadia Kusuma | 1601 | |
| 6 | Fajar Ramadhan | 1578 | |
| 7 | Putri Handayani | 1552 | |
| 8 | Andhika Surya | 1530 | |
| 9 | Maya Lestari | 1508 | |
| 10 | Reza Mahendra | 1487 | |
| 11 | Dewi Anggraini | 1463 | |
| 12 | Yoga Saputra | ~1414 | |
| 13 | Dimas Aditya | 1418 | |
| 14 | Arif Setiawan | 1395 | |

Eight men, six women — lopsided on purpose, so the Mix formats have something to
work around.

Plus:

- **Five Tuesdays already played**, on the five real Tuesdays before today, at
  19:00. Alternating Americano and Mexicano, twelve players a night, three
  courts, six rounds — ninety scored matches in total.
- **A league table computed from those scores**, not invented. This matters:
  a screenshot shows two screens' worth of numbers at once, and a leaderboard
  that contradicts the match results behind it is exactly what a reviewer
  notices.
- **A rating history that lands where the profile says it does.** Each player's
  graph zigzags across five weeks and finishes on the number printed at the top
  of their profile.
- **Next Tuesday, 19:00, scheduled**, twelve places, fourteen answers: ten in,
  two on the waiting list, one maybe, one out. The cap and the queue both
  visible in one screenshot.

### Signing in

    ana@demo.padelier.id     DemoPadel2026

Every member uses their own first name and the same password —
`bagas@demo.padelier.id`, `sari@demo.padelier.id`, and so on. Sign in as **Ana**:
she owns the club, so she sees everything.

Nobody has a profile photo. Initials look deliberate and are honest; if you want
one photo for the profile shot, set it on Ana yourself from Settings before you
start. Use a picture you own.

---

## 2. Set up the simulator

Boot the 6.9" device, which is the size Apple requires:

    xcrun simctl list devices | grep "16 Pro Max"
    xcrun simctl boot "iPhone 16 Pro Max"

Then, before you shoot anything, clean up the status bar and force light mode.
A real 41%-battery, 2-bar status bar is the difference between a screenshot that
looks made and one that looks caught:

    xcrun simctl ui booted appearance light
    xcrun simctl status_bar booted override \
      --time "19:41" --batteryLevel 100 --batteryState charged \
      --cellularMode active --cellularBars 4 --wifiMode active --wifiBars 3

19:41 is chosen to match the sessions — they start at 19:00, so a mid-round shot
at twenty to eight is consistent with itself.

Run the app onto that simulator:

    npm run ios:staging

and pick **iPhone 16 Pro Max** as the run destination in Xcode.

Capture each shot from the terminal rather than ⌘S, so they are named as you go
and land somewhere you can find them:

    mkdir -p ~/Desktop/padelier-shots/6.9
    xcrun simctl io booted screenshot ~/Desktop/padelier-shots/6.9/01-live.png

The file comes out 1320 × 2868, which is exactly what App Store Connect wants.
No resizing, no cropping.

---

## 3. The six shots

Shoot them in the order below, which is not the order they appear in the store.
The reason is shot 4: the RSVP card only looks like that until somebody starts
the session, so photograph it while it is still waiting.

### Shot 5 — a player profile · `05-profile.png`

Sign in as Ana. Go to her own profile, or open **Sari Wijaya** from the club
member list — a profile you are looking *at* reads better than your own.

On screen: the rating (1655), games played, the trend graph running across five
weeks, the win-loss record, Kemang Padel Club, and the bio if there is one.

Caption: **A rating that means something**

### Shot 4 — next Tuesday's RSVP card · `04-rsvp.png`

Clubs → Kemang Padel Club → the **Tuesday Night** card for next Tuesday.

On screen: date and time, Kemang Padel Court 1–3, IDR 120k, and the going list
showing **10 / 12 in** with two more on the waiting list. Scroll so that both the
count and at least six names are in frame — the point of the shot is that you can
see who is coming before you commit.

Caption: **See who's in before you book**

### Shot 3 — the format picker · `03-formats.png`

Play → Start a session → the format step. Do not create anything yet; this is
the list itself.

On screen: the six formats the picker offers — Americano, Mexicano, Mix
Americano, Fixed Position, Mix Mexicano, Team Sparring — with the Next button
below, so the list is visibly complete. Scroll fully to the top first: the
header slides under the Dynamic Island otherwise.

The seventh format, Fixed Partner, is started from the Formats page rather than
this picker, which is why the caption no longer counts them. Breadth is still
the argument of the image; the number just should not be a claim the picture
contradicts.

Caption: **Pick a format, it does the rest**

### Now create the live session

Back out and start it properly, because shots 1, 2 and 6 are three moments in one
session and have to agree with each other.

1. Play → Start a session.
2. Format: **Mix Americano**. Scoring: **first to 21**. Ranking: **points first**.
3. Courts: **3**.
4. Club: **Kemang Padel Club**, so it counts for the league.
5. Add these twelve, with the genders — Mix needs them:

       Ana Prameswari      F
       Bagas Nugroho       M
       Sari Wijaya         F
       Rizky Pratama       M
       Nadia Kusuma        F
       Fajar Ramadhan      M
       Putri Handayani     F
       Andhika Surya       M
       Maya Lestari        F
       Reza Mahendra       M
       Dewi Anggraini      F
       Yoga Saputra        M

   Six and six, so every court is a proper mixed pair and no one sits out.

6. Start. Score **round 1 and round 2 in full** — nine matches, any plausible
   scores that add to 21: 13–8, 11–10, 15–6, 12–9. Do not make them all
   lopsided, and do not make them all the same.
7. Generate round 3.

Two full rounds is the minimum that makes the leaderboard look earned. One round
and everybody is on 1–0.

### Shot 1 — a live session mid-round · `01-live.png`

The round 3 screen, three courts, names on both sides of each.

Score Court 1 and Court 2. Leave **Court 3 unscored**, with the score entry open
on it if that fits in frame. That contrast — two done, one in play — is what says
this is a live thing rather than a table of results.

This is the first image in the store and the one most people will ever see, so
take it three or four times and keep the best.

Caption: **Every round, worked out for you**

### Shot 2 — the leaderboard · `02-board.png`

Same session, the standings tab.

On screen: twelve rows in order, points and record, with the top six clearly
readable. If there is a rating column, have it showing.

Caption: **The board sorts itself**

### Shot 6 — the final summary · `06-podium.png`

Score the rest of round 3, generate and score rounds 4, 5 and 6, then end the
session.

Faster and just as honest: score whatever you like and end it early — the
summary screen does not care how many rounds it took.

On screen: the podium, first through third with their names, and the rest of the
field beneath.

Caption: **Somebody has to win**

---

## 4. The 6.5" set

Apple accepts a 6.9" set on its own and scales it. Supplying 6.5" as well looks
better on older devices and costs one more pass:

    xcrun simctl boot "iPhone 11 Pro Max"

Same status bar override, same six shots, into `~/Desktop/padelier-shots/6.5/`.
That device shoots 1242 × 2688 natively.

The seeded data is still there, and the live session you created is still there
too — so shots 2, 4, 5 and 6 can be retaken straight away. Only shot 1 needs a
live round again.

---

## 5. Captions

Burn the caption into the image above the screenshot rather than using App Store
Connect's caption field, which most people never see. Graphite text on ivory,
Fraunces, matching the app.

    1. Every round, worked out for you
    2. The board sorts itself
    3. Seven formats, one app
    4. See who's in before you book
    5. A rating that means something
    6. Somebody has to win

Six words or fewer each. The first two or three are what appear in search
results, so the argument has to be made by then.

---

## 6. Afterwards

**The demo account Apple's reviewer gets is a separate problem.** The build they
download points at **production**, not padelier-v2, so a `@demo.padelier.id`
account does not exist for them. Two ways round it, decided before submission:

- Run this same seed against production shortly before submitting, and remove it
  after approval — one delete, since everything is keyed on `dddd`. The reviewer
  gets a full account and no real member is exposed. The cost is that a fake club
  is briefly findable by real users.
- Or give them a real account you control. Simpler, but the reviewer sees real
  members' names.

Whichever you choose, fill it into the DEMO ACCOUNT block in
`docs/STORE_LISTING.md` before you submit. It is currently a placeholder.

**Removing the demo data from staging**, when you no longer want it: run the
delete block at the top of `supabase/seed/seed_demo.sql` on its own. It removes
every `dddd` row and nothing else.
