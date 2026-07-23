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
| `npm test` | Passed: 37 files, 169 tests; 1 skipped (170 total). |
| `npm run lint` | Passed with no warnings or errors. |
| `npm run build` | Passed. |
| `npm run test:render` | Passed: 7 render tests. |
| `git diff --check` | Passed. |

Build output retained the existing proxy-environment notice, client chunk-size warning, and dynamic-route classification notice; the build completed successfully.

## Review

Self-review confirmed that all admin mutations remain behind the existing server-side authorization gate, public reads remain unchanged, no provider key enters prompts, and no unpublished timestamp is fabricated.

## Review-closure follow-up

- Replaced the time-only lease with token-fenced, atomic `UPDATE ... RETURNING` renewal. The matching token must still be current and unexpired to extend the lease; guards run after provider waits and immediately before global, section, and aggregate writes.
- Added an overlap regression: an old run blocks in a provider call, a new token acquires after expiry and writes, and the resumed old run is rejected before it can overwrite the new section or aggregate row.
- Added `firstLimitTime` to compact leader ranking factors.
- Expanded snapshot checks to label variants and reverse phrasing, with decimal-place-aware rounding tolerance.
- Tightened admin query parsing to the three documented parameters, each at most once, and only `true`/`false` force values.

## Final review-closure follow-up

- Extended the explicit snapshot grammar to bounded punctuation and verb variants (`，报`, `指数收报`, `上涨至`) while retaining reverse-form and rounding checks.
- Moved all post-acquisition morning-job work, including `job_runs` creation, under the lease-release `finally`; absent run IDs now skip status writes safely.
- Added deterministic full `runPanLayerJob` overlap regressions for delayed global snapshots and delayed provider failure. They prove that a stale token cannot persist global rows, failed/success sections, or aggregates after a newer run acquires the lease.

## Numeric false-positive closure

- Removed the generic `label 为 number` branch. Snapshot number checks now require an explicit financial quote verb, so constituent/company counts and associated dates or times are not interpreted as prices.

## Provider-trust closure

- Added server-side market-context enforcement for mapping and risk narrative claims. Mainline/hotspot, leader, and ETF mapping assertions now require a matching reviewed sector, leader name/symbol, or ETF category/name/code, respectively, plus explicit ranking language and relevant ranking factors. Generic no-context disclosures remain permitted only when they state `上下文不可用` without inventing an entity.
- Replaced verb-specific snapshot validation with a sentence/segment integrity boundary. Every segment that names a snapshot label now validates its financial numeric tokens, while excluding the label's embedded number, dates/times, and unrelated quantities such as company or instrument counts. Percentages are checked only against `pctChange`; prices, points, and currency amounts are checked only against value or previous close using decimal-aware rounding tolerance.
- Added Qwen and OpenAI provider-path regressions for context-grounded and invented claims, ETF validation, no-context disclosure, rounded/reverse snapshot prose, `上涨`/`收盘` forms, and unrelated count/date/time text.

Latest verification: focused provider tests passed (17 tests); `npm test` passed (37 files, 172 passed, 1 skipped); lint, build, render tests (7), and `git diff --check` passed.
