#!/usr/bin/env bash
# Measures the page lengths LaTeX gives for each "class|options" line of cases.txt,
# by compiling a document that prints them. Runs in the pinned TL2026 image (CI only).
# Writes one JSON object per line to $1 (default page-widths.jsonl) and a table to stdout.
#
# Each length goes on its own \typeout line: TeX wraps log lines at 79 characters.
# Two moments are measured: right after \begin{document}, and (for the classes whose
# first page is set up by \maketitle, such as acmart's two-column formats) after a title.
set -u
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-page-widths.jsonl}
: > "$out"
work=$(mktemp -d)

probe() { # $1 = tag
  for k in textwidth columnwidth linewidth columnsep paperwidth; do
    printf '\\typeout{%s %s=\\the\\%s}\n' "$1" "$k" "$k"
  done
}

# Prints a length from a probe log: get <log> <tag> <key>
get() { sed -n "s/^$2 $3=\\([0-9.-]*\\)pt.*/\\1/p" "$1" | head -n 1; }

while IFS='|' read -r cls opts; do
  case "$cls" in ''|\#*) continue ;; esac
  dir="$work/$(echo "$cls-$opts" | tr -c 'A-Za-z0-9\n' '_')"
  mkdir -p "$dir"
  { if [ -n "$opts" ]; then printf '\\documentclass[%s]{%s}\n' "$opts" "$cls"; else printf '\\documentclass{%s}\n' "$cls"; fi
    printf '\\begin{document}\n'; probe TFA; printf '\\end{document}\n'; } > "$dir/a.tex"
  (cd "$dir" && timeout 120 pdflatex -interaction=batchmode -halt-on-error a.tex > /dev/null 2>&1)

  title=""
  case "$cls" in
    acmart) title='\\title{T}\\author{A}\\affiliation{\\institution{I}\\country{C}}\\maketitle' ;;
    revtex4-2) title='\\title{T}\\author{A}\\affiliation{I}\\maketitle' ;;
    IEEEtran) title='\\title{T}\\author{A}\\maketitle' ;;
    llncs) title='\\title{T}\\author{A}\\institute{I}\\maketitle' ;;
  esac
  after=""
  if [ -n "$title" ]; then
    { if [ -n "$opts" ]; then printf '\\documentclass[%s]{%s}\n' "$opts" "$cls"; else printf '\\documentclass{%s}\n' "$cls"; fi
      printf '\\begin{document}\n'; printf "$title\n"; probe TFB; printf '\\end{document}\n'; } > "$dir/b.tex"
    (cd "$dir" && timeout 120 pdflatex -interaction=nonstopmode b.tex > /dev/null 2>&1)
  fi

  if ! grep -q '^TFA textwidth' "$dir/a.log" 2>/dev/null; then
    printf '{"class":"%s","options":"%s","ok":false}\n' "$cls" "$opts" >> "$out"
    printf '%-10s %-28s FAILED\n' "$cls" "$opts"
    continue
  fi
  tw=$(get "$dir/a.log" TFA textwidth); cw=$(get "$dir/a.log" TFA columnwidth); lw=$(get "$dir/a.log" TFA linewidth)
  cs=$(get "$dir/a.log" TFA columnsep); pw=$(get "$dir/a.log" TFA paperwidth)
  extra=""
  btw=""; bcw=""; bcs=""
  if [ -n "$title" ] && grep -q '^TFB textwidth' "$dir/b.log" 2>/dev/null; then
    btw=$(get "$dir/b.log" TFB textwidth); bcw=$(get "$dir/b.log" TFB columnwidth); bcs=$(get "$dir/b.log" TFB columnsep)
    extra=",\"titleTextwidth\":$btw,\"titleColumnwidth\":$bcw,\"titleColumnsep\":$bcs"
  fi
  printf '{"class":"%s","options":"%s","ok":true,"textwidth":%s,"columnwidth":%s,"linewidth":%s,"columnsep":%s,"paperwidth":%s%s}\n' "$cls" "$opts" "$tw" "$cw" "$lw" "$cs" "$pw" "$extra" >> "$out"
  printf '%-10s %-34s text %-9s col %-9s sep %-6s paper %-8s | after title: text %-9s col %-9s sep %s\n' "$cls" "$opts" "$tw" "$cw" "$cs" "$pw" "$btw" "$bcw" "$bcs"
done < "$here/cases.txt"

for c in article elsarticle IEEEtran revtex4-2 acmart llncs amsart; do
  f=$(kpsewhich "$c.cls")
  echo "$c: $f $(grep -h -m1 -o 'ProvidesClass *{[^}]*} *\[[^]]*\]' "$f" 2>/dev/null)"
done
