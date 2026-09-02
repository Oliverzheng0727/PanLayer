# PanLayer Open-Source Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely organize `lihaozheng567-dot/PanLayer`, consolidate development onto `main`, publish the first MIT-licensed release, and make the GitHub repository public.

**Architecture:** Treat visibility as the final irreversible gate. First audit the entire Git history and dependency licenses, then add the open-source surface and CI, validate the exact commit, consolidate branches, create the release, and only then change repository visibility.

**Tech Stack:** Git, GitHub CLI, Node.js 22+, npm, TypeScript, Vitest, ESLint, Vinext, GitHub Actions, Gitleaks.

**Spec:** `docs/superpowers/specs/2026-09-02-panlayer-open-source-design.md`

## Global Constraints

- Use the MIT License with copyright holder `lihaozheng567-dot`.
- Keep `package.json` `private: true` so the package cannot be published to npm accidentally.
- Do not add, delete, or modify the user's untracked `.audit/`, `Vibe-Research/`, design notes, screenshots, or `tsconfig.tsbuildinfo`.
- Keep production secrets only in GitHub Secrets and Sites environment variables.
- Do not rewrite Git history unless the audit finds a confirmed secret or private-data leak.
- Do not make the repository public until every local and GitHub verification gate passes.
- Keep the production site at `https://panlayer.online`.

---

### Task 1: Public-release security and license gate

**Files:**
- Read: all tracked files and all Git history
- Read: `package-lock.json`
- Create: temporary scan artifacts under `/tmp` only

**Interfaces:**
- Consumes: current Git repository and installed dependencies
- Produces: a pass/fail decision for the public-release gate; no repository changes

- [ ] **Step 1: Confirm the repository identity, visibility, branch relationships, and clean tracked state**

Run:

```bash
git remote -v
git status --short --branch
gh repo view --json nameWithOwner,visibility,defaultBranchRef,url
for branch in origin/main origin/codex/panlayer origin/codex/tonghua origin/codex/full-morning-brief; do
  git merge-base --is-ancestor "$branch" HEAD
done
```

Expected: repository is `lihaozheng567-dot/PanLayer` and Private; each remote branch is an ancestor of `HEAD`; only the known local artifacts are untracked.

- [ ] **Step 2: Download Gitleaks to a temporary directory**

Run:

```bash
panlayer_audit_dir=$(mktemp -d /tmp/panlayer-open-source-audit-XXXXXX)
case "$(uname -m)" in
  arm64) panlayer_gitleaks_asset='*darwin_arm64.tar.gz' ;;
  x86_64) panlayer_gitleaks_asset='*darwin_x64.tar.gz' ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
gh release download --repo gitleaks/gitleaks --pattern "$panlayer_gitleaks_asset" --dir "$panlayer_audit_dir"
tar -xzf "$panlayer_audit_dir"/*.tar.gz -C "$panlayer_audit_dir"
"$panlayer_audit_dir/gitleaks" version
```

Expected: Gitleaks prints a version and nothing is written inside the repository.

- [ ] **Step 3: Scan the complete Git history with redacted output**

Run:

```bash
"$panlayer_audit_dir/gitleaks" git --redact --report-format json --report-path "$panlayer_audit_dir/gitleaks.json" .
jq 'length' "$panlayer_audit_dir/gitleaks.json"
```

Expected: exit 0 and finding count `0`. If findings exist, inspect only redacted metadata. Stop the public release for any confirmed secret; rotate the secret and design a history rewrite before continuing.

- [ ] **Step 4: Verify sensitive filenames and current tracked content**

Run:

```bash
git ls-files | rg '(^|/)(\.env($|\.)|.*secret.*|.*credential.*|.*\.pem$|.*\.key$)' || true
git grep -IlE '(AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)' -- ':!package-lock.json' || true
```

Expected: only `.env.example` may match the filename check; the content check returns no real credential file.

- [ ] **Step 5: Check production dependency licenses**

Run:

```bash
npx --yes license-checker --production --summary
npx --yes license-checker --production --failOn 'AGPL-1.0;AGPL-3.0;GPL-1.0;GPL-2.0;GPL-3.0;SSPL-1.0;BUSL-1.1'
```

Expected: both commands exit 0. If a dependency fails, stop and replace or explicitly resolve it before continuing.

### Task 2: Project identity, license, and public README

**Files:**
- Create: `LICENSE`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: approved MIT license and current application scripts
- Produces: a clear public project entry point and package metadata for later GitHub publication

- [ ] **Step 1: Add the MIT License**

Create `LICENSE` with the standard MIT text:

```text
MIT License

Copyright (c) 2026 lihaozheng567-dot

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Update package metadata and refresh the lockfile**

Set the root metadata in `package.json` to:

```json
{
  "name": "panlayer",
  "version": "0.1.0",
  "description": "Open-source A-share market review dashboard with market breadth, themes, ETF charts, history, and sourced morning briefs.",
  "private": true,
  "license": "MIT",
  "homepage": "https://panlayer.online",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/lihaozheng567-dot/PanLayer.git"
  },
  "bugs": {
    "url": "https://github.com/lihaozheng567-dot/PanLayer/issues"
  }
}
```

Preserve all existing engines, scripts, dependencies, devDependencies, and `type` fields. Then run:

```bash
npm install --package-lock-only
node -e 'const p=require("./package.json"); if(p.name!=="panlayer"||p.license!=="MIT"||p.private!==true) process.exit(1)'
```

Expected: lockfile root metadata matches `package.json` and the assertion exits 0.

- [ ] **Step 3: Replace the README with a public-project entry point**

The README must contain, in this order:

1. `PanLayer 盘层` title, CI badge, MIT badge, and live-site link;
2. the English summary: “PanLayer is an open-source A-share market review workspace for market breadth, limit-up structure, new highs, themes, ETF charts, historical comparison, and sourced morning briefs.”;
3. Chinese product overview and feature list;
4. screenshots using existing `public/hero-market-reveal.png` or `public/og.png`;
5. technology stack;
6. requirements and `npm install` / `npm run dev` quick start;
7. environment-variable table that lists names and purposes only;
8. data-source and licensing limitations;
9. validation commands;
10. contribution, security, license, live deployment, and investment-risk sections.

The risk section must say that the software is for research and market review, is not investment advice, and that public or commercial operation requires properly licensed market data.

- [ ] **Step 4: Extend ignore rules without touching local artifacts**

Append:

```gitignore
# local review and design artifacts
/.audit/
/Vibe-Research/
/design-qa.md
/history-design-comparison.png
/history-implementation.png
/tsconfig.tsbuildinfo
```

Run:

```bash
git status --short
git check-ignore -v .audit Vibe-Research design-qa.md history-design-comparison.png history-implementation.png tsconfig.tsbuildinfo
```

Expected: the known artifacts are ignored and none is staged or deleted.

- [ ] **Step 5: Verify and commit the public project identity**

Run:

```bash
git diff --check
npm run lint
git add LICENSE README.md package.json package-lock.json .gitignore
git commit -m "docs: prepare PanLayer for open source"
```

Expected: Lint exits 0 and the commit contains only the five listed files.

### Task 3: Community health and contribution surface

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/pull_request_template.md`

**Interfaces:**
- Consumes: public README commands and GitHub repository URL
- Produces: GitHub community-health documents and structured contribution forms

- [ ] **Step 1: Add the contribution guide**

`CONTRIBUTING.md` must document Node.js `>=22.13.0`, fork/branch workflow, setup with `npm install`, development with `npm run dev`, required checks (`npm test`, `npm run lint`, `npm run test:render`, `npm run build`), focused commits, and the rule that secrets and production data must never be committed.

- [ ] **Step 2: Add the security policy**

`SECURITY.md` must direct vulnerability reports to GitHub private vulnerability reporting when available, otherwise to the repository owner's GitHub profile contact. It must explicitly prohibit posting secrets, exploit details, or personal data in public Issues and describe supported versions as “the latest release and current `main`.”

- [ ] **Step 3: Add Contributor Covenant**

Create `CODE_OF_CONDUCT.md` using Contributor Covenant version 2.1, with enforcement contact `https://github.com/lihaozheng567-dot`.

- [ ] **Step 4: Add structured Issue forms**

The bug form must require a summary, reproduction steps, expected behavior, actual behavior, environment, and confirmation that no secret or personal data is included. The feature form must require problem, proposed outcome, alternatives, and scope. `config.yml` must disable blank Issues and link security reports to `SECURITY.md`.

- [ ] **Step 5: Add the Pull Request template**

The template must include sections for summary, linked Issue, validation, screenshots when UI changes, data-source impact, secret/privacy confirmation, and a checklist for tests, documentation, and backward compatibility.

- [ ] **Step 6: Validate and commit community health files**

Run:

```bash
git diff --check
for file in CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md .github/ISSUE_TEMPLATE/bug_report.yml .github/ISSUE_TEMPLATE/feature_request.yml .github/ISSUE_TEMPLATE/config.yml .github/pull_request_template.md; do
  test -s "$file"
done
git add CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md .github/ISSUE_TEMPLATE .github/pull_request_template.md
git commit -m "docs: add open-source community guidelines"
```

Expected: all files are non-empty and the commit contains only community-health files.

### Task 4: Pull-request CI and full validation

**Files:**
- Create: `.github/workflows/ci.yml`
- Test: existing `tests/**`

**Interfaces:**
- Consumes: existing npm validation scripts
- Produces: a secret-free CI check for `main` pushes and pull requests

- [ ] **Step 1: Add CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run lint
      - run: npm run test:render
