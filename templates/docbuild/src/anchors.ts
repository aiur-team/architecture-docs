/**
 * Node-facing anchoring pass. A no-op until P1-D lands the scanner, the
 * normaliser, alignment and the report; the call site in `index.ts` is frozen
 * now so no later ticket has to reopen the builder to add its integration.
 */
import type { Section } from "./index.js";

export function anchorSections(
  inst: string,
  sections: Section[],
): { report: string[]; orphans: Array<[string, string]> } {
  void inst;
  void sections;
  return { report: [], orphans: [] };
}
