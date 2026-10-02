# Runbook

### 10.3 RUNBOOK topics (R-1..R-10)
- R-1 "A number looks wrong": lineage popover → CSV → monday activity log for 2 items → T-REC. If it is a bulk edit, add `ignoreEventWindows`.
- R-2 "monday changed a column or label": update Appendix A config; DH-20 and DH-12 list the unknown indexes and groups.
- R-3 "Stale banner": check the gateway, monday status, and the console for 429 or complexity pauses; then Reset cache.
- R-4 "History missing": the cache key changed? Check `historyStart`, DH-21 retention, and the activity paging.
- R-5 "A new board joins the pipeline": recipe §10.6.
- R-6 "Add a person": recipe §10.6.
- R-7 "Change a threshold": edit config, set `confirmed: true` with a comment giving Brandon's confirmation date, and record it in DECISIONS.md.
- R-8 "Gateway endpoint down": tiles show Not connected; nothing else breaks.
- R-9 "CORS or sign-in error in local review": check ALLOWED_ORIGINS and the OAuth origins (§5.7), or use fixture mode.
- R-10 "Data health chip always on": review the DH rows and add a dated `dataHealthBaseline` entry only with Brandon's agreement.



## Prototype notes
- R-1: there is no per-number lineage popover yet (P-7); use metric IDs on tiles and docs/METRICS.md, the item drawer CSV, and the Reconcile panel.
- R-10: `dataHealthBaseline` is honoured: an accepted row shows "known, accepted <date>".
- R-11: "Numbers changed after an upgrade": check that schemaVersion was bumped when parsing or span rules changed; otherwise press Reset cache.
