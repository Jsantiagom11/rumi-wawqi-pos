# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic Versioning.

## [2.1.0] — 2026-08-26

### Added

- Pure Node.js shift-finalization domain engine for WSL and CI.
- Two-phase `prepare -> commit` close protocol with full pre-finalization snapshot.
- FNV-1a checksum for accidental backup corruption detection.
- Recovery validation for kind/version/schema/integrity and active-order protection.
- Accounting Lab snapshots generated from real closed-shift sales data.
- Deterministic educational reconciliation scenarios that separate real data from hypothetical variance.
- WSL CLI commands for audit, recovery validation, scenario generation and close simulation.
- `Makefile`, sample legacy fixture and WSL operations runbook.
- Expanded behavioral regression/rainy-day suite and CI on Node 20/22.

### Changed

- Monetary domain calculations use integer cents at critical boundaries.
- Finalization now rejects any state change after the backup was prepared, not only changes in ticket count or sales total.
- New shift IDs are guaranteed to differ from the finalized legacy shift even when migration and close share the same timestamp.

### Security / Safety

- Finalization refuses active tables, pending kitchen tickets, empty shifts, missing backups, foreign backups, stale backups and corrupted backups.
- Recovery is fail-closed and never overwrites active table orders unless the caller explicitly opts in.
- Browser `app/index.html` remains unchanged in this release so the current direct-file iPad deployment is not destabilized before UI integration.

## [2.0.0] — 2026-08-25

### Added

- Non-destructive shift backup snapshots.
- ISO timestamps for orders, kitchen tickets and closed sales.
- Schema versioning and migration for existing iPad data.
- Automated regression tests and continuous integration.

### Changed

- Renamed the misleading print action to **Close and release table**.

### Fixed

- Shift export no longer erases sales history.
