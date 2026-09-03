#!/usr/bin/env node
import { relative } from "node:path";
import { build, BuildError, check, repoRoot, USAGE } from "./index.js";
import { buildSite } from "./site.js";

const args = process.argv.slice(2);

// The site mode is documented here rather than in index.ts's shared USAGE:
// index.ts is owned by the shared builder, and this file owns the --site
// dispatch and its help integration. The one synopsis lists <instance> first
// so the single-document command stays the headline, then the --site form.
const SITE_SYNOPSIS = "    docbuild <instance>\n    docbuild --site\n";
const HELP = `${USAGE.replace("    docbuild <instance>\n", SITE_SYNOPSIS)}
In site mode (docbuild --site), docbuild discovers every publishable document
in this repository, composes each one through the shared builder, and writes a
clean-URL Netlify site into _site/: hosted copies, a deterministic root index,
permanent /d/<id> and alias redirects, and a preview-only noindex header when
CONTEXT is not production.
`;

if (args.length === 1 && args[0] === "--site") {
  const root = repoRoot();
  try {
    const result = buildSite(root);
    console.log(`built ${result.documents.length} documents into ${relative(root, result.outDir)}/`);
    for (const doc of result.documents) console.log(`  /${doc.slug}/`);
  } catch (e) {
    if (e instanceof BuildError) {
      console.error(`error: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  process.exit(0);
}

if (args.length !== 1 || args[0] === "-h" || args[0] === "--help") {
  process.stdout.write(HELP);
  process.exit(args.length === 1 ? 0 : 2);
}

const root = repoRoot();
const instance = args[0]!.replace(/\/+$/, "");

try {
  const out = build(root, instance);
  console.log(`built ${relative(root, out) || out}`);
  const result = check(out);
  for (const line of result.lines) console.log(line);
  if (!result.ok) {
    console.error("error: unbalanced tags in the built document");
    process.exit(1);
  }
} catch (e) {
  if (e instanceof BuildError) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
