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
# run 이 실행하는 명령에는 L4_URL·L4_PORT·L4_PROFILE 이 환경변수로 전달되며,
# 그 명령이 L4_PROFILE 을 --user-data-dir 로 쓴 크롬도 정리 대상에 함께 들어간다.
# 비정상 종료(kill -9·크래시·재부팅)로 남은 잔여분은 scripts/l4-sweep.sh 가 걷는다.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd -P)
PROFILE_ROOT="$(printf '%s' "${TMPDIR:-/tmp}" | sed 's:/*$::')/grandmaster-dojo-l4"

CHROME_BIN=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

die() { printf 'l4-serve: %s\n' "$*" >&2; exit 1; }

# 브랜치명의 이슈 번호를 기본 태그로 쓴다 — 프로필 basename 이 그대로 소유 표지가 된다.
default_tag() {
  local branch
  branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')
  case "$branch" in
    issue-[0-9]*) printf '%s' "${branch#issue-}" | sed 's/[^0-9].*$//' ;;
    *) printf 'l4' ;;
  esac
}

sanitize_tag() { printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-'; }

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
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
}

alive() { kill -0 "$1" 2>/dev/null; }

# TERM 후 3초까지 기다렸다가 남은 것만 KILL 한다.
term_then_kill() {
  local pid rest
  for pid in "$@"; do alive "$pid" && kill "$pid" 2>/dev/null || true; done
  for _ in 1 2 3 4 5 6; do
    rest=''
    for pid in "$@"; do alive "$pid" && rest="$rest $pid"; done
    [ -z "$rest" ] && return 0
    sleep 0.5
  done
  for pid in $rest; do kill -9 "$pid" 2>/dev/null || true; done
}

state_get() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1; }

# 프로필 경로를 --user-data-dir 로 물고 있는 프로세스 전부 (크롬 본체 + 헬퍼).
pids_by_profile() {
  L4_PAT=$1 ps -axo pid=,command= \
    | awk 'index($0, "--user-data-dir=" ENVIRON["L4_PAT"]) { print $1 }'
}

stop_tag() {
  local tag=$1
  local state="$PROFILE_ROOT/$tag.env"
  local profile="$PROFILE_ROOT/$tag-chrome"
  local skip pid targets='' server
  skip=$(ancestor_pids)
  for pid in $(pids_by_profile "$profile"); do
    case " $skip " in *" $pid "*) continue ;; esac
    targets="$targets $pid"
  done
  server=$(state_get "$state" L4_SERVER_PID)
  if [ -n "$server" ] && alive "$server"; then
    case " $skip " in *" $server "*) : ;; *) targets="$targets $server" ;; esac
  fi
  if [ -n "$targets" ]; then
    printf 'l4-serve: 정리 대상 pid:%s\n' "$targets" >&2
    # shellcheck disable=SC2086
    term_then_kill $targets
  fi
  rm -rf "$profile"
  rm -f "$state" "$PROFILE_ROOT/$tag-server.log"
  printf 'l4-serve: [%s] 정리 완료 (남은 대상 0건)\n' "$tag" >&2
}

start_tag() {
  local tag=$1 port=$2 want_chrome=$3 headed=$4 url_path=$5
  local state="$PROFILE_ROOT/$tag.env" profile="$PROFILE_ROOT/$tag-chrome"
  mkdir -p "$PROFILE_ROOT"
  [ -f "$state" ] && die "[$tag] 세션이 이미 있다 — 먼저 down 하라 ($state)"
  port=$(pick_port "$port")

  ( cd "$REPO_ROOT" && exec python3 -m http.server "$port" --bind 127.0.0.1 ) \
    >"$PROFILE_ROOT/$tag-server.log" 2>&1 &
  local server_pid=$!
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
    printf 'L4_PORT=%s\n' "$port"
    printf 'L4_URL=%s\n' "$url"
    printf 'L4_ROOT=%s\n' "$REPO_ROOT"
    printf 'L4_PROFILE=%s\n' "$profile"
    printf 'L4_SERVER_PID=%s\n' "$server_pid"
    printf 'L4_CHROME_PID=%s\n' "$chrome_pid"
    printf 'L4_DEBUG_PORT=%s\n' "$dbg"
  } >"$state"

  L4_TAG=$tag L4_PORT=$port L4_URL=$url L4_PROFILE=$profile L4_DEBUG_PORT=$dbg
  export L4_TAG L4_PORT L4_URL L4_PROFILE L4_DEBUG_PORT
  printf 'l4-serve: [%s] url=%s server_pid=%s chrome_pid=%s profile=%s\n' \
    "$tag" "$url" "$server_pid" "${chrome_pid:--}" "$profile" >&2
}

cmd=${1:-}
[ -n "$cmd" ] || { usage; exit 2; }
shift || true

TAG='' PORT=8000 WANT_CHROME=0 HEADED=0 URL_PATH=/
CMDV=()
HAS_CMD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --url) URL_PATH=$2; shift 2 ;;
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
    start_tag "$TAG" "$PORT" "$WANT_CHROME" "$HEADED" "$URL_PATH"
    ;;
  down)
    stop_tag "$TAG"
    ;;
  run)
    [ "$HAS_CMD" = 1 ] || die "run 은 -- 뒤에 명령이 필요하다"
    trap 'stop_tag "$TAG"' EXIT INT TERM
    start_tag "$TAG" "$PORT" "$WANT_CHROME" "$HEADED" "$URL_PATH"
    rc=0
    "${CMDV[@]}" || rc=$?
    exit "$rc"
    ;;
  status)
    for f in "$PROFILE_ROOT"/*.env; do
      [ -f "$f" ] || { printf 'l4-serve: 활성 세션 없음\n'; break; }
      s=$(state_get "$f" L4_SERVER_PID); c=$(state_get "$f" L4_CHROME_PID)
      printf '%s url=%s server=%s(%s) chrome=%s(%s)\n' \
        "$(state_get "$f" L4_TAG)" "$(state_get "$f" L4_URL)" \
        "$s" "$(alive "$s" && echo alive || echo dead)" \
        "${c:--}" "$([ -n "$c" ] && { alive "$c" && echo alive || echo dead; } || echo -)"
    done
    ;;
  *) die "알 수 없는 서브커맨드: $cmd" ;;
esac
