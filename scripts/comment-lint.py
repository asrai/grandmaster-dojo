#!/usr/bin/env python3
"""Comment hygiene lint — py/gd/cs/js. Stdlib only, deterministic.

Hard-fail (exit 1):
  R1  consecutive regular-comment block > MAX_BLOCK lines
      (doc comments exempt: py docstring / gd ## / cs /// & js|cs /** )
  R2  absolute line-number refs in comments/docstrings: `foo.py:123`, `(:123`
  R3  chronology signature: >=2 issue refs (#N) on one comment line,
      or >=3 distinct issue refs within one comment block

Escape (all three rules): `lint: allow-block(<reason>)`, reason required.
Scope = the enclosing block for R1, the enclosing comment run for R2/R3
(see pragma_regions).

Advisory (report only, never fails):
  A1  per-file & repo comment density (+ delta vs --base when given)
  A2  past-narration keyword lines

Scope: git-tracked *.py *.gd *.cs *.mjs *.js *.cjs minus DEFAULT_EXCLUDES
(vendored/generated).

Modes:
  full (default)              — every violation fails. New repos / batch audits.
  --changed-only --base REF   — ratchet: only violations NOT present in the
      base version of changed files fail (legacy debt is frozen, new debt is
      blocked). This is what template CI uses, so propagating the lint to an
      existing consumer repo never breaks its pre-existing files.

Rationale: dotfiles docs/reference.md#code-comments-as-spatial-index-not-task-chronology
(asrai-bot 2026-07 audit: 58% density, 284 line refs >50% rotten).

Scope note (dotfiles #1339, 2026-08-28): dotfiles itself intentionally does
NOT scan its own tree with this lint — neither its .py files nor the .sh/.ps1
hook tests (no extractor exists for those). What does run there is --self-test
only, wired into tests/run-all.sh; scanning and self-test are separate axes.
Standing control is the batch-audit layer
(docs/reference.md#milestone-batch-hygiene-audit); rationale and
reintroduction triggers: docs/reference.md#comment-lint-dotfiles-scope.
"""

from __future__ import annotations

import argparse
import ast
import io
import os
import re
import subprocess
import sys
import tokenize
from dataclasses import dataclass, field

MAX_BLOCK_DEFAULT = 15
DEFAULT_EXCLUDES = (
    "addons/", "Library/", "Packages/", ".godot/", "node_modules/",
    ".venv/", "venv/", "build/", "dist/", "vendor/", "ProjectSettings/",
)
PRAGMA_RE = re.compile(r"lint:\s*allow-block\(([^)]+)\)")
# file:line — the suffix must be a source extension, not any letter-led token:
# an allowlist is what keeps host:port (`github.com:443`) out, since a TLD is
# not an extension. Ports/times (`:8080`, `12:30`) and numeric ratios
# (`19.5:9`) never reach here either — no letter-led suffix at all.
# Residual overlap (`py`/`gd`/`md`/`sh`/`rs`/`pl` are also ccTLDs) is covered
# by the allow-block pragma — dropping them would lose real refs. An
# allowlist bounds the FP side (a blocked required check) at the cost of a
# bounded FN side; a TLD denylist would invert that, and new gTLDs keep it
# unbounded. R2's enforcement contract IS this list (#206): an unlisted
# extension passing is design, not a defect. New entries: check against the
# full IANA TLD list (data.iana.org/TLD/tlds-alpha-by-domain.txt) first —
# a collision opens a host:port FP channel (ccTLD-overlap standard above) —
# and add on discovery (consumer usage / completing a listed ecosystem) only.
LINE_REF_EXTS = (
    "py", "pyi", "pyw", "gd", "cs", "js", "mjs", "cjs", "ts", "tsx", "jsx",
    "sh", "bash", "zsh", "ps1", "psm1", "bat", "cmd", "rb", "go", "rs",
    "java", "kt", "kts", "c", "h", "cpp", "hpp", "cc", "hh", "m", "mm",
    "php", "lua", "pl", "sql", "r", "vue", "svg", "css", "scss", "less",
    "html", "htm", "xml", "json", "yml", "yaml", "toml", "ini", "cfg",
    "conf", "md", "rst", "txt", "csv", "tscn", "tres", "uxml", "meta",
    "sln", "dart", "hlsl", "glsl", "vert", "frag", "gml", "asm", "env", "mk",
    "ex", "exs", "erl", "hrl", "nim", "zig", "jl", "elm", "clj", "cljs",
    "fs", "fsx", "vb", "bas", "tcl", "awk", "vim", "sol", "tex", "adb", "ads",
    "gdshader", "import", "prefab", "unity", "asset", "csproj",
)
LINE_REF_FILE_RE = re.compile(
    r"[\w./-]*\.(?:" + "|".join(LINE_REF_EXTS) + r"):\d+", re.IGNORECASE)
