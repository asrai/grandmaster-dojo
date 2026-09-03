#!/usr/bin/env bash
# L4 잔여 orphan(헤드리스 크롬 · python http.server) 스윕 — 기본값은 dry-run.
# scripts/l4-serve.sh 의 trap 은 kill -9·크래시·재부팅을 못 지므로 이 사후 층이 따로 있다 (#231).
#
# 사용법:
#   scripts/l4-sweep.sh                  # 목록만 출력, 아무것도 죽이지 않는다
#   scripts/l4-sweep.sh --kill           # 버려진 것(orphan)만 종료 + 죽은 세션 상태 파일 제거
#   scripts/l4-sweep.sh --kill --include-live
#   scripts/l4-sweep.sh --kill --max-age 30      # detached 세션의 유예를 30분으로
#
# STATE 판정 — l4-serve 의 run 세션은 상태 파일에 소유 셸 pid 를 남기므로 생사가 확정된다.
# up 세션은 의도적으로 detach 된 것이라 소유 셸이 없어, 「쓰는 중」과 「버려진 것」을
# 원리적으로 구분할 수 없다 — 그래서 크롬 프로필의 마지막 갱신 시각을 활동 근사로 삼아
# 유예 시간(--max-age, 기본 120분)으로 가른다.
#   live-session : run 세션의 소유 셸이 살아 있거나, up 세션의 프로필이 유예 안에 갱신됐다 → 보존
#   orphan       : 소유 셸이 죽었거나(run 을 kill -9), 상태 파일이 아예 없거나,
#                  up 세션이 유예를 넘겼다 → --kill 의 기본 대상
#   live-parent  : orphan 크롬의 헬퍼처럼 부모가 붙어 있다 → 부모를 죽이면 함께 죽는다
# --include-live 는 live-session 까지 걷는다 — 다른 워크트리에서 순회 중인 세션도
# 죽이므로 그 사실을 알고 쓸 때만 붙여라.
#
# 소유 판별은 포트가 아니라 표지로 한다 — 크롬은 --user-data-dir 의 경로,
# http.server 는 cwd 가 이 프로젝트인지다. 포트 기준은 실서비스(예: 8799)를 죽인다.
#
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
PROFILE_ROOT="$(printf '%s' "${TMPDIR:-/tmp}" | sed 's:/*$::')/grandmaster-dojo-l4"
TMP_ROOT="$(printf '%s' "${TMPDIR:-}" | sed 's:/*$::')"
MAIN_CLONE=$(cd "$SCRIPT_DIR/.." && cd "$(git rev-parse --git-common-dir)" && cd .. && pwd -P) \
  || { printf 'l4-sweep: 저장소 루트를 못 찾았다 — 소유 판별 불가\n' >&2; exit 2; }

KILL=0
INCLUDE_LIVE=0
MAX_AGE_MIN=120
while [ $# -gt 0 ]; do
  case "$1" in
    --kill) KILL=1; shift ;;
    --include-live) INCLUDE_LIVE=1; shift ;;
    --max-age)
      [ $# -ge 2 ] || { printf 'l4-sweep: --max-age 에는 분 단위 값이 필요하다\n' >&2; exit 2; }
      case "$2" in ''|*[!0-9]*) printf 'l4-sweep: --max-age 는 분 단위 정수다: %s\n' "$2" >&2; exit 2 ;; esac
      MAX_AGE_MIN=$2; shift 2 ;;
    -h|--help) sed -n '/^# 사용법:/,/^#$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'l4-sweep: 알 수 없는 인자: %s\n' "$1" >&2; exit 2 ;;
  esac
done

ancestor_pids() {
  local p=$$
  while [ -n "$p" ] && [ "$p" != "0" ] && [ "$p" != "1" ]; do
    printf '%s\n' "$p"
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ' || true)
  done
}
SKIP=" $(ancestor_pids | tr '\n' ' ') "

alive() { kill -0 "$1" 2>/dev/null; }

proc_cwd() { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1; }

pids_by_profile() {
  [ -n "${1:-}" ] || return 0
  ps -axo pid=,command= | L4_PAT=$1 awk '
    { pat = "--user-data-dir=" ENVIRON["L4_PAT"]; i = index($0, pat)
      if (i == 0) next
      tail = substr($0, i + length(pat), 1)
      if (tail == "" || tail == " ") print $1 }'
}

