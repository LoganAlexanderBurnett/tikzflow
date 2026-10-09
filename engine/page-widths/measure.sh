#!/usr/bin/env bash
# Measures the page lengths LaTeX gives for each "class|options" line of cases.txt,
# by compiling a document that prints them. Runs in the pinned TL2026 image (CI only).
# Writes one JSON object per line to $1 (default page-widths.jsonl) and a table to stdout.
set -u
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-page-widths.jsonl}
: > "$out"
work=$(mktemp -d)
while IFS='|' read -r cls opts; do
  case "$cls" in ''|\#*) continue ;; esac
  dir="$work/$(echo "$cls-$opts" | tr -c 'A-Za-z0-9\n' '_')"
  mkdir -p "$dir"
  {
    if [ -n "$opts" ]; then printf '\\documentclass[%s]{%s}\n' "$opts" "$cls"; else printf '\\documentclass{%s}\n' "$cls"; fi
    printf '\\begin{document}\n'
    printf '\\typeout{TFPROBE textwidth=\\the\\textwidth;columnwidth=\\the\\columnwidth;linewidth=\\the\\linewidth;columnsep=\\the\\columnsep;paperwidth=\\the\\paperwidth;}\n'
    printf '\\end{document}\n'
  } > "$dir/probe.tex"
  (cd "$dir" && timeout 120 pdflatex -interaction=batchmode -halt-on-error probe.tex > /dev/null 2>&1)
  line=$(grep -h 'TFPROBE' "$dir/probe.log" 2>/dev/null | head -n 1)
  file=$(kpsewhich "$cls.cls" 2>/dev/null || true)
  provides=$(grep -h -m1 -o 'ProvidesClass *{[^}]*} *\[[^]]*\]' "$file" 2>/dev/null || true)
  if [ -z "$line" ]; then
    printf '{"class":"%s","options":"%s","ok":false}\n' "$cls" "$opts" >> "$out"
    printf '%-10s %-28s FAILED\n' "$cls" "$opts"
    continue
  fi
  get() { echo "$line" | sed -n "s/.*$1=\\([0-9.-]*\\)pt.*/\\1/p"; }
  tw=$(get textwidth); cw=$(get columnwidth); lw=$(get linewidth); cs=$(get columnsep); pw=$(get paperwidth)
  printf '{"class":"%s","options":"%s","ok":true,"textwidth":%s,"columnwidth":%s,"linewidth":%s,"columnsep":%s,"paperwidth":%s}\n' "$cls" "$opts" "$tw" "$cw" "$lw" "$cs" "$pw" >> "$out"
  printf '%-10s %-28s text %-9s column %-9s sep %-6s paper %-9s %s\n' "$cls" "$opts" "$tw" "$cw" "$cs" "$pw" "$provides"
done < "$here/cases.txt"
for c in article elsarticle IEEEtran revtex4-2 acmart llncs amsart; do echo "$c: $(kpsewhich "$c.cls") $(grep -h -m1 -o 'ProvidesClass *{[^}]*} *\[[^]]*\]' "$(kpsewhich "$c.cls")" 2>/dev/null)"; done
