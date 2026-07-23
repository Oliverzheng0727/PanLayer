# Task 8 Hardening Report

## Scope completed

- Added protected full, failed-only, and individual-section regeneration paths. Failed-only retries calculate failed or absent module keys from the versioned persisted module state and report a successful no-op when none need work.
- Added compact, typed prior-review and ETF mapping context to mapping/risk provider prompts. The prompts constrain mainline, hotspot, leader, and ETF mapping claims to that context and require their ranking basis.
- Added snapshot narrative-number validation: only instrument-associated value phrases are compared, preserving unrelated dates, times, and counts.
- Replaced standalone section payloads with a versioned `{ version, section, sources }` envelope. Reads reject legacy or malformed payloads and return reconstructable generated-section results; targeted and failed-only assembly now reads modules directly rather than trusting the aggregate row.
- Added atomic, expiring D1 morning-brief leases with opaque tokens and matching-token release. An overlapping attempt returns `morning-brief already running` before provider, section, or aggregate writes.
- Added the `job_leases` Drizzle schema and inspected generated migration `drizzle/0005_shiny_archangel.sql`; it creates only the five lease columns and composite `(job, trade_date)` primary key.
- Updated the admin-only UI with failed-only and per-card retries. Sources with no verified publication timestamp display `发布时间未公开` plus Beijing retrieval time.

## Verification

| Command | Result |
| --- | --- |
| Focused morning-brief/admin/UI/persistence/runner suite | Passed: 9 files, 60 tests. |
| `npm test` | Passed: 37 files, 161 tests; 1 skipped (162 total). |
| `npm run lint` | Passed with no warnings or errors. |
| `npm run build` | Passed. |
| `npm run test:render` | Passed: 7 render tests. |
| `git diff --check` | Passed. |

Build output retained the existing proxy-environment notice, client chunk-size warning, and dynamic-route classification notice; the build completed successfully.

## Review

Self-review confirmed that all admin mutations remain behind the existing server-side authorization gate, public reads remain unchanged, no provider key enters prompts, and no unpublished timestamp is fabricated.