# a network URL's `host.<ccTLD>:<port>` is not a line ref; a Godot virtual
# path (`res://x.gd:12`) is one, so the scheme — not the bare `//` — decides.
# The match always starts at that `//` because `[\w./-]` cannot cross the `:`.
NET_SCHEME_RE = re.compile(r"\b(?:https?|ftp|wss?|file):$", re.IGNORECASE)
# paren-line refs: `(:6149`, `(:453 미러)`
LINE_REF_PAREN_RE = re.compile(r"\(:\d+")
# issue refs: 1-5 digits (6+ = likely hex color / hash fragment)
ISSUE_REF_RE = re.compile(r"#\d{1,5}\b")
PAST_NARRATION_RE = re.compile(
    r"이전엔|이전에는|종전|기존에는|기존엔|\bwas\b|\d+(?:\.\d+)?\s*→\s*\d+"
)


@dataclass
class Comment:
    line: int          # 1-based start line
    text: str          # text without the comment marker
    is_doc: bool       # docstring / ## / /// / **-doc
    own_line: bool     # nothing but the comment on its line


@dataclass
class FileResult:
    path: str
    comments: list[Comment] = field(default_factory=list)
    nonblank: int = 0


# ── extractors ────────────────────────────────────────────────────────────


def extract_py(path: str, src: str) -> FileResult:
    r = FileResult(path)
    lines = src.splitlines()
    r.nonblank = sum(1 for l in lines if l.strip())
    try:
        for tok in tokenize.generate_tokens(io.StringIO(src).readline):
            if tok.type == tokenize.COMMENT:
                lineno = tok.start[0]
                prefix = lines[lineno - 1][: tok.start[1]]
                r.comments.append(Comment(
                    line=lineno,
                    text=tok.string.lstrip("#").strip(),
                    is_doc=False,
                    own_line=(prefix.strip() == ""),
                ))
    except (tokenize.TokenizeError, IndentationError, SyntaxError):
        return r
    try:
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                                 ast.AsyncFunctionDef)):
                if (node.body and isinstance(node.body[0], ast.Expr)
                        and isinstance(node.body[0].value, ast.Constant)
                        and isinstance(node.body[0].value.value, str)):
                    c = node.body[0].value
                    for off, seg in enumerate(c.value.split("\n")):
                        r.comments.append(Comment(
                            line=c.lineno + off, text=seg.strip(),
                            is_doc=True, own_line=True,
                        ))
    except SyntaxError:
        pass
    return r


def extract_gd(path: str, src: str) -> FileResult:
    r = FileResult(path)
    in_ml: str | None = None  # active multiline-string delimiter
    for lineno, line in enumerate(src.splitlines(), 1):
        if line.strip():
            r.nonblank += 1
        i, n = 0, len(line)
        if in_ml:
            end = line.find(in_ml)
            if end == -1:
                continue
            i = end + len(in_ml)
            in_ml = None
        while i < n:
            ch = line[i]
            if ch == "#":
                body = line[i:]
                is_doc = body.startswith("##")
                r.comments.append(Comment(
                    line=lineno,
                    text=body.lstrip("#").strip(),
                    is_doc=is_doc,
                    own_line=(line[:i].strip() == ""),
                ))
                break
            if ch in "\"'":
                for delim in (ch * 3, ch):
                    if line.startswith(delim, i):
                        end = line.find(delim, i + len(delim))
                        while delim != ch * 3 and end != -1 and line[end - 1] == "\\":
                            end = line.find(delim, end + 1)
                        if end == -1:
                            if delim == ch * 3:
                                in_ml = delim
                            i = n
                        else:
                            i = end + len(delim)
                        break
                continue
            i += 1
    return r


def extract_cs(path: str, src: str) -> FileResult:
    r = FileResult(path)
    lines = src.splitlines()
    r.nonblank = sum(1 for l in lines if l.strip())
    i, n = 0, len(src)
    line, col = 1, 0

    def advance(k: int) -> None:
        nonlocal i, line, col
        for _ in range(k):
            if i < n and src[i] == "\n":
                line += 1
                col = 0
            else:
                col += 1
            i += 1

    def own_line_at(ln: int, c: int) -> bool:
        return lines[ln - 1][:c].strip() == "" if ln <= len(lines) else True

    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            start_line, start_col = line, col
            j = src.find("\n", i)
            j = n if j == -1 else j
            body = src[i:j]
            is_doc = body.startswith("///")
            r.comments.append(Comment(
                line=start_line, text=body.lstrip("/").strip(),
                is_doc=is_doc, own_line=own_line_at(start_line, start_col),
            ))
            advance(j - i)
        elif ch == "/" and nxt == "*":
            start_line, start_col = line, col
            j = src.find("*/", i + 2)
            j = n - 2 if j == -1 else j
            body = src[i + 2:j]
            is_doc = src.startswith("/**", i)
            first = own_line_at(start_line, start_col)
            for off, seg in enumerate(body.split("\n")):
                r.comments.append(Comment(
                    line=start_line + off, text=seg.strip().lstrip("*").strip(),
                    is_doc=is_doc,
                    own_line=(first if off == 0 else True),
                ))
            advance(j + 2 - i)
        elif src.startswith('"""', i):
            j = src.find('"""', i + 3)
            advance((j + 3 if j != -1 else n) - i)
        elif ch == "@" and nxt == '"':
            j = i + 2
            while j < n:
                if src[j] == '"' and src[j:j + 2] != '""':
                    break
                j += 2 if src[j:j + 2] == '""' else 1
            advance(j + 1 - i)
        elif ch == '"':
            j = i + 1
            while j < n and src[j] not in '"\n':
                j += 2 if src[j] == "\\" else 1
            advance(j + 1 - i)
        elif ch == "'":
            j = i + 1
            while j < n and src[j] not in "'\n":
                j += 2 if src[j] == "\\" else 1
            advance(j + 1 - i)
        else:
            advance(1)
    return r


