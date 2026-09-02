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
# ASCII 는 로그·수치 표기가 언제든 새 글자를 꺼내므로 전량이 기준선이다.
F1_STATIC_RANGES='U+0020-007E,U+2190-21FF'

need() { command -v "$1" >/dev/null 2>&1 || { echo "필요한 도구가 없다: $1 (헤더의 venv 설치 절차 참조)" >&2; exit 1; }; }
need node
need pyftsubset
need fonttools
python3 -c 'import brotli' 2>/dev/null || {
  echo "brotli 모듈이 없다 — woff2 로 저장할 수 없다 (pip install brotli)" >&2; exit 1; }
for f in "$F1_REGULAR" "$F1_EXTRABOLD" "$NOTO_SERIF_KR_VF"; do
  [ -f "$f" ] || { echo "원본 폰트가 없다: $f (헤더의 내려받기 절차 참조)" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 한자만 F2 로 가른다 — index.html 의 unicode-range 분할과 같은 경계다.
node "$ROOT/scripts/check-font-coverage.mjs" --emit-charset > "$WORK/all.txt"
node -e '
const fs = require("node:fs");
const all = [...fs.readFileSync(process.argv[1], "utf8")];
const isHanja = (c) => { const o = c.codePointAt(0); return (o >= 0x3400 && o <= 0x9fff) || (o >= 0xf900 && o <= 0xfaff); };
fs.writeFileSync(process.argv[2], all.filter((c) => !isHanja(c)).join(""));
fs.writeFileSync(process.argv[3], all.filter(isHanja).join(""));
' "$WORK/all.txt" "$WORK/f1.txt" "$WORK/f2.txt"
echo "문자 집합 — 본문 $(node -e 'process.stdout.write(String([...require("node:fs").readFileSync(process.argv[1],"utf8")].length))' "$WORK/f1.txt")자 · 한자 $(node -e 'process.stdout.write(String([...require("node:fs").readFileSync(process.argv[1],"utf8")].length))' "$WORK/f2.txt")자"

subset() { pyftsubset "$1" --output-file="$2" --flavor=woff2 --layout-features='' --no-hinting "${@:3}"; }

# F1 — 나눔명조는 정적 TTF 2벌이라 weight 고정이 필요 없다.
subset "$F1_REGULAR"   "$OUT/NanumMyeongjo-subset-400.woff2" --text-file="$WORK/f1.txt" --unicodes="$F1_STATIC_RANGES"
subset "$F1_EXTRABOLD" "$OUT/NanumMyeongjo-subset-800.woff2" --text-file="$WORK/f1.txt" --unicodes="$F1_STATIC_RANGES"

# F2 — 가변 폰트를 먼저 한자로 좁힌 뒤 weight 를 고정한다 (22MB 를 그대로 instancing 하지 않으려고).
pyftsubset "$NOTO_SERIF_KR_VF" --output-file="$WORK/f2-vf.otf" --text-file="$WORK/f2.txt" --layout-features='' --no-hinting
for w in 400 800; do
  fonttools varLib.instancer -q -o "$WORK/f2-$w.otf" "$WORK/f2-vf.otf" "wght=$w"
  subset "$WORK/f2-$w.otf" "$OUT/NotoSerifKR-hanja-$w.woff2" --text-file="$WORK/f2.txt" --desubroutinize
done

ls -l "$OUT"/*.woff2
node "$ROOT/scripts/check-font-coverage.mjs"
