/**
 * Document history and the generated changelog section. A no-op until P2-E
 * reads git and the committed `history.json`; the call sites in `index.ts` are
 * frozen now.
 *
 * The `BuildError` value import forms an ESM cycle with `index.ts`. That is
 * safe here because nothing reads the live binding during module
 * initialisation — only the guarded `changelogSection()` path touches it.
 */
import { BuildError } from "./index.js";
import type { Section } from "./index.js";

export type History = Readonly<Record<string, never>>;

export function refresh(inst: string): History | null {
  void inst;
  return null;
}

/** Return a Section that renderSection() can consume. */
export function changelogSection(
  h: History,
  labels: Array<[string, string]>,
): Section {
  void h;
  void labels;
  throw new BuildError("history hook is unavailable until P2-E");
}
