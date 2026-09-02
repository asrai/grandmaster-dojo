#!/usr/bin/env bash
# 서브셋 폰트 생성 (REQ-803 · REQ-930) — 개발자가 손으로 돌리는 스크립트다. CI 는 산출물
# (assets/fonts/*.woff2)만 검사하므로 `pyftsubset` 은 CI 의존성이 아니다.
#
#   bash scripts/subset-fonts.sh
#
# 문자 집합은 `check-font-coverage.mjs --emit-charset` 이 정한다 — 게이트와 생성기가 같은
# 수집기를 쓰므로 둘이 어긋날 수 없다. 서브셋은 **현재 빌드에 있는 글자**만 덮으니, 새 문구를
# 넣은 커밋마다 이 스크립트를 다시 돌려 산출물을 함께 커밋해야 한다. CI 커버리지 게이트가
# red 로 잡는 것이 정상 동작이며, 게이트를 우회하는 것은 두부(□) 출하와 같다.
#
# 필요한 도구 (전역 설치 금지 — venv 안에서):
#   python3 -m venv .venv && .venv/bin/pip install fonttools brotli
# F2 원본은 저장소에 없다 (22MB 가변 폰트). OFL 이므로 아래에서 받아 경로를 넘긴다:
#   curl -LO https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/Variable/OTF/Subset/NotoSerifKR-VF.otf
#   NOTO_SERIF_KR_VF=./NotoSerifKR-VF.otf bash scripts/subset-fonts.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/assets/fonts"
MOCKUPS="$ROOT/docs/design/1.02-화면-UI-아트-재설계/mockups/assets/fonts"

# F1 은 목업 실파일을 그대로 원본으로 쓴다 — 이관 대상이 곧 원본이라 출처가 갈리지 않는다.
F1_REGULAR="$MOCKUPS/NanumMyeongjo-Regular.ttf"
F1_EXTRABOLD="$MOCKUPS/NanumMyeongjo-ExtraBold.ttf"
NOTO_SERIF_KR_VF="${NOTO_SERIF_KR_VF:-$MOCKUPS/NotoSerifKR-VF.otf}"

# 방향 화살표는 성 계단 안내·이관 행이 쓰므로 사용 글자와 무관하게 통째로 싣는다 (REQ-803).
# ASCII 는 로그·수치 표기가 언제든 새 글자를 꺼내고, CJK 구두점은 주석 전용 기호가 몰려 있어
# 수집기가 과수집해도 게이트가 red 로 번지지 않게 한다.
F1_STATIC_RANGES='U+0020-007E,U+2190-21FF,U+3000-303F'

need() { command -v "$1" >/dev/null 2>&1 || { echo "필요한 도구가 없다: $1 (헤더의 venv 설치 절차 참조)" >&2; exit 1; }; }
need node
need pyftsubset
need fonttools
# brotli 는 pyftsubset 을 실제로 돌리는 인터프리터에 있어야 한다 — PATH 의 python3 이 그것과 다를 수 있다.
PYFT_PYTHON="$(sed -n '1s|^#!\([^ ]*\).*|\1|p' "$(command -v pyftsubset)")"
[ -x "${PYFT_PYTHON:-}" ] || PYFT_PYTHON=python3
"$PYFT_PYTHON" -c 'import brotli' 2>/dev/null || {
  echo "brotli 모듈이 없다 ($PYFT_PYTHON) — woff2 로 저장할 수 없다 (pip install brotli)" >&2; exit 1; }
for f in "$F1_REGULAR" "$F1_EXTRABOLD" "$NOTO_SERIF_KR_VF"; do
  [ -f "$f" ] || { echo "원본 폰트가 없다: $f (헤더의 내려받기 절차 참조)" >&2; exit 1; }
done

# 산출물이 커밋되는 바이너리라 실행 시각이 섞이면 내용 무변경에도 diff 가 난다 — fontTools 가
# 읽는 이 변수로 타임스탬프를 못박아 재실행이 같은 바이트를 내게 한다.
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-0}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 면이 담당하는 글자는 index.html 의 unicode-range 가 정한다 — 한자 경계를 여기서 다시 적으면
# 두 곳이 조용히 어긋난다.
emit() { node "$ROOT/scripts/check-font-coverage.mjs" --emit-charset "assets/fonts/$1" > "$WORK/$1.txt"; }

# F1 은 나눔명조 정적 TTF 2벌이라 weight 고정이 필요 없다.
for w in 400 800; do
  emit "NanumMyeongjo-subset-$w.woff2"
  if [ "$w" = 800 ]; then src="$F1_EXTRABOLD"; else src="$F1_REGULAR"; fi
  pyftsubset "$src" --output-file="$WORK/NanumMyeongjo-subset-$w.woff2" --flavor=woff2 \
    --layout-features='' --no-hinting \
    --text-file="$WORK/NanumMyeongjo-subset-$w.woff2.txt" --unicodes="$F1_STATIC_RANGES"
done

# F2 는 가변 폰트를 먼저 한자로 좁힌 뒤 weight 를 고정한다 (22MB 를 그대로 instancing 하지 않으려고).
# 두 weight 의 담당 범위가 같으므로 좁히기 입력은 한 벌이면 된다.
for w in 400 800; do emit "NotoSerifKR-hanja-$w.woff2"; done
pyftsubset "$NOTO_SERIF_KR_VF" --output-file="$WORK/f2-vf.otf" \
  --layout-features='' --no-hinting --text-file="$WORK/NotoSerifKR-hanja-400.woff2.txt"
for w in 400 800; do
  fonttools varLib.instancer -q -o "$WORK/f2-$w.otf" "$WORK/f2-vf.otf" "wght=$w"
  pyftsubset "$WORK/f2-$w.otf" --output-file="$WORK/NotoSerifKR-hanja-$w.woff2" --flavor=woff2 \
    --layout-features='' --no-hinting --desubroutinize \
    --text-file="$WORK/NotoSerifKR-hanja-$w.woff2.txt"
done

# 4벌이 다 만들어진 뒤에야 옮긴다 — 중간에 죽으면 새 F1 과 낡은 F2 가 섞인 트리가 남는다.
for f in NanumMyeongjo-subset-400 NanumMyeongjo-subset-800 NotoSerifKR-hanja-400 NotoSerifKR-hanja-800; do
  mv "$WORK/$f.woff2" "$OUT/$f.woff2"
done

ls -l "$OUT"/*.woff2
node "$ROOT/scripts/check-font-coverage.mjs"