# 디렉터리가 남아 있으면 공유 .git 대조가 유일한 근거다 — 이름 접두만으로 받으면 같은
# 접두를 가진 무관한 저장소까지 소유가 된다. 이름 규약은 워크트리가 이미 삭제돼
# git 대조가 원리적으로 불가능한 경우에만 대신 선다.
own_cwd() {
  local d=$1 common
  if [ -d "$d" ]; then
    common=$(cd "$d" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null) || return 1
    common=$(cd "$d" && cd "$common" && pwd -P) || return 1
    [ "$common" = "$MAIN_CLONE/.git" ]
    return $?
  fi
  case "$d" in
    "$MAIN_CLONE"|"$MAIN_CLONE"/*|"$MAIN_CLONE"-issue-*) return 0 ;;
  esac
  return 1
}

# 프로필은 이 스크립트의 프로필 루트, 또는 사용자 전용 TMPDIR 밑의 레거시 접두
# (l4-* · <이슈번호>-chrome*)만 소유다 — 디렉터리 앵커가 없으면 basename 만 같은 남의
# 프로필까지 삼킨다. TMPDIR 미설정 환경에서 레거시 접두를 인정하지 않는 것은 공유 /tmp
# 의 남의 프로필이 그 규칙만으로 kill 대상이 되기 때문이다. 레거시 분기는 #231 이전
# 즉석 프로필용이라 그 잔재가 소진되면 지운다.
own_profile() {
  local p=$1 pid=$2 base cwd
  case "$p" in
    "$PROFILE_ROOT"/*) return 0 ;;
    /*) : ;;
    *) cwd=$(proc_cwd "$pid" || true); [ -n "$cwd" ] || return 1; own_cwd "$cwd"; return $? ;;
  esac
  base=$(basename "$p")
  case "$base" in
    l4-*) : ;;
    [0-9]*-chrome*) [ -z "$(printf '%s' "${base%%-chrome*}" | tr -d '0-9')" ] || return 1 ;;
    *) return 1 ;;
  esac
  [ -n "$TMP_ROOT" ] || return 1
  case "$p" in "$TMP_ROOT"/*) return 0 ;; esac
  return 1
}

# run 세션은 소유 셸 pid 로, up 세션은 크롬 프로필의 최근 갱신 시각으로 생사를 가른다. pid 재사용은
# 그 pid 의 커맨드라인에 l4-serve.sh 가 있는지로 배제한다.
owner_alive() {
  local pid=$1
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  ps -o command= -p "$pid" 2>/dev/null | grep -q 'l4-serve\.sh'
}

LIVE_PIDS=' '
STALE=''
for f in "$PROFILE_ROOT"/*.env; do
  [ -f "$f" ] || continue
  tag=${f##*/}; tag=${tag%.env}
  [ -n "$tag" ] || continue
  holders=$(pids_by_profile "$PROFILE_ROOT/$tag-chrome" || true)
  server=$(sed -n 's/^L4_SERVER_PID=//p' "$f" | tail -1)
  owner=$(sed -n 's/^L4_OWNER_PID=//p' "$f" | tail -1)
  mode=$(sed -n 's/^L4_MODE=//p' "$f" | tail -1)
  activity=''

  session_live=0
  if [ -n "$owner" ] || [ "$mode" = run ]; then
    owner_alive "$owner" && session_live=1
  else
    activity="$PROFILE_ROOT/$tag-chrome"
    [ -d "$activity" ] || activity=$f
    [ -n "$(find "$activity" -maxdepth 0 -mmin "+$MAX_AGE_MIN" 2>/dev/null)" ] || session_live=1
  fi

  if [ -z "$holders" ] && { [ -z "$server" ] || ! alive "$server"; }; then
    STALE="$STALE $tag"
  elif [ "$session_live" = 1 ]; then
    LIVE_PIDS="$LIVE_PIDS$(printf '%s' "$holders" | tr '\n' ' ') $server "
  fi
done

# 수집 시점과 시그널 시점 사이에 대상이 죽고 pid 가 재사용될 수 있다 — 죽이기 직전에
# 커맨드라인·cwd 로 소유를 다시 확인한다.
owned_now() {
  local pid=$1 line udd cwd
  line=$(ps -o command= -p "$pid" 2>/dev/null || true)
  [ -n "$line" ] || return 1
  case "$line" in
    *--user-data-dir=*)
      udd=$(printf '%s' "$line" | sed 's/.*--user-data-dir=//; s/ .*$//')
      own_profile "$udd" "$pid" ;;
    *http.server*)
      case "$line" in *python*) : ;; *) return 1 ;; esac
      cwd=$(proc_cwd "$pid" || true)
      [ -n "$cwd" ] || return 1
      own_cwd "$cwd" ;;
    *) return 1 ;;
  esac
}