_JS_REGEX_PREV_PUNCT = frozenset("=(,:[!&|?{};+-*%~^<>")
# a `/` after one of these keywords still starts a regex, not a division
_JS_REGEX_PREV_WORDS = frozenset((
    "return", "typeof", "instanceof", "in", "of", "case", "delete", "void",
    "do", "else", "yield", "await", "new", "throw",
))


def js_regex_at(src: str, i: int) -> bool:
    """`src[i] == '/'` — regex literal (True) or division operator (False)?

    Getting this wrong makes `\\/` inside a regex read as a line comment and
    swallows the rest of the line, so the preceding token decides.
    """
    j = i - 1
    while j >= 0 and src[j] in " \t\r\n":
        j -= 1
    if j < 0:
        return True
    ch = src[j]
    if ch in "+-" and j > 0 and src[j - 1] == ch:
        return False
    if ch in _JS_REGEX_PREV_PUNCT:
        return True
    if ch.isalnum() or ch in "_$":
        k = j
        while k >= 0 and (src[k].isalnum() or src[k] in "_$"):
            k -= 1
        return src[k + 1:j + 1] in _JS_REGEX_PREV_WORDS
    return False


def js_skip_quote(src: str, i: int, n: int) -> int:
    q = src[i]
    j = i + 1
    while j < n and src[j] != q and src[j] != "\n":
        j += 2 if src[j] == "\\" else 1
    return j + 1


def js_skip_regex(src: str, i: int, n: int) -> int:
    j, in_class = i + 1, False
    while j < n and src[j] != "\n":
        c = src[j]
        if c == "\\":
            j += 2
            continue
        if c == "[":
            in_class = True
        elif c == "]":
            in_class = False
        elif c == "/" and not in_class:
            return j + 1
        j += 1
    return i + 1  # unterminated on its line — it was a division after all


def js_skip_template(src: str, i: int, n: int) -> int:
    j = i + 1
    while j < n:
        c = src[j]
        if c == "\\":
            j += 2
        elif c == "`":
            return j + 1
        elif c == "$" and src[j + 1:j + 2] == "{":
            j = js_skip_interp(src, j + 2, n)
        else:
            j += 1
    return n


def js_skip_interp(src: str, i: int, n: int) -> int:
    """Skip a `${...}` body; comments inside one are given up, not mis-read."""
    depth = 1
    while i < n and depth:
        c = src[i]
        if c == "{":
            depth += 1
            i += 1
        elif c == "}":
            depth -= 1
            i += 1
        elif c in "\"'":
            i = js_skip_quote(src, i, n)
        elif c == "`":
            i = js_skip_template(src, i, n)
        elif c == "/" and js_regex_at(src, i):
            i = js_skip_regex(src, i, n)
        elif c == "\\":
            i += 2
        else:
            i += 1
    return i


def extract_js(path: str, src: str) -> FileResult:
    r = FileResult(path)
    lines = src.splitlines()
    r.nonblank = sum(1 for l in lines if l.strip())
    i, n = 0, len(src)
    line, col = 1, 0

    def advance(k: int) -> None:
        nonlocal i, line, col
        for _ in range(k):
            if i < n and src[i] == "\n":
                line += 1
                col = 0
            else:
                col += 1
            i += 1

    def own_line_at(ln: int, c: int) -> bool:
        return lines[ln - 1][:c].strip() == "" if ln <= len(lines) else True

    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            start_line, start_col = line, col
            j = src.find("\n", i)
            j = n if j == -1 else j
            r.comments.append(Comment(
                line=start_line, text=src[i:j].lstrip("/").strip(),
                is_doc=False, own_line=own_line_at(start_line, start_col),
            ))
            advance(j - i)
        elif ch == "/" and nxt == "*":
            start_line, start_col = line, col
            j = src.find("*/", i + 2)
            j = n - 2 if j == -1 else j
            is_doc = src.startswith("/**", i)
            first = own_line_at(start_line, start_col)
            for off, seg in enumerate(src[i + 2:j].split("\n")):
                r.comments.append(Comment(
                    line=start_line + off, text=seg.strip().lstrip("*").strip(),
                    is_doc=is_doc, own_line=(first if off == 0 else True),
                ))
            advance(j + 2 - i)
        elif ch == "`":
            advance(js_skip_template(src, i, n) - i)
        elif ch in "\"'":
            advance(js_skip_quote(src, i, n) - i)
        elif ch == "/" and js_regex_at(src, i):
            advance(js_skip_regex(src, i, n) - i)
        else:
            advance(1)
    return r


