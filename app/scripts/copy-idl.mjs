/**
 * Copy the authoritative IDL into the bundle.
 *
 * Mirrors the private-counter example's `copy-idl`: the IDL that ships with the
 * app is always a copy of `target/idl/sinbazaar.json`, and the committed copy in
 * `src/idl/` is the fallback so the app still builds on a machine that has never
 * run `anchor build`.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "..", "..", "target", "idl", "sinbazaar.json");
const outDir = resolve(here, "..", "src", "idl");
const out = join(outDir, "sinbazaar.json");

mkdirSync(outDir, { recursive: true });

if (existsSync(source)) {
  copyFileSync(source, out);
  console.log(`[copy-idl] ${source} -> ${out}`);
} else if (existsSync(out)) {
  console.log(`[copy-idl] ${source} not found — using committed ${out}`);
} else {
  console.error(`[copy-idl] no IDL at ${source} and no committed copy at ${out}`);
  process.exit(1);
}
