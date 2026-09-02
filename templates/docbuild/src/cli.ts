#!/usr/bin/env node
import { relative } from "node:path";
import { build, BuildError, check, repoRoot, USAGE } from "./index.js";

const args = process.argv.slice(2);

if (args.length !== 1 || args[0] === "-h" || args[0] === "--help") {
  process.stdout.write(USAGE);
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