EXTRACTORS = {".py": extract_py, ".gd": extract_gd, ".cs": extract_cs,
              ".mjs": extract_js, ".js": extract_js, ".cjs": extract_js}


# ── rules ─────────────────────────────────────────────────────────────────


def blocks_of(fr: FileResult) -> list[list[Comment]]:
    """Runs of consecutive own-line regular comments (doc comments break runs)."""
    out: list[list[Comment]] = []
    run: list[Comment] = []
    for c in sorted(fr.comments, key=lambda c: c.line):
        if c.is_doc or not c.own_line:
            if run:
                out.append(run)
                run = []
            continue
        if run and c.line == run[-1].line + 1:
            run.append(c)
        else:
            if run:
                out.append(run)
            run = [c]
    if run:
        out.append(run)
    return out


def pragma_ok(text: str) -> bool:
    """Valid escape = `lint: allow-block(<reason>)` with a non-empty reason.

    Single source for all three rules — the module docstring declares one
    escape contract, so R1 and R2/R3 must not drift apart on what counts.
    """
    m = PRAGMA_RE.search(text)
    return bool(m and m.group(1).strip())


def pragma_regions(fr: FileResult) -> set[int]:
    """Line numbers covered by a valid `lint: allow-block(<reason>)` pragma.

    This is what gives R2/R3 an escape hatch (a legitimate `host:port` or an
    enumeration `#1 #2 #3` has no other way past the ratchet). R1 keeps its
    own block-scoped check.

    Region = the pragma's own comment run, where runs are cut on the same
    boundaries blocks_of uses — consecutive lines AND same kind. A doc run and
    a regular-comment run that abut therefore stay separate, and a trailing
    comment (own_line False) covers only its own line: one pragma must not
    become a blanket exemption for whatever happens to sit next to it.
    """
    covered: set[int] = set()
    for c in fr.comments:
        if not c.own_line and pragma_ok(c.text):
            covered.add(c.line)
    for kind in (True, False):
        by_line: dict[int, list[Comment]] = {}
        for c in fr.comments:
            if c.own_line and c.is_doc is kind:
                by_line.setdefault(c.line, []).append(c)
        lines = sorted(by_line)
        i = 0
        while i < len(lines):
            j = i
            while j + 1 < len(lines) and lines[j + 1] == lines[j] + 1:
                j += 1
            run = lines[i:j + 1]
            if any(pragma_ok(c.text) for r in run for c in by_line[r]):
                covered.update(run)
            i = j + 1
    return covered


def check_file(fr: FileResult, max_block: int) -> tuple[list[tuple[str, str]], list[str]]:
    """Returns ([(dedup_key, message)], [advisory]).

    dedup_key is line-number-free so the --changed-only ratchet can subtract
    base-version violations even when unrelated edits shift line numbers.
    """
    fails: list[tuple[str, str]] = []
    advisories: list[str] = []
    exempt = pragma_regions(fr)
    for block in blocks_of(fr):
        head = block[0].text[:80]
        if len(block) > max_block:
            if not any(pragma_ok(c.text) for c in block):
                fails.append((
                    f"R1|{head}",
                    f"{fr.path}:{block[0].line} R1 연속 주석 블록 {len(block)}줄 "
                    f"(상한 {max_block} — 정당하면 `lint: allow-block(<이유>)` 첨부, "
                    f"명세성 산문이면 코드·테스트·docs/ 로 이동)"))
        refs = {m.group() for c in block for m in ISSUE_REF_RE.finditer(c.text)}
        if len(refs) >= 3 and block[0].line not in exempt:
            fails.append((
                f"R3B|{'|'.join(sorted(refs))}",
                f"{fr.path}:{block[0].line} R3 한 블록에 상이 이슈 ref "
                f"{len(refs)}개 ({', '.join(sorted(refs)[:4])}…) — 연대기 서사. "
                f"넷 현행 WHY 1줄 + 앵커 1개로 증류 "
                f"(정당하면 `lint: allow-block(<이유>)` 첨부)"))
    for c in fr.comments:
        loc = f"{fr.path}:{c.line}"
        if PAST_NARRATION_RE.search(c.text):
            advisories.append(f"{loc} A2 과거-서술 의심: {c.text[:60]}")
        if c.line in exempt:
            continue
        for m in LINE_REF_FILE_RE.finditer(c.text):
            # only a scheme's authority is exempt, never its path: the match
            # spans `//host.sh:9000` but also `//host/src/foo.py:123`, and the
            # latter is a real line ref that merely happens to sit in a URL
            if (m.group().startswith("//") and "/" not in m.group()[2:]
                    and NET_SCHEME_RE.search(c.text[:m.start()])):
                continue
            fails.append((
                f"R2|{m.group()}",
                f"{loc} R2 절대 줄번호 참조 `{m.group()}` — 심볼명으로 치환 "
                f"(정당하면 `lint: allow-block(<이유>)` 첨부)"))
        for m in LINE_REF_PAREN_RE.finditer(c.text):
            fails.append((
                f"R2|{m.group()}",
                f"{loc} R2 절대 줄번호 참조 `{m.group()}` — 심볼명으로 치환 "
                f"(정당하면 `lint: allow-block(<이유>)` 첨부)"))
        if not c.is_doc and len(ISSUE_REF_RE.findall(c.text)) >= 2:
            fails.append((
                f"R3L|{c.text[:80]}",
                f"{loc} R3 한 줄에 이슈 ref 2개+ — 앵커는 1개만 (이력은 git blame 몫, "
                f"정당하면 `lint: allow-block(<이유>)` 첨부)"))
    return fails, advisories


