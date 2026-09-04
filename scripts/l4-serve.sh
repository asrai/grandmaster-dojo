#!/usr/bin/env bash
# L4 브라우저 검증의 서버·크롬 구동기 — 종료 정리를 이 스크립트가 진다.
# 즉석 명령으로 띄우면 정리를 물 자리가 없어 세션이 죽을 때 PPID=1 orphan 이 남는다 (#231).
#
# 사용법:
#   scripts/l4-serve.sh up   [--tag T] [--port N] [--chrome] [--headed] [--url PATH]
#   scripts/l4-serve.sh down [--tag T]
#   scripts/l4-serve.sh run  [위 옵션들] -- <명령...>
#   scripts/l4-serve.sh status
#
# up/down 은 여러 턴에 걸친 대화형 순회용이고, run 은 명령 하나를 감싸 trap 으로 정리한다.
# run 이 실행하는 명령에는 L4_URL·L4_PORT·L4_PROFILE·L4_DEBUG_PORT 가 환경변수로 전달되며,
# 그 명령이 L4_PROFILE 을 --user-data-dir 로 쓴 크롬도 정리 대상에 함께 들어간다.
# 비정상 종료(kill -9·크래시·재부팅)로 남은 잔여분은 scripts/l4-sweep.sh 가 걷는다.
# 태그 기본값은 브랜치의 이슈 번호이고, 프로필 basename 이 그대로 소유 표지가 된다.
#
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd -P)
PROFILE_ROOT="$(printf '%s' "${TMPDIR:-/tmp}" | sed 's:/*$::')/grandmaster-dojo-l4"

CHROME_BIN=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}

usage() { sed -n '/^# 사용법:/,/^#$/p' "$0" | sed 's/^# \{0,1\}//'; }

die() { printf 'l4-serve: %s\n' "$*" >&2; exit 1; }

need_value() { [ "$1" -ge 2 ] || die "$2 에는 값이 필요하다"; }

default_tag() {
  local branch
  branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')
  case "$branch" in
    issue-[0-9]*) printf '%s' "${branch#issue-}" | sed 's/[^0-9].*$//' ;;
    *) printf 'l4' ;;
  esac
}

sanitize_tag() { printf '%s' "$1" | tr -c 'A-Za-z0-9._' '-'; }

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

pick_port() {
  local p=$1 n=0
  while [ "$n" -lt 40 ]; do
    if port_busy "$p"; then p=$((p + 1)); n=$((n + 1)); else printf '%s' "$p"; return 0; fi
  done
  die "빈 포트를 못 찾았다 (시작 $1)"
}

# 자기 자신과 조상 체인은 어떤 경우에도 죽이지 않는다 (자상 방지).
ancestor_pids() {
  local p=$$
  while [ -n "$p" ] && [ "$p" != "0" ] && [ "$p" != "1" ]; do
    printf '%s\n' "$p"
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ' || true)
  done
}

alive() { kill -0 "$1" 2>/dev/null; }

# TERM 후 3초까지 기다렸다가 남은 것만 KILL 한다. 첫 인자는 pid 하나를 받아 「지금도
# 우리 것인가」를 답하는 함수 이름이다 — 대상이 죽고 같은 pid 가 재사용되면 그 사이
# 무관한 프로세스가 KILL 대상이 되므로, 시그널 직전마다 다시 묻는다.
term_then_kill() {
  local verify=$1 pid rest
  shift
  for pid in "$@"; do "$verify" "$pid" && kill "$pid" 2>/dev/null || true; done
  rest=''
  for _ in 1 2 3 4 5 6; do
    rest=''
    for pid in "$@"; do alive "$pid" && rest="$rest $pid"; done
    [ -z "$rest" ] && return 0
    sleep 0.5
  done
  for pid in $rest; do "$verify" "$pid" && kill -9 "$pid" 2>/dev/null || true; done
}

# pipefail 하에서 파일 부재 시 sed rc 를 삼키며, 부재 판정은 호출부가 맡는다 (#236).
state_get() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1 || true; }

# 상태 파일은 크래시 뒤에도 남으므로 pid 만으로는 신원이 아니다 — 재사용된 남의 pid 를
# 막으려면 기록해 둔 cwd·포트까지 실제 프로세스와 대조해야 한다.
is_our_server() {
  local pid=$1 root=$2 port=$3 cwd
  [ -n "$pid" ] && [ -n "$root" ] && [ -n "$port" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  ps -o command= -p "$pid" 2>/dev/null | grep -q "http\.server $port" || return 1
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true)
  [ "$cwd" = "$root" ]
}

# 프로필 경로를 --user-data-dir 로 물고 있는 프로세스 전부 (크롬 본체 + 헬퍼).
# 값 뒤가 공백이거나 줄 끝일 때만 일치시켜, 접두가 같은 남의 프로필을 삼키지 않는다.
pids_by_profile() {
  [ -n "${1:-}" ] || die "내부 오류: 빈 프로필 경로로는 조회하지 않는다"
  ps -axo pid=,command= | L4_PAT=$1 awk '
    { pat = "--user-data-dir=" ENVIRON["L4_PAT"]; i = index($0, pat)
      if (i == 0) next
      tail = substr($0, i + length(pat), 1)
      if (tail == "" || tail == " ") print $1 }'
}

