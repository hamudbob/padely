# Feature logos — the list, and a prompt for each

21 features. Each one has a page at `/f/<slug>` and a card on `/features`.

## Where the files go

Save each as **`public/features/<slug>.svg`** (or `.png` — the code tries `.svg` first, then `.png`).
The slug is in the table below and must match exactly. Nothing else to do: `FeaturePoster` looks for
the file, uses it if it's there, and falls back to the drawn poster if it isn't. So you can do these
one at a time and see each appear as you go.

## What they have to survive

- **Size — corrected.** An earlier version of this brief said 64px. That was wrong: measured in the
  app, the art box is about **250 x 154px** on both the feature page and the index card. So you have
  room. A 2-3px court line at 1024px survives fine, and fine interior detail is affordable. Don't
  over-thicken strokes on the assumption they'll be tiny.
- **A warm background.** They sit on the ivory→gold gradient poster, not on white. Transparent
  background, and avoid pure white as a fill because it will look like a hole.
- **Being a set.** Consistency matters more than any individual icon being clever. Same stroke
  weight, same corner rounding, same visual density across all 21 — which is why the style sentence
  below is identical in every prompt and should be pasted verbatim.

## The palette, exactly

```
charcoal   #0D0D0D   the main mark
warm gold  #BFA36A   the accent — one element per icon, never the whole thing
gold ink   #836529   a darker gold if you need a second tone
ivory      #F7F5F2   the background they'll sit on (don't paint it)
```

## The style sentence — paste this at the start of every prompt

> Flat vector icon, minimal geometric line-and-solid style, single centred subject, charcoal #0D0D0D
> with exactly one accent element in warm gold #BFA36A, consistent 6px stroke weight at 1024px,
> rounded line caps, generous padding around the subject, transparent background, no text, no
> letters, no numbers, no gradients, no shadows, no 3D, flat like a premium sports-club wordmark
> mark, 1024×1024 square.

Then add the subject line for the feature. Full prompt = **style sentence + subject line**.

Two warnings from experience with image models: they render text badly, so every prompt says "no
text" and none of these icons rely on a letter or number to make sense. And they drift toward
adding scenery — if one comes back with a background, add "isolated on transparent background,
nothing else in frame".

---

## Ways to play — 7

| # | slug | Feature |
|---|---|---|
| 1 | `americano` | Americano |
| 2 | `mexicano` | Mexicano |
| 3 | `mix-americano` | Mix Americano |
| 4 | `mix-mexicano` | Mix Mexicano |
| 5 | `fixed-position` | Fixed Position |
| 6 | `fixed-partner` | Fixed Partner |
| 7 | `team-sparring` | Team Sparring |

**1. `americano`** — everyone partners everyone; partners rotate every round.
> Subject: a padel court seen from above as a simple rounded rectangle divided by a centre net line,
> with four dots at the four playing positions and two curved arrows showing the dots swapping
> places across the net, one arrow in warm gold.

**2. `mexicano`** — the standings decide the next pairing.
> Subject: a padel court from above with four dots, the topmost dot in warm gold and slightly
> larger, and a small ascending three-step bar shape beside the court indicating a ranking, the
> whole thing reading as "the table decides who plays whom".

**3. `mix-americano`** — every team is one man and one woman, partners rotate.
> Subject: a padel court from above with four dots arranged as two mixed pairs, each pair joined by
> a short connecting line, one dot of each pair in warm gold and the other in charcoal so every pair
> visibly contains one of each, plus one curved rotation arrow.

**4. `mix-mexicano`** — mixed teams *and* rank-based pairing.
> Subject: a padel court from above with two mixed pairs, one dot of each pair in warm gold, and a
> small ascending three-step bar shape in the corner indicating ranking — combining a mixed pairing
> with a standings symbol.

**5. `fixed-position`** — every team is one left-side player and one right-side player.
> Subject: a padel court from above with a dashed centre line running the length of the court
> dividing left from right, one dot on each side of that line on both halves of the court, the
> right-hand dots in warm gold, emphasising that each pair has one player per side.

**6. `fixed-partner`** — you and your partner stay together all night.
> Subject: two dots joined by a short thick bracket or link shape, mirrored by a second linked pair
> on the other side of a centre net line, one pair in warm gold — the icon should read as "these two
> are locked together".

**7. `team-sparring`** — two fixed teams, A against B.
> Subject: two solid rounded blocks facing each other across a vertical net line, the left block
> charcoal and the right block warm gold, each block containing two small dots for its players — a
> team-versus-team shape.

## How scoring works — 2

| # | slug | Feature |
|---|---|---|
| 8 | `scoring-formats` | Scoring formats (Fixed 21, Fixed 4/5 games, Race to 4/6) |
| 9 | `ranking-basis` | Ranking basis and rest compensation |

