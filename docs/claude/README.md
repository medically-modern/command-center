# docs/claude — the Command Center's detailed notes

These files are the detailed half of the root [`CLAUDE.md`](../../CLAUDE.md). Until 2026-09-25 they
were all inside that one file, which Claude Code loads into every session. They were moved here
word for word, one file per section, so a session only reads the sections it needs.

- **One file per section, named by its section number:** `5.31d-phone-slots-and-caregiver.md` is §5.31d.
  Code comments and other docs that cite "CLAUDE.md §N" mean the file starting with `N-`.
- **The index** (every section, grouped by area) is under §5 in the root `CLAUDE.md`.
- **Adding a section:** create `<number>-<slug>.md` here and add one line to that index. Put a
  rule in `CLAUDE.md` itself only if it applies everywhere.
- **Never `@`-import these files from `CLAUDE.md`:** an import is loaded into every session.
