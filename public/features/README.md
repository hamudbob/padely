Feature logos live here, one per feature, named after the feature's slug:
americano.png, mexicano.png, clubs.png … The list of slugs is in
src/features/discover/featureContent.ts; the brief they were drawn from is in
docs/FEATURE_LOGOS.md.

All 21 are present. FeaturePoster tries <slug>.png first, then <slug>.svg, then
falls back to the vector poster drawn in FeaturePoster.tsx — so a missing or
broken file is never a blank card.

These files are processed, not raw exports. scripts/install_feature_logos.py
takes the originals, trims the exporter's uneven margins, scales each one to the
same bounding-box AREA (not the same height — that is what makes a wide mark and
a tall mark read as the same size), centres it on a 1120x700 canvas to match the
poster's 16:10 card, and quantises to 64 colours. On flat two-colour art that is
visually identical and about five times smaller: 507KB of originals became 169KB.

To replace one, drop the new original in and re-run the script rather than
saving over the PNG by hand, or that icon will sit at a different size from the
other twenty.
