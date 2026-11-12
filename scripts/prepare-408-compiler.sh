#!/usr/bin/env bash
set -euo pipefail

output=${1:?Specify the compiler asset directory}
upstream=https://raw.githubusercontent.com/binji/wasm-clang/648c4a89997a351eef75cdaec3ef5b89d4937dec
temp=$(mktemp -d)
trap 'rm -f -- "$temp/clang" "$temp/lld" "$temp/memfs" "$temp/sysroot.tar"; rmdir -- "$temp"' EXIT
mkdir -p -- "$output"

while read -r hash file; do
  curl --fail --silent --show-error --location --retry 3 --max-time 90 "$upstream/$file" -o "$temp/$file"
  (cd "$temp" && printf '%s  %s\n' "$hash" "$file" | sha256sum --check --status)
  gzip -n -6 -c -- "$temp/$file" > "$output/$file.gz"
done <<'ASSETS'
2a466f0e990329d3230b869d04fc20803eae96a7feb3a3f6c93e25a77b8aed1d clang
36419ed202011765222098d7701218378b67f634d50f0a4625059ae2c9860f48 lld
2c72ee42bd9430029dda8c6bafc9f37143f6fe88d5f1ea950a70259ab748bcfe memfs
2435a7b549af30c2be7ec249c405bc2e911ab0c6003012f0909ec3c131bff867 sysroot.tar
ASSETS
