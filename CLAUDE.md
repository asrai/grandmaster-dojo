# grandmaster-dojo

## Project Overview

일대종사 (一代宗師) / EN working title **Grandmaster Dojo** — 손으로 익힌 초식이 자동화되는 순간이 보상이다. 당신이 익힌 만큼 제자가 대신 싸운다. (Supercent AI Native Game PD take-home, deadline 2026-09-07 23:59 KST.)

- Engine: HTML5 (vanilla JS, `index.html` + ESM modules under `src/`, zero dependencies, no build step) — see `docs/adr/` + vault `13. 일대종사/1. 구상/엔진 결정 (HTML5 vs Unity WebGL).md` for the ADR (Unity/Godot deliberately not adopted; re-decision triggers recorded there)
- Genre: 아이들 아케이드 (하이브리드 캐주얼) — mastery-gated automation (숙련도 = 자동화 권한)
- Platform: Web HTML5 first (web portals / PWA), Capacitor-wrapped mobile second
- Core input: 후보 필터 시퀀스 (autocomplete-style prefix filtering; fire = single remaining candidate + full sequence); 6단 공방 판정 (완파/우세/상쇄/열세/역파/피격)

## Vault Reference

- Slot: `13. 일대종사/` (Obsidian vault — human-thinking stages only)
- DesignRoot: `docs/design`   # design/spec docs live in THIS repo (Layout v2, docs-as-code) — this declaration is the Layout v2 switch
- PlanRoot: `docs/plan`       # plan docs in this repo

Under Layout v2 the design/spec documents are docs-as-code in this repo; the vault slot holds only the human-thinking stages (concept, ideas, roadmap, retrospectives, QA). Key locations:
- Game proposal (approved, round 2): `13. 일대종사/0. 프로젝트 개요/1. 게임 제안서.md` (vault)
- Project introduction (infrastructure): `13. 일대종사/0. 프로젝트 개요/2. 프로젝트 소개.md` (vault — its frontmatter `repo_name` is the vault→repo reverse-reference anchor that resolves this repo)
- Concept round history + pre-spec design memos: `13. 일대종사/1. 구상/` (vault — `00_아이디어` v1/v2, `01_`/`02_` 제안·평가, `무공 초식 조사`, `공방 판정 설계` = SoT for the 6단 판정표·수식·파라미터 초기값, `엔진 결정`)
- Roadmap SoT: `13. 일대종사/3. 로드맵/로드맵 현황.md` (vault — created later by `/gamedev-roadmap`)
- Spec / debate / critic / brief / backlog docs: `docs/design/<M>.<NN>-<slug>/` in this repo (created later by `/gamedev-spec` · `/gamedev-debate` · `/gamedev-brief`)
- Glossary SoT: `docs/design/glossary.md` (this repo; vault `0. 프로젝트 개요/3. 용어 사전.md` is a read-only mirror created by `/gamedev-glossary`)
- Plan docs: `docs/plan/` in this repo (created later by `/gamedev-build`)
- Assignment-specific docs (predate Layout v2, kept as-is): `docs/PRD.md` (assignment ①~⑤ mapping), `docs/ai-log.md` (AI 채택/수정/폐기 log — **append at decision time, never reconstruct**), `docs/balance-log.md`

**Vault root** — the slot paths above are vault-relative; resolve them against the absolute vault root, which is in iCloud Drive and identical on both machines (MacBook Pro / Mac mini, iCloud-synced): `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/asrai/`. So the approved proposal's full path is `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/asrai/13. 일대종사/0. 프로젝트 개요/1. 게임 제안서.md`. Korean folder names may be stored NFD (decomposed) on disk, so if `grep`/`find` silently misses, `ls` the parent directory or normalize the query with `nfc` (see global CLAUDE.md § Debugging Approach).

## Local Setup (run once when cloning on another machine)

The machine that `/gamedev-init` bootstrapped already has Git hooks enabled. On **another machine** (MacBook Pro ↔ Mac mini ↔ Windows PC, unified `~/GameProjects/grandmaster-dojo`), run this once right after `git clone`:

```bash
cd ~/GameProjects/grandmaster-dojo
chmod +x scripts/setup-githooks.sh scripts/githooks/* 2>/dev/null || true
bash scripts/setup-githooks.sh
```

The `gitleaks` binary is required, but the dotfiles `Brewfile` entry `brew "gitleaks"` keeps it synced across both Macs — no separate install needed. After this one-time activation, `core.hooksPath` is written into `.git/config`, and pre-commit secret blocking (L1 layer) takes effect.

## Dev Workflow (HTML5)