def ratchet_filter(current: list[tuple[str, str]],
                   base: list[tuple[str, str]]) -> list[str]:
    """Keep only violations exceeding the base version's count per dedup_key."""
    from collections import Counter
    budget = Counter(k for k, _ in base)
    out: list[str] = []
    for k, msg in current:
        if budget[k] > 0:
            budget[k] -= 1
        else:
            out.append(msg)
    return out


# ── driver ────────────────────────────────────────────────────────────────


def target_files(root: str, excludes: tuple[str, ...]) -> list[str]:
    try:
        out = subprocess.run(
            ["git", "-C", root, "ls-files"] + [f"*{e}" for e in EXTRACTORS],
            capture_output=True, text=True, check=True).stdout
        paths = out.splitlines()
    except (subprocess.CalledProcessError, FileNotFoundError):
        paths = [os.path.relpath(os.path.join(dp, f), root)
                 for dp, _, fs in os.walk(root) for f in fs
                 if os.path.splitext(f)[1] in EXTRACTORS]
    return [p for p in paths
            if not any(seg in p for seg in excludes)
            and os.path.splitext(p)[1] in EXTRACTORS
            # self-exclude: 이 스크립트의 규칙 문서가 패턴 예시를 항상 포함
            and os.path.basename(p) != "comment-lint.py"]


def scope_line(files: list[str], lint_set: list[str] | None = None) -> str:
    from collections import Counter
    by_ext = Counter(os.path.splitext(p)[1] for p in files)
    detail = " · ".join(f"{e or '?'} {n}" for e, n in sorted(by_ext.items()))
    tail = "" if lint_set is None else f" · 검사 {len(lint_set)}건"
    return f"대상 {len(files)}건 ({detail}){tail}"


def density(fr: FileResult) -> float:
    covered = {c.line for c in fr.comments if c.own_line} | {
        c.line for c in fr.comments if c.is_doc}
    return len(covered) / fr.nonblank if fr.nonblank else 0.0


