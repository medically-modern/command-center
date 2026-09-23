# Reference only — NOT part of the app

Brandon Ellis's *Command Center Redesign* handoff, kept here so the build can be
**diffed against the spec** instead of against somebody's memory of it.

Nothing in this folder is imported, built, served or deployed. It is not
documentation of what we built — it is the SOURCE MATERIAL we were asked to
build to. If the two disagree, this folder is right and the app is wrong, or
somebody made a decision that should be recorded in CLAUDE.md with a reason.

| file | what it is |
|---|---|
| `HANDOFF_Command_Center_Redesign.txt` | the handoff doc, doc rev 34, 2026-09-18, extracted verbatim from the .docx |
| `command-center-mockup.html` | the **sample-data** build of the mockup — fake patients, safe to open anywhere. ⚠️ It **predates** the "Communications v2 — Unresolved queue" (2026-09-22), which exists only in Brandon's REAL-DATA **rev 2** file (also PHI, also not here). Its spec is quoted in `/COMMS_INBOX_PLAN.md` §1 |

## ⚠️ The REAL-DATA mockup is deliberately absent

Brandon's second build (`command-center-mockup-REAL-DATA.html`, ~7.7 MB) embeds a
Monday snapshot of **3,168 patients and 1,523 orders** — real PHI. It is not in
this repo and must not be added to it:

- CLAUDE.md §9: patient data never goes in logs, artifacts or commits.
- This repo force-pushes to the prod repo (§8), so anything committed here lands
  there too.

Open it from Brandon's own folder when it is needed.

## Updating

If Brandon issues a new revision, **replace these files wholesale** and re-diff.
Do not edit them to match what we shipped — the whole value of the folder is
that it says what was asked for.