- No build step: `index.html` is the shipped artifact — markup and styles only, with its runtime logic in the ESM modules under `src/`, entered through `<script type="module" src="src/ui/app.mjs">`. ESM is same-origin only, so always serve with `python3 -m http.server 8000`; do not open `file://`.
- **`src/` root is DOM-free by contract** (`balance.mjs` data · `core.mjs` pure logic · `log.mjs` schema+buffer · `bot.mjs` bot + headless cycle driver); that is what lets the Node harness import the same modules the browser runs. Everything that touches the document lives under `src/ui/` — keep that boundary when adding modules.
- **Four `src/ui/` modules are imported by the Node harness and therefore DOM-free too** — `sequence-input.mjs` (input engine), `match.mjs` (exchange loop), `session.mjs` (session state + log sink), `wiring.mjs` (the instrumentation hook bundles the screens and the headless cycle share). Putting a `document` reference in any of them turns `node tests/harness.mjs` red, and `ci` with it. Anything they need from the page arrives as an injected callback (`now` · `remainingRatio` · `log` · `timer` · `instructed`); keep it that way when extending them. A screen composes its own render on top of a wiring bundle (`composeHooks`) rather than handing render callbacks to the bundle — the reverse direction would drag DOM into a module the harness imports. `src/bot.mjs` sits above the data/logic layer and below the DOM: it may import those four, and `src/ui/screens/dispatch.mjs` imports it back for the shared disciple hand — that is the one intentional edge from `src/ui/` into `src/`.
- All tunables live in the `BALANCE` object; the 6단 판정표 + 파라미터 10종 must be **data-driven JSON** (round-2 CTO#2) so balance tuning never touches logic.
- Verification tiers: headless harness (`node tests/harness.mjs` — 판정 등급 · 피해 정수 · 상태 전이 assertions over the full 6단 × 빈틈 × 선기 matrix) → human-speed bot in Chrome (pace regression, logged to `docs/balance-log.md`) → manual playtest. Bot numbers are reference values, never a substitute for human measurement.
- The first tier is enforced, not just declared: `.github/workflows/ci.yml` (job `ci`) runs `node --check` over every `*.mjs`, `scripts/check-imports.mjs` (links the whole module graph without evaluating it, so a broken relative path or a missing named export fails even in the DOM-touching `src/ui/**` modules, and the `index.html` module-script `src=` entry edge is checked too), the harness, and comment-lint on every PR, and is registered as the required status check of ruleset `main protection` (id 21919517 — registration is a post-landing API step, so the evidence lives in issue #6). Renaming the job without updating that ruleset in the same session silently blocks every later PR. The remaining HTML5 workflow gaps (Chrome bot dispatch, `.gitleaks.toml`, `.editorconfig`) are in `docs/TODO-workflow-variants.md`.
- **Domain vocabulary that collides with platform API names**: `style` (a 무공 초식 object) · `window` (the counter-window — phase literal and local bindings). Extend this list whenever another collision is found.
- **How to disambiguate**: never take a literal `grep` census of these tokens as the count — classify each hit by eye once as domain vocabulary or platform API, then count, and say that the classification pass was done when reporting the number.

## Comment Policy

Comments state only what the code cannot: the *net current* WHY of a line, one sentence, with at most one anchor issue ref (`#N`). Before writing a comment, express the fact in code instead — a better name, an extracted function, a type, an assert, or a test; a comment is the last resort. Never narrate task chronology (issue-by-issue history lives in git blame + plan docs), never reference absolute line numbers (they rot — use symbol names), and never let field/constant semantics live only in a prose block — spec-in-comments is a structure smell: move the semantics into code, tests, or `docs/`. Enforced by `scripts/comment-lint.py` in the `ci` job (ratchet mode — new violations only), which extracts `.py`/`.gd`/`.cs` and JS-family (`.mjs`/`.js`/`.cjs`) comments; rules R1/R2/R3 are documented in the lint header.

## AI Collaboration Scope

**Code implementer**: Claude Code (asrai-adk sub-agent dispatch). — this is the `/gamedev-build` § 7-1 auto-adoption signal. When this marker line is present, the implementer selection prompt is skipped and `implementer: claude` is injected automatically.

AI tooling for the asset/content pipeline (images, BGM, 초식 이름·구결 테이블 등) is described in the game proposal `13. 일대종사/0. 프로젝트 개요/1. 게임 제안서.md` § 기술 스택 & AI 협업 범위 — **a separate axis, distinct from the code-implementer decision**. Whatever asset-generation tool is listed in that section, it has no effect on the marker-based auto-adoption above. Every AI adoption/modification/rejection decision is appended to `docs/ai-log.md` in the same turn it is made (assignment deliverable).

## Security / Agent Input Handling

(This section is kept so the Claude GitHub App writer/reviewer handles external issue bodies correctly instead of over-treating them as untrusted data and aborting. For specifics, see Skill `github-workflow` references/fire-and-forget.md § Agent Audit.)

- Keep former-employer material out of this repo and out of session logs (JD trade-secret clause).
