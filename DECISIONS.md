# Decisions

Architecture and process choices, with the reasons for them. Add new entries at the bottom. Don't rewrite old entries: if a decision changes, add a new entry that supersedes it.

## D1: Line endings and byte-exact test inputs (2026-10-06)
**Decision:** Set `* text=auto eol=lf` in `.gitattributes`, and mark `corpus/**` and `test/fixtures/**` as `-text`.
**Why:** The round-trip tests are byte-exact. On Windows, git's line-ending conversion could silently rewrite test inputs, which would cause false failures or hide real ones. Real-world TikZ files sometimes use CRLF line endings, and preserving those must be tested too.

## D2: Default branch is `trunk` (2026-10-06)
**Decision:** The repo uses `trunk`, inherited from the local git config. It was the first branch pushed to GitHub.
**Why:** Recorded so that future sessions push to the right branch.
