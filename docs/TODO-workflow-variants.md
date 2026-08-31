# TODO — workflow variants (HTML5)

`/gamedev-init` (2026-08-31) recorded `engine: HTML5 (vanilla JS)`. The dotfiles workflow templates ship engine variants only for Godot / Unity (`ci.godot.yml`, `ci.unity.yml`, gitleaks configs, seeds), so this repo received the language-agnostic set only (`claude.yml`, `claude-review.yml`, `agent-usage-report.yml`, `risk-triage.yml`, PR/issue templates, ADR template, SECURITY.md, gitleaks pre-commit hook, comment-lint).

Still to author by hand:

- [x] `.github/workflows/ci.yml` — authored as issue #6: single `ci` job = `node --check` over every git-tracked `*.mjs` (the inline script moved to `src/` in #3), `node tests/harness.mjs` judged by exit code, `scripts/comment-lint.py` self-test + ratchet run. The `main protection` ruleset already existed with 4 other rules but no `required_status_checks` rule (`post-create-hardening.sh` omitted it because no stack was detected), so context `ci` is attached to that ruleset right after this lands — a required check cannot name a job that is not yet on `main`. The job carries **no path filter** on purpose — a filtered PR would never report `ci` and would be blocked forever.
- [ ] `.gitleaks.toml` — no HTML5 variant exists; the default gitleaks ruleset is used by `scripts/githooks/pre-commit` until a repo-specific allowlist is needed (issue #1 tracks the fallback).
- [ ] Human-speed bot (Chrome) as a manual-dispatch workflow (`workflow_dispatch`) once the v2 input model lands — it needs a browser runner, so it stays off the per-PR path.
- [ ] `.editorconfig` — the templates README lists it but no template file exists in `workflow-templates/`; add a minimal one (2-space, LF, UTF-8) when convenient.