def aggregate_density(root: str, files: list[str],
                      ref: str | None = None) -> tuple[int, int]:
    com, nb = 0, 0
    for p in files:
        if ref:
            try:
                src = subprocess.run(
                    ["git", "-C", root, "show", f"{ref}:{p}"],
                    capture_output=True, text=True, check=True).stdout
            except subprocess.CalledProcessError:
                continue
        else:
            try:
                with open(os.path.join(root, p), encoding="utf-8",
                          errors="replace") as f:
                    src = f.read()
            except OSError:
                continue
        fr = EXTRACTORS[os.path.splitext(p)[1]](p, src)
        covered = {c.line for c in fr.comments if c.own_line or c.is_doc}
        com += len(covered)
        nb += fr.nonblank
    return com, nb


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default=".")
    ap.add_argument("--max-block", type=int, default=MAX_BLOCK_DEFAULT)
    ap.add_argument("--base", default=None,
                    help="git ref: density delta + --changed-only ratchet baseline")
    ap.add_argument("--changed-only", action="store_true",
                    help="lint only files changed vs --base; fail only on NEW "
                         "violations (legacy debt frozen). Template-CI mode.")
    ap.add_argument("--exclude", default=None,
                    help="comma-separated path substrings (overrides defaults)")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()
    if args.changed_only and not args.base:
        print("comment-lint: --changed-only requires --base", file=sys.stderr)
        return 2

    excludes = (tuple(s for s in args.exclude.split(",") if s)
                if args.exclude is not None else DEFAULT_EXCLUDES)
    files = target_files(args.root, excludes)
    lint_set = files
    if args.changed_only:
        # base must resolve; otherwise (shallow clone / stale sha) fail OPEN —
        # falling back to full-repo hard-fail would permanently red a legacy
        # consumer repo over a CI checkout misconfig.
        probe = subprocess.run(
            ["git", "-C", args.root, "rev-parse", "--verify",
             f"{args.base}^{{commit}}"], capture_output=True, text=True)
        if probe.returncode != 0:
            print(scope_line(files))
            print(f"comment-lint: base `{args.base}` unresolvable — "
                  f"skipping (fail-open). checkout fetch-depth 확인 필요",
                  file=sys.stderr)
            return 0
        try:
            out = subprocess.run(
                ["git", "-C", args.root, "diff", "--name-only",
                 "--diff-filter=ACMR", f"{args.base}...HEAD"],
                capture_output=True, text=True, check=True).stdout
            changed = set(out.splitlines())
        except subprocess.CalledProcessError:
            print(scope_line(files))
            print("comment-lint: diff failed — skipping (fail-open)",
                  file=sys.stderr)
            return 0
        lint_set = [p for p in files if p in changed]

    all_fails: list[str] = []
    all_adv: list[str] = []
    results: list[FileResult] = []
    for p in lint_set:
        try:
            with open(os.path.join(args.root, p), encoding="utf-8",
                      errors="replace") as f:
                src = f.read()
        except OSError:
            continue
        fr = EXTRACTORS[os.path.splitext(p)[1]](p, src)
        results.append(fr)
        fails, adv = check_file(fr, args.max_block)
        if args.changed_only:
            try:
                base_src = subprocess.run(
                    ["git", "-C", args.root, "show", f"{args.base}:{p}"],
                    capture_output=True, text=True, check=True).stdout
                base_fails, _ = check_file(
                    EXTRACTORS[os.path.splitext(p)[1]](p, base_src),
                    args.max_block)
            except subprocess.CalledProcessError:
                base_fails = []  # new file → every violation is new
            all_fails.extend(ratchet_filter(fails, base_fails))
        else:
            all_fails.extend(msg for _, msg in fails)
        all_adv.extend(adv)

    lines_out: list[str] = []
    if all_fails:
        lines_out.append(f"## comment-lint: {len(all_fails)}건 hard-fail")
        lines_out.extend(f"- {f}" for f in all_fails)
    else:
        lines_out.append("## comment-lint: hard-fail 0건")
    lines_out.append(scope_line(files, lint_set))
    com, nb = aggregate_density(args.root, files)
    pct = 100 * com / nb if nb else 0.0
    dens_line = f"A1 전체 밀도 {pct:.1f}% ({com}/{nb})"
    if args.base:
        bcom, bnb = aggregate_density(args.root, files, args.base)
        if bnb:
            dens_line += f" | base {100 * bcom / bnb:.1f}% → 델타 {pct - 100 * bcom / bnb:+.1f}%p"
    lines_out.append(dens_line)
    top = sorted(results, key=density, reverse=True)[:10]
    for fr in top:
        if density(fr) > 0.25:
            lines_out.append(f"  - {fr.path}: {100 * density(fr):.0f}%")
    if all_adv:
        lines_out.append(f"A2 과거-서술 의심 {len(all_adv)}건 (advisory)")
        lines_out.extend(f"  - {a}" for a in all_adv[:20])

    report = "\n".join(lines_out)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        try:
            with open(summary, "a", encoding="utf-8") as f:
                f.write(report + "\n")
        except OSError:
            pass
    return 1 if all_fails else 0


# ── self-test fixtures ────────────────────────────────────────────────────

_FIX_PY = '''\
"""Module docstring — long API docs are exempt from R1.
line2
"""
X = 1  # trailing comment, not own-line
# see vision.py:140 for parity
# (:6149 mirror)
s = "not a # comment :123 inside string"
'''

_FIX_GD = '''\
## doc comment line 1 (exempt kind)
var x = "string with # hash and .py:99 inside"
# #927 did X then #1315 changed it
# refs #11 #22 block: #33
'''

_FIX_CS = '''\
/// <summary>XML doc — exempt kind</summary>
var s = @"verbatim "" with // no comment .cs:5";
var r = "esc \\" quote // still string";
// normal comment was 0.29 → 0.38
/* block
   spans lines */
'''

_FIX_JS = '''\
/** JSDoc block — exempt kind */
const url = "https://host/src/foo.mjs:123 inside a string";
const t = `template with // no comment and ${x ? "a" : `b`} inside`;
const re = /https:\\/\\//;  // trailing comment survives the regex
const n = i++ / 2;  // division keeps its trailing comment
const s2 = `${t.replace(/[{]/g, "")} tail`;  // interp regex must not desync
// normal comment was 0.29 → 0.38
// see vision.py:140 and core.mjs:88 for parity
'''


