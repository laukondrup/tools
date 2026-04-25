#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mapfile -t tools < <(
  find . -mindepth 2 -maxdepth 2 -type f -name "index.html" \
    ! -path "./.*/index.html" \
    ! -path "./_site/*" \
    ! -path "./_*/index.html" \
    -print | sort
)

START_MARKER="<!-- tools-index:start -->"
END_MARKER="<!-- tools-index:end -->"
TMP_INDEX="$(mktemp)"
TMP_README="$(mktemp)"

{
  echo "$START_MARKER"
  if [ ${#tools[@]} -eq 0 ]; then
    echo "_No tools found._"
  else
    for file in "${tools[@]}"; do
      rel_path="${file#./}"
      tool_dir="$(dirname "$rel_path")"
      link_path="${tool_dir}/"
      title="$(sed -n 's|.*<title>\(.*\)</title>.*|\1|p' "$file" | head -n1)"
      if [ -z "$title" ]; then
        title="$(basename "$tool_dir")"
      fi
      printf -- "- [%s](%s) (\`%s\`)\n" "$title" "$link_path" "$rel_path"
    done
  fi
  echo "$END_MARKER"
} > "$TMP_INDEX"

if [ ! -f README.md ]; then
  cp "$TMP_INDEX" README.md
  exit 0
fi

if grep -q "$START_MARKER" README.md && grep -q "$END_MARKER" README.md; then
  awk -v start="$START_MARKER" -v end="$END_MARKER" -v block_file="$TMP_INDEX" '
    BEGIN {
      in_block = 0
      while ((getline line < block_file) > 0) {
        block = block line "\n"
      }
      close(block_file)
    }
    $0 == start {
      if (!replaced) {
        printf "%s", block
        replaced = 1
      }
      in_block = 1
      next
    }
    $0 == end {
      in_block = 0
      next
    }
    !in_block { print }
  ' README.md > "$TMP_README"
else
  cp README.md "$TMP_README"
  if [ -s "$TMP_README" ]; then
    echo >> "$TMP_README"
  fi
  echo "## Index" >> "$TMP_README"
  echo >> "$TMP_README"
  cat "$TMP_INDEX" >> "$TMP_README"
fi

mv "$TMP_README" README.md
rm -f "$TMP_INDEX"
