#!/usr/bin/env bash
# L4 잔여 orphan(헤드리스 크롬 · python http.server) 스윕 — 기본값은 dry-run.
# scripts/l4-serve.sh 의 trap 은 kill -9·크래시·재부팅을 못 지므로 이 사후 층이 따로 있다 (#231).
#
# 사용법:
#   scripts/l4-sweep.sh                  # 목록만 출력, 아무것도 죽이지 않는다
#   scripts/l4-sweep.sh --kill           # PPID=1 인 소유 프로세스만 종료
#   scripts/l4-sweep.sh --kill --include-live
#
# 소유 판별은 포트가 아니라 표지로 한다 — 크롬은 --user-data-dir 의 경로·접두,
# http.server 는 cwd 가 이 프로젝트인지다. 포트 기준은 실서비스(예: 8799)를 죽인다.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
PROFILE_ROOT="$(printf '%s' "${TMPDIR:-/tmp}" | sed 's:/*$::')/grandmaster-dojo-l4"
MAIN_CLONE=$(cd "$SCRIPT_DIR/.." && cd "$(git rev-parse --git-common-dir)" && cd .. && pwd -P)

KILL=0
INCLUDE_LIVE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --kill) KILL=1; shift ;;
    --include-live) INCLUDE_LIVE=1; shift ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'l4-sweep: 알 수 없는 인자: %s\n' "$1" >&2; exit 2 ;;
  esac
done

ancestor_pids() {
  local p=$$
  while [ -n "$p" ] && [ "$p" != "0" ] && [ "$p" != "1" ]; do
    printf '%s\n' "$p"
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
}
SKIP=" $(ancestor_pids | tr '\n' ' ') "

alive() { kill -0 "$1" 2>/dev/null; }

# 이 프로젝트의 메인 클론과 그 형제 워크트리만 소유로 본다 — 이름 규약이 어긋난
# 워크트리는 공유 .git 대조가 받는다.
own_cwd() {
  local d=$1 common
  case "$d" in
    "$MAIN_CLONE"|"$MAIN_CLONE"/*|"$MAIN_CLONE"-*) return 0 ;;
  esac
  common=$(cd "$d" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null) || return 1
  common=$(cd "$d" && cd "$common" && pwd -P) || return 1
  [ "$common" = "$MAIN_CLONE/.git" ]
}

own_profile() {
  local p=$1 base
  base=$(basename "$p")
  case "$p" in "$PROFILE_ROOT"/*) return 0 ;; esac
  case "$base" in l4-*) return 0 ;; esac
  case "$base" in
    [0-9]*-chrome*) [ -z "$(printf '%s' "${base%%-chrome*}" | tr -d '0-9')" ] && return 0 ;;
  esac
  return 1
}

proc_cwd() { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1; }

TARGETS=''
FOUND=0
printf '%-7s %-6s %-11s %-7s %-6s %s\n' PID PPID ETIME KIND STATE MARKER

while read -r pid ppid etime rest; do
  [ -n "${pid:-}" ] || continue
  case " $SKIP " in *" $pid "*) continue ;; esac
  kind='' marker=''
  case "$rest" in
    *--user-data-dir=*)
      udd=$(printf '%s' "$rest" | sed 's/.*--user-data-dir=//; s/ .*$//')
      own_profile "$udd" || continue
      kind=chrome; marker="--user-data-dir=$udd"
      ;;
    *http.server*)
      case "$rest" in *python*) : ;; *) continue ;; esac
      cwd=$(proc_cwd "$pid")
      [ -n "$cwd" ] || continue
      own_cwd "$cwd" || continue
      kind=server; marker="cwd=$cwd"
      ;;
    *) continue ;;
  esac
  FOUND=$((FOUND + 1))
  if [ "$ppid" = "1" ]; then state=orphan; else state=live-parent; fi
  printf '%-7s %-6s %-11s %-7s %-6s %s\n' "$pid" "$ppid" "$etime" "$kind" "$state" "$marker"
  if [ "$state" = orphan ] || [ "$INCLUDE_LIVE" = 1 ]; then
    TARGETS="$TARGETS $pid"
  fi
done <<EOF
$(ps -axo pid=,ppid=,etime=,command=)
EOF

if [ "$FOUND" = 0 ]; then
  printf 'l4-sweep: 소유 표지가 있는 잔여 프로세스 0건\n'
  exit 0
fi

if [ "$KILL" != 1 ]; then
  printf 'l4-sweep: dry-run — 종료 대상%s (죽이려면 --kill)\n' "${TARGETS:- 없음}"
  exit 0
fi

[ -n "$TARGETS" ] || { printf 'l4-sweep: 종료 대상 없음 (live-parent 만 있음 — --include-live 로 포함)\n'; exit 0; }

for pid in $TARGETS; do alive "$pid" && kill "$pid" 2>/dev/null || true; done
for _ in 1 2 3 4 5 6; do
  rest=''
  for pid in $TARGETS; do alive "$pid" && rest="$rest $pid"; done
  [ -z "$rest" ] && break
  sleep 0.5
done
for pid in $rest; do kill -9 "$pid" 2>/dev/null || true; done

left=''
for pid in $TARGETS; do alive "$pid" && left="$left $pid"; done
printf 'l4-sweep: 종료 시도%s · 잔여%s\n' "$TARGETS" "${left:- 0건}"
