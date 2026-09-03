/**
 * Editable-block marking and the edit manifest. A no-op until P2-D lands the
 * policy and the manifest; the call site in `index.ts` is frozen now.
 */
import type { Doc, Section } from "./index.js";

export type ManifestRow = Readonly<Record<string, never>>;

export function markEditable(
  sections: Section[],
  doc: Doc,
  inst: string,
): ManifestRow[] {
  void sections;
  void doc;
  void inst;
  return [];
}