```

The workflow must not reference repository secrets or production endpoints.

- [ ] **Step 2: Run the complete local validation suite**

Run:

```bash
npm test
npm run lint
npm run test:render
npm run build
```

Expected: every command exits 0. Treat any failure as blocking; do not commit or publish until fixed and the complete sequence passes again.

- [ ] **Step 3: Re-run the public-release audit on the exact tree**

Run:

```bash
panlayer_gitleaks_bin=$(find /tmp/panlayer-open-source-audit-* -type f -name gitleaks -perm +111 -print -quit)
test -n "$panlayer_gitleaks_bin"
"$panlayer_gitleaks_bin" git --redact .
npx --yes license-checker --production --failOn 'AGPL-1.0;AGPL-3.0;GPL-1.0;GPL-2.0;GPL-3.0;SSPL-1.0;BUSL-1.1'
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit CI**

Run:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: validate PanLayer contributions"
```

Expected: a commit containing only `ci.yml`.

### Task 5: GitHub metadata, branch consolidation, release, and publication

**Files:**
- Modify: GitHub repository metadata and remote refs
- Create: Git tag and GitHub Release `v0.1.0`

**Interfaces:**
- Consumes: the exact verified `HEAD` from Tasks 2–4
- Produces: one public repository with default branch `main` and release `v0.1.0`

- [ ] **Step 1: Verify HEAD and push it to main without force**

Run:

```bash
git status --short --branch
git fetch origin --prune
git merge-base --is-ancestor origin/main HEAD
git push origin HEAD:main
```

Expected: tracked state is clean, `origin/main` is an ancestor of `HEAD`, and the push is a fast-forward.

- [ ] **Step 2: Set repository metadata while it is still private**

Run:

```bash
gh repo edit lihaozheng567-dot/PanLayer \
  --description "Open-source A-share market review workspace for breadth, themes, ETF charts, history, and sourced morning briefs." \
  --homepage "https://panlayer.online" \
  --enable-issues
for topic in a-shares stock-market market-data market-review nextjs typescript cloudflare-workers; do
  gh repo edit lihaozheng567-dot/PanLayer --add-topic "$topic"
done
gh repo edit lihaozheng567-dot/PanLayer --default-branch main
```

Expected: repository metadata and default branch resolve to the new `main`.

- [ ] **Step 3: Confirm branch containment and delete merged remote branches**

Run:

```bash
git fetch origin --prune
for branch in origin/codex/panlayer origin/codex/tonghua origin/codex/full-morning-brief; do
  git merge-base --is-ancestor "$branch" origin/main
done
git push origin --delete codex/panlayer codex/tonghua codex/full-morning-brief
```

Expected: all ancestry checks exit 0 before deletion; GitHub lists only `main` afterward.

- [ ] **Step 4: Align the local checkout to main**

Run:

```bash
git branch -f main HEAD
git switch main
git branch -D codex/tonghua codex/panlayer
git status --short --branch
```

Expected: current branch is `main` tracking `origin/main`; local untracked artifacts remain ignored.

- [ ] **Step 5: Create the first open-source release**

Run:

```bash
gh release create v0.1.0 \
  --repo lihaozheng567-dot/PanLayer \
  --target main \
  --title "PanLayer v0.1.0 — First Open-Source Release" \
  --notes "PanLayer's first MIT-licensed open-source release. It includes the A-share review dashboard, historical comparison, ETF workspace, multi-source market data pipeline, and sourced morning briefs. Market data remains subject to each upstream provider's terms and is not investment advice."
```

Expected: GitHub returns the `v0.1.0` release URL.

- [ ] **Step 6: Run the final private-state gate**

Run:

```bash
npm test
npm run lint
npm run test:render
npm run build
panlayer_gitleaks_bin=$(find /tmp/panlayer-open-source-audit-* -type f -name gitleaks -perm +111 -print -quit)
test -n "$panlayer_gitleaks_bin"
"$panlayer_gitleaks_bin" git --redact .
gh repo view lihaozheng567-dot/PanLayer --json visibility,defaultBranchRef,description,homepageUrl,repositoryTopics
gh api repos/lihaozheng567-dot/PanLayer/branches --jq '.[].name'
gh release view v0.1.0 --repo lihaozheng567-dot/PanLayer --json tagName,targetCommitish,url
```

Expected: validation and Gitleaks exit 0; repository remains Private; default branch and only branch are `main`; release targets `main`.

- [ ] **Step 7: Make the repository public**

Run:

```bash
gh repo edit lihaozheng567-dot/PanLayer --visibility public --accept-visibility-change-consequences
```

Expected: command succeeds. Do not proceed if any previous gate failed.

- [ ] **Step 8: Verify anonymous public access and community health**

Run:

```bash
curl --fail --silent https://api.github.com/repos/lihaozheng567-dot/PanLayer | jq '{full_name,visibility,default_branch,homepage,license:.license.spdx_id}'
git ls-remote https://github.com/lihaozheng567-dot/PanLayer.git HEAD refs/heads/main refs/tags/v0.1.0
gh api repos/lihaozheng567-dot/PanLayer/community/profile --jq '{health_percentage,files}'
gh run list --repo lihaozheng567-dot/PanLayer --workflow CI --limit 1
```

Expected: anonymous API reports `visibility: "public"`, default branch `main`, homepage `https://panlayer.online`, license `MIT`; remote refs include `main` and `v0.1.0`; community files are detected.
