# TODO — workflow variants (HTML5)

`/gamedev-init` (2026-08-31) recorded `engine: HTML5 (vanilla JS)`. The dotfiles workflow templates ship engine variants only for Godot / Unity (`ci.godot.yml`, `ci.unity.yml`, gitleaks configs, seeds), so this repo received the language-agnostic set only (`claude.yml`, `claude-review.yml`, `agent-usage-report.yml`, `risk-triage.yml`, PR/issue templates, ADR template, SECURITY.md, gitleaks pre-commit hook, comment-lint).

Still to author by hand:

- [ ] `.github/workflows/ci.yml` — single `ci` job: `node --check`/eslint-free syntax pass on `index.html` inline script (or extract to `src/`), run the headless judgement harness (6단 × 빈틈 × 선기 matrix assertions), run `scripts/comment-lint.py` in ratchet mode. Once green, add `required_status_checks: [{"context":"ci"}]` to the `main protection` ruleset (`post-create-hardening.sh` omitted it because no stack was detected).
- [ ] `.gitleaks.toml` — no HTML5 variant exists; the default gitleaks ruleset is used by `scripts/githooks/pre-commit` until a repo-specific allowlist is needed (issue #1 tracks the fallback).
- [ ] Human-speed bot (Chrome) as a manual-dispatch workflow (`workflow_dispatch`) once the v2 input model lands — it needs a browser runner, so it stays off the per-PR path.
- [ ] `.editorconfig` — the templates README lists it but no template file exists in `workflow-templates/`; add a minimal one (2-space, LF, UTF-8) when convenient.
