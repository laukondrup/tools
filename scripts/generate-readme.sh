#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mapfile -t tools < <(find . -maxdepth 1 -type f -name "*.html" -print | sed 's|^\./||' | grep -v '^index\.html$' | sort)

{
  echo "# Tools"
  echo
  echo "Generated tool index for GitHub Pages start page."
  echo

  if [ ${#tools[@]} -eq 0 ]; then
    echo "_No tools found._"
  else
    for file in "${tools[@]}"; do
      title="$(sed -n 's|.*<title>\(.*\)</title>.*|\1|p' "$file" | head -n1)"
      if [ -z "$title" ]; then
        title="${file%.html}"
      fi
      printf -- "- [%s](%s) (\`%s\`)\n" "$title" "$file" "$file"
    done
  fi
} > README.md
