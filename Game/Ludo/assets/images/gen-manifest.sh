#!/usr/bin/env bash
# Regenerate the capture-image manifest.
# Run this whenever you add or remove images in this folder.
#   ./gen-manifest.sh
cd "$(dirname "$0")" || exit 1

# Collect all image files (jpg/jpeg/png/gif/webp/bmp), case-insensitive.
files=$(ls -1 2>/dev/null | grep -iE '\.(jpe?g|png|gif|webp|bmp)$' | sort)

{
  echo "["
  first=1
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if [ $first -eq 1 ]; then first=0; else echo ","; fi
    printf '  "%s"' "$f"
  done <<< "$files"
  echo ""
  echo "]"
} > manifest.json

count=$(printf '%s\n' "$files" | grep -c . )
echo "Wrote manifest.json with $count image(s)."
