/**
 * Regenerates docs/ERRORS.md from the catalogue in src/lib/errors.ts.
 *
 *     npx tsx scripts/gen_errors_doc.ts > docs/ERRORS.md
 *
 * The doc exists so you can look a code up without reading TypeScript; this
 * script exists so the doc can't quietly drift from the code it describes.
 * Group titles live here, the codes and their text live in the catalogue —
 * add a code there and it appears here on the next run.
 */
import { CATALOGUE } from "../src/lib/errors";

const GROUPS: Record<string, string> = {
  "1": "Account and sign-in",
  "2": "Your own data",
  "3": "A live session",
  "4": "Clubs and league",
  "5": "Joining and claiming",
  "6": "This device",
  "9": "The plumbing",
};

// Taken from the catalogue rather than hardcoded, so renaming the prefix in
// one place renames it everywhere.
const PREFIX = (Object.keys(CATALOGUE)[0] ?? "PLR-0000").split("-")[0];

let out = `# Error codes

Every failure the app can show carries a code. When someone quotes one, paste it into the admin
console's search box — it resolves straight to that error's group, with the stack, how many times it
has happened, and to whom.

**Curated codes** (\`${PREFIX}-1001\`, \`${PREFIX}-2002\`…) are the conditions listed below: a known meaning and a
known next step. **Automatic codes** (\`${PREFIX}-U-7F3A\`) cover everything not yet catalogued — derived
from the error itself, so the same failure produces the same code on every device forever. An
automatic code explains nothing on its own; it's a key, and that's enough to find the rest.

Form validation — "Enter both teams' scores" — deliberately gets no code. It isn't a failure, and a
reference number on it would be noise.

This file is generated: \`npx tsx scripts/gen_errors_doc.ts > docs/ERRORS.md\`. Edit the catalogue in
\`src/lib/errors.ts\`, not this file.

`;

for (const [digit, title] of Object.entries(GROUPS)) {
  const codes = Object.keys(CATALOGUE)
    .filter((c) => c.startsWith(`${PREFIX}-${digit}`))
    .sort();
  if (codes.length === 0) continue;
  out += `## ${digit}xxx · ${title}\n\n`;
  for (const code of codes) {
    const entry = CATALOGUE[code];
    out += `### ${code} — ${entry.title}\n\n${entry.meaning}\n\n**What to do:** ${entry.action}\n\n`;
  }
}

const missing = Object.keys(CATALOGUE).filter(
  (c) => !Object.keys(GROUPS).some((d) => c.startsWith(`${PREFIX}-${d}`)),
);
if (missing.length > 0) {
  // Loud rather than silent: a code in a group this script doesn't know about
  // would otherwise be dropped from the documentation without a word.
  out += `## Ungrouped\n\nThese codes have no group heading yet — add one to scripts/gen_errors_doc.ts:\n\n`;
  for (const code of missing) out += `- ${code} — ${CATALOGUE[code].title}\n`;
  out += `\n`;
}

out += `---\n\n_${Object.keys(CATALOGUE).length} curated codes._\n`;

process.stdout.write(out);
