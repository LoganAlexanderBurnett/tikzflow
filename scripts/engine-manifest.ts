// Downloads for the Milestone 0 engine evaluation. Licenses for CTAN packages
// were checked against their tlpobj metadata. Sizes are what the source
// reported when this list was written (2026-10-07); the fetch script records
// the actual size and SHA-256 of each download in vendor/LOCK.json.

export type Extract = "none" | "tgz" | "tar.xz" | "zip";

export interface Download {
  /** Folder under vendor/ that the file is saved or extracted into. */
  group: "tikzjax" | "busytex" | "swiftlatex" | "texmf";
  url: string;
  /** Approximate size as listed by the source, in MB. */
  approxMB: number;
  extract: Extract;
  license: string;
}

const BUSYTEX =
  "https://github.com/busytex/busytex/releases/download/build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993_7936974349_1";

// TeX Live packages from CTAN's tlnet. Each archive holds a texmf-dist subtree.
const CTAN = "https://mirrors.ctan.org/systems/texlive/tlnet/archive";
const ctan = (pkg: string, approxMB: number, license: string): Download => ({
  group: "texmf",
  url: `${CTAN}/${pkg}.tar.xz`,
  approxMB,
  extract: "tar.xz",
  license,
});

export const DOWNLOADS: Download[] = [
  {
    group: "tikzjax",
    url: "https://registry.npmjs.org/@drgrice1/tikzjax/-/tikzjax-1.0.0-beta24.tgz",
    approxMB: 9, // 13.5 MB unpacked
    extract: "tgz",
    license: "GPL-3.0-or-later (fork); upstream kisonecat/tikzjax is LPPL-1.3c",
  },
  ...(
    [
      ["busytex.wasm", 28.96],
      ["busytex.js", 0.28],
      ["busytex_pipeline.js", 0.03],
      ["busytex_worker.js", 0.01],
      ["texmf.cnf", 0.04],
      ["texlive-basic.js", 1.97],
      ["texlive-basic.data", 99.73],
      ["versions.txt", 0.01],
    ] as const
  ).map(
    ([name, approxMB]): Download => ({
      group: "busytex",
      url: `${BUSYTEX}/${name}`,
      approxMB,
      extract: "none",
      license: "MIT (scripts); binaries carry TeX Live component licenses",
    }),
  ),
  {
    group: "swiftlatex",
    url: "https://github.com/SwiftLaTeX/SwiftLaTeX/releases/download/v20022022/20-02-2022.zip",
    approxMB: 2.25,
    extract: "zip",
    license: "AGPL-3.0",
  },
  ctan("pgf", 0.69, "LPPL-1.3c / GPL-2.0 / FDL (docs)"),
  ctan("standalone", 0.01, "LPPL-1.3"),
  ctan("xkeyval", 0.01, "LPPL-1.3"),
  ctan("latex", 0.25, "LPPL-1.3c"),
  ctan("l3kernel", 0.2, "LPPL-1.3c"), // now also ships the l3backend files
  ctan("amsmath", 0.03, "LPPL-1.3c"),
  ctan("lm", 11.39, "GUST Font License"),
  ctan("xcolor", 0.02, "LPPL-1.3c"),
  ctan("graphics", 0.02, "LPPL-1.3c"),
  ctan("graphics-def", 0.01, "LPPL-1.3c"),
  ctan("graphics-cfg", 0.01, "Public domain"),
  ctan("tools", 0.05, "LPPL-1.3c"),
  ctan("iftex", 0.01, "LPPL-1.3c"),
  ctan("etoolbox", 0.01, "LPPL-1.3c"),
  // Needed to build a LaTeX format from scratch (SwiftLaTeX ships none).
  ctan("latexconfig", 0.01, "TeX Live core; no catalogue license entry"),
  ctan("tex-ini-files", 0.01, "Public domain"),
  ctan("hyphen-base", 0.02, "TeX Live core; no catalogue license entry"),
  ctan("unicode-data", 0.31, "LPPL-1.3c + other-free"),
  ctan("cm", 0.23, "Knuth"),
  ctan("amsfonts", 3.46, "OFL-1.1"),
  ctan("firstaid", 0.01, "LPPL-1.3c"),
  ctan("etex", 0.01, "Knuth"),
  ctan("knuth-lib", 0.03, "Knuth"),
  ctan("babel", 0.24, "LPPL-1.3"),
  ctan("latex-fonts", 0.02, "LPPL-1.2"),
  // Runtime-package test for TikZJax (M0 follow-up).
  ctan("mathtools", 0.02, "LPPL-1.3c"),
  ctan("siunitx", 0.07, "LPPL-1.3c"),
  ctan("translations", 0.01, "LPPL-1.3c"),
  ctan("pdftexcmds", 0.01, "LPPL-1.3c"),
  ctan("infwarerr", 0.01, "LPPL-1.3"),
  ctan("ltxcmds", 0.01, "LPPL-1.3c"),
];