TARGETS=''
FOUND=0
ROWS=''

while read -r pid ppid etime rest; do
  [ -n "${pid:-}" ] || continue
  case " $SKIP " in *" $pid "*) continue ;; esac
  kind='' marker=''
  case "$rest" in
    *--user-data-dir=*)
      udd=$(printf '%s' "$rest" | sed 's/.*--user-data-dir=//; s/ .*$//')
      own_profile "$udd" "$pid" || continue
      kind=chrome; marker="--user-data-dir=$udd"
      ;;
    *http.server*)
      case "$rest" in *python*) : ;; *) continue ;; esac
      cwd=$(proc_cwd "$pid" || true)
      [ -n "$cwd" ] || continue
      own_cwd "$cwd" || continue
      kind=server; marker="cwd=$cwd"
      ;;
    *) continue ;;
  esac
  FOUND=$((FOUND + 1))
  case "$LIVE_PIDS" in
    *" $pid "*) state=live-session ;;
    *) if [ "$ppid" = "1" ]; then state=orphan; else state=live-parent; fi ;;
  esac
  ROWS="$ROWS$(printf '%-7s %-6s %-11s %-7s %-12s %s' "$pid" "$ppid" "$etime" "$kind" "$state" "$marker")
"
  if [ "$state" = orphan ] || [ "$INCLUDE_LIVE" = 1 ]; then
    TARGETS="$TARGETS $pid"
  fi
done <<EOF
$(ps -axo pid=,ppid=,etime=,command=)
EOF

if [ "$FOUND" = 0 ] && [ -z "$STALE" ]; then
  printf 'l4-sweep: 소유 표지가 있는 잔여 프로세스 0건\n'
  exit 0
fi

if [ "$FOUND" != 0 ]; then
  printf '%-7s %-6s %-11s %-7s %-12s %s\n' PID PPID ETIME KIND STATE MARKER
  printf '%s' "$ROWS"
fi
[ -n "$STALE" ] && printf 'l4-sweep: 죽은 세션의 상태 파일:%s\n' "$STALE"

if [ "$KILL" != 1 ]; then
  printf 'l4-sweep: dry-run — 종료 대상%s (죽이려면 --kill)\n' "${TARGETS:- 없음}"
  exit 0
fi

# 프로세스가 모두 죽은 태그의 상태 파일은 잔재다 — 남겨 두면 같은 태그의 다음 up 이 막힌다.
purge_dead_states() {
  local f tag holders server
  for f in "$PROFILE_ROOT"/*.env; do
    [ -f "$f" ] || continue
    tag=${f##*/}; tag=${tag%.env}
    [ -n "$tag" ] || continue
    holders=$(pids_by_profile "$PROFILE_ROOT/$tag-chrome" || true)
    server=$(sed -n 's/^L4_SERVER_PID=//p' "$f" | tail -1)
    if [ -n "$holders" ]; then continue; fi
    if [ -n "$server" ] && alive "$server"; then continue; fi
    rm -rf "$PROFILE_ROOT/$tag-chrome"
    rm -f "$PROFILE_ROOT/$tag.env" "$PROFILE_ROOT/$tag-server.log"
    printf 'l4-sweep: [%s] 상태 파일 제거\n' "$tag"
  done
}

purge_dead_states

[ -n "$TARGETS" ] || { printf 'l4-sweep: 종료 대상 프로세스 없음\n'; exit 0; }

for pid in $TARGETS; do owned_now "$pid" && kill "$pid" 2>/dev/null || true; done
rest=''
for _ in 1 2 3 4 5 6; do
  rest=''
  for pid in $TARGETS; do alive "$pid" && rest="$rest $pid"; done
  [ -z "$rest" ] && break
  sleep 0.5
done
for pid in $rest; do owned_now "$pid" && kill -9 "$pid" 2>/dev/null || true; done

left=''
for pid in $TARGETS; do alive "$pid" && left="$left $pid"; done
purge_dead_states
printf 'l4-sweep: 종료 시도%s · 잔여%s\n' "$TARGETS" "${left:- 0건}"