def self_test() -> int:
    failures: list[str] = []

    def expect(cond: bool, msg: str) -> None:
        if not cond:
            failures.append(msg)

    def msgs(src_name: str, src: str, ext: str = ".py") -> list[str]:
        fr = EXTRACTORS[ext](src_name, src)
        return [m for _, m in check_file(fr, 15)[0]]

    py = extract_py("f.py", _FIX_PY)
    expect(any(c.is_doc for c in py.comments), "py: docstring detected")
    expect(sum(1 for c in py.comments if not c.is_doc) == 3,
           "py: 3 regular comments")
    fails = msgs("f.py", _FIX_PY)
    expect(sum("R2" in f for f in fails) == 2, f"py: 2 R2 hits, got {fails}")

    gd = extract_gd("f.gd", _FIX_GD)
    expect(any(c.is_doc for c in gd.comments), "gd: ## doc detected")
    expect(not any(".py:99" in c.text for c in gd.comments),
           "gd: hash inside string not a comment")
    fails = msgs("f.gd", _FIX_GD, ".gd")
    expect(any("R3" in f and "2개+" in f for f in fails), "gd: R3 line-level")
    expect(any("R3" in f and "블록" in f for f in fails),
           f"gd: R3 block-level, got {fails}")

    cs = extract_cs("f.cs", _FIX_CS)
    expect(any(c.is_doc for c in cs.comments), "cs: /// doc detected")
    expect(not any(".cs:5" in c.text for c in cs.comments),
           "cs: verbatim string content not a comment")
    expect(any("normal comment" in c.text for c in cs.comments),
           "cs: // after string parsed")
    expect(sum(1 for c in cs.comments if "spans" in c.text or "block" in c.text) == 2,
           "cs: block comment lines counted")
    _, adv = check_file(cs, 15)
    expect(any("A2" in a for a in adv), "cs: A2 value-history flagged")

    # 상류 템플릿 전파가 이 파일을 덮으면 JS 확장자가 조용히 사라진다 — CI 는
    # 계속 green 이 되므로 등록 자체를 단정으로 잡는다.
    expect(all(e in EXTRACTORS for e in (".mjs", ".js", ".cjs")),
           "js: JS-family extractor registered")

    js = extract_js("f.mjs", _FIX_JS)
    expect(any(c.is_doc for c in js.comments), "js: /** doc detected")
    expect(not any("foo.mjs:123" in c.text for c in js.comments),
           "js: string content not a comment")
    expect(not any("no comment" in c.text for c in js.comments),
           "js: template-literal content not a comment")
    expect(any(c.text.startswith("trailing comment survives") and not c.own_line
               for c in js.comments),
           "js: a regex literal is skipped whole, not opened as a comment")
    expect(any(c.text.startswith("division keeps") for c in js.comments),
           "js: `/` after postfix ++ divides, so the trailing comment survives")
    expect(any(c.text.startswith("interp regex must not desync")
               for c in js.comments),
           "js: a regex inside `${...}` does not break out of the template")
    js_fails = msgs("f.mjs", _FIX_JS, ".mjs")
    expect(sum("R2" in f for f in js_fails) == 2,
           f"js: 2 R2 hits (py + mjs refs), got {js_fails}")
    _, js_adv = check_file(js, 15)
    expect(any("A2" in a for a in js_adv), "js: A2 value-history flagged")

    long_block = "\n".join(f"# narration line {i}" for i in range(20)) + "\ncode = 1\n"
    expect(any("R1" in f for f in msgs("long.py", long_block)),
           "R1 fires at 20 lines")
    allowed = ("# lint: allow-block(algorithm derivation)\n"
               + "\n".join(f"# line {i}" for i in range(20)) + "\ncode = 1\n")
    expect(not any("R1" in f for f in msgs("ok.py", allowed)),
           "R1 pragma escape works")
    empty_pragma = ("# lint: allow-block( )\n"
                    + "\n".join(f"# line {i}" for i in range(20)) + "\ncode = 1\n")
    expect(any("R1" in f for f in msgs("bad.py", empty_pragma)),
           "R1 empty-reason pragma rejected")

    port_fails = msgs("p.py", "# server at localhost:8080 and 12:30 KST\nx=1\n")
    expect(not any("R2" in f for f in port_fails),
           f"R2 no FP on port/time, got {port_fails}")
    ratio_fails = msgs("r.py", "# aspect 16:9 140.4 → 19.5:9 89.9\nx=1\n")
    expect(not any("R2" in f for f in ratio_fails),
           f"R2 no FP on numeric ratio, got {ratio_fails}")

    # R2 negative/positive pair — the exclusion must not swallow real refs
    host_fails = msgs(
        "h.py",
        "# proxy github.com:443, api.example.io:8080, https://cdn.a.sh:9000\n"
        "# see also sub.domain.co.kr:3000 mirror\nx=1\n")
    expect(not any("R2" in f for f in host_fails),
           f"R2 no FP on domain:port, got {host_fails}")
    ref_fails = msgs(
        "q.py",
        "# see vision.py:140, docs/reference.md:12, Player.cs:7, main.cpp:9\n"
        "x=1\n")
    expect(sum("R2" in f for f in ref_fails) == 4,
           f"R2 still catches real file:line refs, got {ref_fails}")
    # allowlist-scope contract (#206): list membership, not suffix length,
    # decides. `gdshader` is the sole discriminator on this line — no other
    # listed extension appears, so dropping that entry reddens only this case.
    gds_fails = msgs("s.py", "# tune water.gdshader:88 falloff\nx=1\n")
    expect(sum("R2" in f for f in gds_fails) == 1,
           f"R2 catches a 5+ char listed extension exactly once, got {gds_fails}")
    # an *unlisted* extension passes — the FN side is accepted by contract;
    # this pins allowlist scope. proto is the fixture because it is a commonly
    # proposed candidate (update it if proto is ever listed).
    proto_fails = msgs("s2.py", "# see schema.proto:12 for framing\nx=1\n")
    expect(not any("R2" in f for f in proto_fails),
           f"unlisted extension passes by contract, got {proto_fails}")
    # the scheme decides, not the bare `//`: res:// is a real Godot path
    res_fails = msgs("g.gd", "# see res://scenes/player.gd:12\nvar x = 1\n", ".gd")
    expect(any("R2" in f for f in res_fails),
           f"R2 catches res:// line refs, got {res_fails}")
    # and only the authority is exempt — a line ref in a URL *path* still fails
    url_path = msgs("u.py", "# see https://host/src/foo.py:123 upstream\nx=1\n")
    expect(any("R2" in f for f in url_path),
           f"R2 catches line refs in URL paths, got {url_path}")
    url_auth = msgs("u2.py", "# proxy https://cdn.a.sh:9000/assets is fine\nx=1\n")
    expect(not any("R2" in f for f in url_auth),
           f"R2 no FP on scheme authority with trailing path, got {url_auth}")

    # pragma escape now spans R2/R3, not just R1
    r2_pragma = msgs(
        "e.py",
        "# lint: allow-block(port literal documented)\n"
        "# proxy listens on service.py:8080 in staging\nx=1\n")
    expect(not any("R2" in f for f in r2_pragma),
           f"R2 pragma escape works, got {r2_pragma}")
    r3_pragma = msgs(
        "e2.py",
        "# lint: allow-block(migration ledger, refs are the ledger)\n"
        "# supersedes #11 and #22\n# and #33\nx=1\n")
    expect(not any("R3" in f for f in r3_pragma),
           f"R3 pragma escape works, got {r3_pragma}")
    r2_empty_pragma = msgs(
        "e3.py",
        "# lint: allow-block( )\n# see vision.py:140\nx=1\n")
    expect(any("R2" in f for f in r2_empty_pragma),
           "R2 empty-reason pragma rejected")
    r2_far_pragma = msgs(
        "e4.py",
        "# lint: allow-block(unrelated block)\nx=1\n# see vision.py:140\ny=2\n")
    expect(any("R2" in f for f in r2_far_pragma),
           f"R2 pragma does not leak past its region, got {r2_far_pragma}")
    r2_trailing_leak = msgs(
        "e5.py",
        "x = 1  # lint: allow-block(legit host)\ny = 2  # see vision.py:140\n")
    expect(any("R2" in f for f in r2_trailing_leak),
           f"trailing pragma covers only its own line, got {r2_trailing_leak}")
    r2_doc_leak = msgs(
        "e6.py",
        '"""Doc.\nlint: allow-block(doc reason)\n"""\n# see vision.py:140\nx=1\n')
    expect(any("R2" in f for f in r2_doc_leak),
           f"docstring pragma does not leak into the next run, got {r2_doc_leak}")

    # every hard-fail message must name the escape (reference.md 주석 위생 절)
    all_msgs = (msgs("m1.py", long_block) + msgs("m2.py", "# see a.py:1\nx=1\n")
                + msgs("m3.py", "# mirror (:6149)\nx=1\n")
                + msgs("m4.py", "# refs #11 #22\n# and #33\nx=1\n"))
    expect(len(all_msgs) >= 5 and all(
        "allow-block" in f for f in all_msgs),
        f"every hard-fail message names the pragma escape, got {all_msgs}")
    _, pragma_adv = check_file(extract_py(
        "a2.py", "# lint: allow-block(kept)\n# 이전엔 0.29 였다\nx=1\n"), 15)
    expect(any("A2" in a for a in pragma_adv),
           "pragma does not silence A2 advisories")

    # ratchet: legacy violation frozen, new violation caught even if lines shift
    base = "# see vision.py:140 parity\nx = 1\n"
    head = "y = 0\n# see vision.py:140 parity\n# also hunting.py:88\nx = 1\n"
    cur, _ = check_file(extract_py("f.py", head), 15)
    old, _ = check_file(extract_py("f.py", base), 15)
    new = ratchet_filter(cur, old)
    expect(len(new) == 1 and "hunting.py:88" in new[0]
           and "vision.py:140" not in new[0],
           f"ratchet keeps only the new violation, got {new}")

    if failures:
        print("SELF-TEST FAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("self-test OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
