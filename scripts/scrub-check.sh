#!/usr/bin/env bash
# Fail if any private context reached this repository.
#
#   scripts/scrub-check.sh            check tracked files
#   scripts/scrub-check.sh <path>...  check specific paths
#
# This repository is public. It grew out of a private one, and the documents it
# carries were written about real internal systems before being generalised.
# That history is the whole risk: prose survives a rename. This gate is the
# mechanical backstop, so nobody has to rely on having read carefully.
#
# Adding a term here is cheap. Removing one requires knowing why it was added.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Terms that must never appear. Case-insensitive, extended regex.
# Grouped only for legibility; every group is treated identically.
DENY=(
  # Organisations and their spellings
  'op[-_ ]?labs' 'oplabs' 'ethereum-optimism' 'optimism\.io' 'op[-_ ]enterprise'
  'op[-_ ]mainnet' 'op[-_ ]sepolia' 'superchain' 'op-reth'
  # Internal systems, repositories and document names
  'netchef' 'datadirs' 'ecosystem[-_ ]artifacts' 'compliance[-_ ]poc' 'op[-_ ]compliance'
  'op[-_ ]enterprise[-_ ]dashboard' 'snapshot[-_ ]feature[-_ ]analysis'
  # Named third parties from private research
  'chainalysis' 'lexisnexis' 'global relay' 'clearstream' 'dtcc' 'etherfi'
  'goldman' 'jp ?morgan' 'bitpanda' 'bit panda'
  # Identities
  'kevinw' 'kevin weaver' 'its-everdred' '@oplabs' 'sapsaldog'
  # Business context
  'revenue gap' 'sdn list' 'ofac'
)

# Terms that are usually fine but were sensitive in the source material.
# These warn rather than fail, because a generic use is legitimate.
WARN=(
  'compliance engine' 'sanction' 'attestation' 'actuator'
  'morpho' 'aave' 'ink (sepolia|mainnet|chain)'
)

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  # shellcheck disable=SC2207
  files=($(git ls-files))
fi

if [ "${#files[@]}" -eq 0 ]; then
  echo "scrub-check: no files to check" >&2
  exit 1
fi

status=0
hits=0

for term in "${DENY[@]}"; do
  # -I skips binary files. Exclude this script, which necessarily names them.
  out="$(grep -RIniE -- "$term" "${files[@]}" 2>/dev/null | grep -v 'scrub-check\.sh:' || true)"
  if [ -n "$out" ]; then
    echo "DENY  /$term/" >&2
    printf '%s\n' "$out" | sed 's/^/      /' | cut -c1-200 >&2
    status=1
    hits=$((hits + 1))
  fi
done

warned=0
for term in "${WARN[@]}"; do
  out="$(grep -RIniE -- "$term" "${files[@]}" 2>/dev/null | grep -v 'scrub-check\.sh:' || true)"
  if [ -n "$out" ]; then
    echo "WARN  /$term/ — confirm this use is generic, not the private original" >&2
    printf '%s\n' "$out" | sed 's/^/      /' | cut -c1-160 >&2
    warned=$((warned + 1))
  fi
done

echo
if [ "$status" -ne 0 ]; then
  echo "FAIL  $hits denied term(s) present. Nothing may be published until these are gone." >&2
  exit 1
fi

if [ "$warned" -gt 0 ]; then
  echo "PASS with $warned warning(s). No denied term is present."
else
  echo "PASS  no denied term and no warning."
fi