**8. `scoring-formats`** — how a match is counted.
> Subject: a concentric target of three rings with a solid warm gold centre, beside a simple
> upright scoreboard shape with two blank rows — reading as "how the points are counted", with no
> numbers anywhere.

**9. `ranking-basis`** — points first or wins first, and resting never costs you.
> Subject: a balance scale with two pans level, one pan holding a small solid circle and the other a
> small solid square, the beam in warm gold — fairness and equivalence, nothing text-based.

## For a group — 4

| # | slug | Feature |
|---|---|---|
| 10 | `clubs` | Clubs |
| 11 | `league` | League table |
| 12 | `champions` | Champions Hall |
| 13 | `club-events` | Scheduled sessions |

**10. `clubs`** — the people you play with regularly.
> Subject: a shield-shaped club crest outline containing three overlapping dots representing
> members, the centre dot in warm gold, clean and symmetrical like a sports-club badge.

**11. `league`** — the table for the period.
> Subject: four stacked horizontal bars of decreasing length like table rows, the top bar solid warm
> gold and the rest charcoal outlines, reading unmistakably as a standings table.

**12. `champions`** — everyone who has ever finished first.
> Subject: a simple trophy cup with a wide bowl, short stem and rectangular base, the bowl filled
> warm gold and the stem and base charcoal, no ribbons or stars.

**13. `club-events`** — the next session, on a page rather than in a chat.
> Subject: a calendar square with a horizontal header bar and a three-by-two grid of dots inside,
> one dot solid warm gold to mark the chosen date.

## Your game — 3

| # | slug | Feature |
|---|---|---|
| 14 | `rating` | Your rating |
| 15 | `record` | Your record |
| 16 | `public-profile` | Public profile |

**14. `rating`** — one number that follows you across sessions.
> Subject: a three-quarter circular arc like a dial or gauge, the first two thirds of the arc in warm
> gold and the remainder charcoal, with a solid dot marking the current position on the arc — empty
> in the middle, no numbers.

**15. `record`** — wins, losses and form over time.
> Subject: an ascending line chart of five points across a simple baseline, the line in warm gold
> with charcoal dots at each point, clean and sparse.

**16. `public-profile`** — the page other players see.
> Subject: a single centred person silhouette — circular head above a rounded shoulder shape —
> inside a thin circular frame, the frame in warm gold and the figure charcoal.

## Playing together — 5

| # | slug | Feature |
|---|---|---|
| 17 | `join-by-code` | Join by code |
| 18 | `watch-live` | Watch live |
| 19 | `claim-spot` | Claim your spot |
| 20 | `offline` | Playing without signal |
| 21 | `hosting-tools` | Hosting a session |

**17. `join-by-code`** — six characters gets you in.
> Subject: three rounded squares in a row like empty code-entry boxes, the middle one filled warm
> gold, with a small downward arrow entering the first box — no characters inside the boxes.

**18. `watch-live`** — follow the scores without playing.
> Subject: a rounded rectangle screen containing three horizontal bars of different lengths, the
> middle bar warm gold, with a small solid dot in the top-left corner of the screen suggesting a
> live indicator.

**19. `claim-spot`** — attach your account to a name already on the roster.
> Subject: a single dot inside a dashed circular outline, with a solid warm gold check mark
> overlapping its lower right — an empty place being taken.

**20. `offline`** — scores are safe with no signal.
> Subject: a simple cloud outline in charcoal with a diagonal slash through it in warm gold, and
> below it a small solid rounded bar suggesting a saved record held safely on the device.

**21. `hosting-tools`** — add a latecomer, swap players, redraw a round.
> Subject: three horizontal slider tracks stacked vertically, each with a round handle at a
> different position along it, the middle handle in warm gold — a control panel reduced to its
> simplest form.

---

## What the first one taught us

The Americano mark came back with a heavy rounded-square frame around it, four dots and two arrows.
It works, and it's the reference for the rest. Two notes from seeing it at real size:

- **A heavy outer frame makes the icon read as an app icon rather than a diagram**, and it sits
  inside the poster card's own rounded border — a box inside a box. Either drop the frame and let
  the mark breathe on the gradient, or keep it on ALL 21 so the set is deliberate. Don't mix.
- **Keep the accent to one colour.** Two arrows in two different colours read as two separate marks;
  the same gold at full and ~45% opacity reads as one movement with a direction.

## When you have them

Drop them in `public/features/` and they'll show up. If one looks wrong at card size, that's the
size to judge it at — open `/features` on your phone rather than looking at the 1024px file.

If you'd rather I match a logo you already like, send me one and I'll rewrite the other twenty
prompts to sit beside it.
