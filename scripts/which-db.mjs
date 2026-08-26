// Which Supabase project would a given command talk to?
//
// The one genuinely dangerous mistake available on this branch is pointing the
// app at the wrong database — production data edited by a half-built iOS build,
// or a "why is my club empty" panic caused by staging. This prints the answer
// for both commands so you can check in two seconds instead of reasoning about
// Vite's env-file precedence at 1am.
//
//   npm run whichdb
import { readFileSync, existsSync } from "node:fs";

const read = (f) => {
  if (!existsSync(f)) return {};
  return Object.fromEntries(
    readFileSync(f, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
};

// Vite loads these in order, later winning.
const chain = (mode) =>
  [".env", ".env.local", mode && `.env.${mode}`, mode && `.env.${mode}.local`].filter(Boolean);

const resolve = (mode) => {
  let url = null, from = null;
  for (const f of chain(mode)) {
    const v = read(f).VITE_SUPABASE_URL;
    if (v) { url = v; from = f; }
  }
  return { url, from };
};

const ref = (u) => (u ? (u.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? u) : "— not set —");

for (const [cmd, mode] of [["npm run dev / npm run build / npm run ios", null],
                           ["npm run dev:staging / build:staging / ios:staging", "staging"]]) {
  const { url, from } = resolve(mode);
  console.log(`\n  ${cmd}`);
  console.log(`    project : ${ref(url)}`);
  console.log(`    from    : ${from ?? "(nothing found)"}`);
}
console.log("\n  Production is the project your club uses. Anything else is staging.\n");
