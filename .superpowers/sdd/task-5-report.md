# Task 5 Report — Production No-Demo Briefs and Targeted Regeneration

Status: complete

Implemented behavior:

- `GET /api/v1/brief/:date` returns the persisted V2 brief or `null`, with an explicit `unavailable` status and `demo: false`.
- Production dashboards never substitute a demo brief. When no brief is persisted, they render “当天早参尚未生成” with an unavailable data state.
- The demo fixture is now a V2, local-development-only fixture without placeholder sources.
- The admin job endpoint accepts `section=<BriefSectionKey>` only for `morning-brief`, validates it against `BRIEF_SECTION_DEFINITIONS`, and returns HTTP 400 for invalid values.
- `runPanLayerJob` forwards optional `sectionKeys` to the V2 morning brief generator.
- `isAdminUser` centralizes the server-side admin check, and the dashboard receives the resulting `canManageBrief` flag.
- The existing dashboard reader can safely receive nullable/V2 briefs until the richer V2 reader lands in Task 6.

TDD evidence:

- RED: `npx vitest run tests/brief-route.test.ts tests/admin-route.test.ts && npm run test:render` initially failed because the brief API imported `demoBrief` and the admin route had no section validation.
- GREEN: `npx vitest run tests/brief-route.test.ts tests/admin-route.test.ts && npm run test:render` passed after implementation.

Verification:

- `npm test` — 35 files passed; 148 tests passed, 1 skipped.
- `npm run lint` — passed.
- `npm run test:render` — passed (production build plus 7 render tests).
- `git diff --check` — passed.