# term_then_kill 이 시그널 직전마다 묻는 술어 — 프로필 보유자이거나 기록된 그 서버여야 한다.
# shellcheck disable=SC2329  # term_then_kill 이 이름으로 호출한다
still_ours() {
  local pid=$1
  alive "$pid" || return 1
  if [ "$pid" = "${VERIFY_SERVER:-}" ]; then
    is_our_server "$pid" "${VERIFY_ROOT:-}" "${VERIFY_PORT:-}"
    return $?
  fi
  pids_by_profile "${VERIFY_PROFILE:-}" | grep -qx "$pid"
}

stop_tag() {
  local tag=$1
  local state="$PROFILE_ROOT/$tag.env"
  local profile="$PROFILE_ROOT/$tag-chrome"
  local skip pid targets='' server root port server_unknown=''
  VERIFY_PROFILE=$profile
  skip=$(ancestor_pids)
  for pid in $(pids_by_profile "$profile"); do
    case " $skip " in *" $pid "*) continue ;; esac
    targets="$targets $pid"
  done
  server=$(state_get "$state" L4_SERVER_PID)
  root=$(state_get "$state" L4_ROOT)
  port=$(state_get "$state" L4_PORT)
  if [ -z "$server" ]; then server=${SERVER_PID:-}; root=${SERVER_ROOT:-}; port=${SERVER_PORT:-}; fi
  if [ -z "$server" ]; then
    server_unknown=1
    if [ -f "$state" ]; then
      printf 'l4-serve: [%s] 상태 파일에 서버 좌표 없음: %s · 서버는 미확인 — scripts/l4-sweep.sh --kill 로 확인\n' "$tag" "$state" >&2
    else
      printf 'l4-serve: [%s] 상태 파일 없음: %s · 서버는 미확인 — scripts/l4-sweep.sh --kill 로 확인\n' "$tag" "$state" >&2
    fi
  fi
  VERIFY_SERVER=$server VERIFY_ROOT=$root VERIFY_PORT=$port
  if is_our_server "$server" "$root" "$port"; then
    case " $skip " in *" $server "*) : ;; *) targets="$targets $server" ;; esac
  fi
  if [ -n "$targets" ]; then
    printf 'l4-serve: 정리 대상 pid:%s\n' "$targets" >&2
    for pid in $targets; do
      ps -o pid=,command= -p "$pid" 2>/dev/null | cut -c1-120 >&2 || true
    done
    # shellcheck disable=SC2086
    term_then_kill still_ours $targets
  fi
  rm -rf "$profile"
  rm -f "$state" "$PROFILE_ROOT/$tag-server.log"
  local left=''
  for pid in $targets; do alive "$pid" && left="$left $pid"; done
  printf 'l4-serve: [%s] 정리 완료 · 잔여%s%s\n' "$tag" "${left:- 0건}" "${server_unknown:+ (서버 미확인)}" >&2
}

start_tag() {
  local tag=$1 port=$2 want_chrome=$3 headed=$4 url_path=$5 mode=$6
  local state="$PROFILE_ROOT/$tag.env"
  local profile="$PROFILE_ROOT/$tag-chrome"
  mkdir -p "$PROFILE_ROOT"
  chmod 700 "$PROFILE_ROOT"
  [ -f "$state" ] && die "[$tag] 세션이 이미 있다 — 먼저 down 하라 ($state)"
  port=$(pick_port "$port")

  ( cd "$REPO_ROOT" && exec python3 -m http.server "$port" --bind 127.0.0.1 ) \
    >"$PROFILE_ROOT/$tag-server.log" 2>&1 &
  local server_pid=$!
  SERVER_PID=$server_pid
  SERVER_PORT=$port
  SERVER_ROOT=$REPO_ROOT
  OWNED=1
  sleep 0.4
  alive "$server_pid" || die "서버가 즉시 종료했다 — $PROFILE_ROOT/$tag-server.log 를 보라"
  local url="http://127.0.0.1:$port$url_path"

  local chrome_pid='' dbg=''
  if [ "$want_chrome" = 1 ]; then
    [ -x "$CHROME_BIN" ] || { kill "$server_pid" 2>/dev/null || true; die "크롬 실행 파일이 없다: $CHROME_BIN"; }
    mkdir -p "$profile"
    dbg=$(pick_port 9222)
    set -- --user-data-dir="$profile" --remote-debugging-port="$dbg" \
      --no-first-run --no-default-browser-check \
      --autoplay-policy=no-user-gesture-required --window-size=500,1029
    [ "$headed" = 1 ] || set -- --headless=new --disable-gpu "$@"
    "$CHROME_BIN" "$@" "$url" >>"$PROFILE_ROOT/$tag-server.log" 2>&1 &
    chrome_pid=$!
  fi

  {
    printf 'L4_TAG=%s\n' "$tag"
    printf 'L4_MODE=%s\n' "$mode"
    printf 'L4_OWNER_PID=%s\n' "$([ "$mode" = run ] && printf '%s' "$$")"
    printf 'L4_PORT=%s\n' "$port"
    printf 'L4_URL=%s\n' "$url"
    printf 'L4_ROOT=%s\n' "$REPO_ROOT"
    printf 'L4_PROFILE=%s\n' "$profile"
    printf 'L4_SERVER_PID=%s\n' "$server_pid"
    printf 'L4_CHROME_PID=%s\n' "$chrome_pid"
    printf 'L4_DEBUG_PORT=%s\n' "$dbg"
  } >"$state.tmp"
  mv -f "$state.tmp" "$state"

  L4_TAG=$tag L4_PORT=$port L4_URL=$url L4_PROFILE=$profile L4_DEBUG_PORT=$dbg
  export L4_TAG L4_PORT L4_URL L4_PROFILE L4_DEBUG_PORT
  printf 'l4-serve: [%s] url=%s server_pid=%s chrome_pid=%s profile=%s\n' \
    "$tag" "$url" "$server_pid" "${chrome_pid:--}" "$profile" >&2
}

