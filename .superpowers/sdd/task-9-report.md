# Task 9 — Production generation recovery report

## Delivered

- Added per-attempt retry metadata to section generators and provider calls. Attempts two and three receive bounded, redacted feedback from the prior provider or validation failure.
- Strengthened provider instructions with a 1,200–1,400 character target, literal required-term checklist, structured-snapshot non-repetition, and server-owned ranking guidance.
- Allowed ordered `分别` multi-label snapshot prose only when every numeric token maps in order to its own server snapshot; mismatches, repeated-label cardinality errors, unavailable snapshot values, and ambiguous clauses still fail.
- Added actual narrative character counts to section-length validation errors. Persisted final failures now retain the bounded actionable reason.

## Regression coverage

- Retry feedback reaches attempts two and three; a later attempt can succeed.
- Retry feedback is bounded, API-key redacted, and labelled as diagnostic data before a later provider call.
- Ordered `分别` values pass only when every value matches its matching label; repeated ordinary single-label facts remain valid.
- Retry prompts include missing-term, length, and reserved-token feedback.
- Existing lease-fencing and three-attempt tests remain in the focused suite.

## Verification

- `npm test -- tests/morning-brief-runner.test.ts tests/morning-brief-providers.test.ts tests/morning-brief-contract.test.ts` — 47 passed.
- `npm test` — 180 passed, 1 skipped.
- `npm run lint` — passed.
- `npm run build` — passed (existing proxy/chunk-size warnings only).
- `npm run test:render` — 7 passed.
- `git diff --check` — passed.
- Independent review completed with no remaining blockers.