# trap 본문 — 감싼 명령을 먼저 걷어야 세션 정리가 그 뒤에서 돈다. 자식이 foreground 면
# bash 가 trap 을 그 자식이 끝날 때까지 미루므로 run 은 자식을 background 로 두고 wait 한다.
# shellcheck disable=SC2329  # trap 으로만 호출된다
run_cleanup() {
  # 각 단계를 if 로 쓴다 — `a && b` 형태는 이미 끝난 자식에 대한 kill 실패가
  # set -e 로 이 함수를 그 자리에서 끊어 정리를 통째로 건너뛴다.
  if [ -n "${CMD_PID:-}" ]; then kill "$CMD_PID" 2>/dev/null || true; fi
  if [ "${OWNED:-0}" = 1 ]; then OWNED=0; stop_tag "$TAG"; fi
  return 0
}

cmd=${1:-}
[ -n "$cmd" ] || { usage; exit 2; }
shift || true

TAG='' PORT=8000 WANT_CHROME=0 HEADED=0 URL_PATH=/
OWNED=0 SERVER_PID='' SERVER_PORT='' SERVER_ROOT=''
VERIFY_PROFILE='' VERIFY_SERVER='' VERIFY_ROOT='' VERIFY_PORT=''
CMDV=()
HAS_CMD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) need_value $# --tag; TAG=$2; shift 2 ;;
    --port)
      need_value $# --port
      case "$2" in ''|*[!0-9]*) die "--port 는 정수다: $2" ;; esac
      PORT=$2; shift 2 ;;
    --url) need_value $# --url; URL_PATH=$2; shift 2 ;;
    --chrome) WANT_CHROME=1; shift ;;
    --headed) HEADED=1; WANT_CHROME=1; shift ;;
    --) shift; HAS_CMD=1; while [ $# -gt 0 ]; do CMDV[${#CMDV[@]}]=$1; shift; done ;;
    -h|--help) usage; exit 0 ;;
    *) die "알 수 없는 인자: $1" ;;
  esac
done
[ -n "$TAG" ] || TAG=$(default_tag)
TAG=$(sanitize_tag "$TAG")

case "$cmd" in
  up)
    start_tag "$TAG" "$PORT" "$WANT_CHROME" "$HEADED" "$URL_PATH" up
    ;;
  down)
    stop_tag "$TAG"
    ;;
  run)
    { [ "$HAS_CMD" = 1 ] && [ "${#CMDV[@]}" -gt 0 ]; } || die "run 은 -- 뒤에 명령이 필요하다"
    # 세션을 실제로 획득한 뒤에만 정리한다 — 중복 태그로 거절당한 실행이
    # 남의 살아있는 세션을 걷어 버리는 것을 막는 플래그다.
    OWNED=0
    CMD_PID=''
    trap run_cleanup EXIT
    trap 'run_cleanup; trap - EXIT; exit 130' INT TERM
    start_tag "$TAG" "$PORT" "$WANT_CHROME" "$HEADED" "$URL_PATH" run
    "${CMDV[@]}" &
    CMD_PID=$!
    rc=0
    wait "$CMD_PID" || rc=$?
    exit "$rc"
    ;;
  status)
    found=0
    for f in "$PROFILE_ROOT"/*.env; do
      [ -f "$f" ] || continue
      found=1
      s=$(state_get "$f" L4_SERVER_PID); c=$(state_get "$f" L4_CHROME_PID)
      printf '%s mode=%s owner=%s url=%s server=%s(%s) chrome=%s(%s)\n' \
        "$(state_get "$f" L4_TAG)" "$(state_get "$f" L4_MODE)" \
        "$(state_get "$f" L4_OWNER_PID)" "$(state_get "$f" L4_URL)" \
        "$s" "$(alive "$s" && echo alive || echo dead)" \
        "${c:--}" "$([ -n "$c" ] && { alive "$c" && echo alive || echo dead; } || echo -)"
    done
    [ "$found" = 1 ] || printf 'l4-serve: 활성 세션 없음\n'
    ;;
  *) die "알 수 없는 서브커맨드: $cmd" ;;
esac
