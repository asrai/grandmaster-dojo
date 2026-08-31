#!/bin/sh
# setup-githooks.sh — git config core.hooksPath 기반 훅 활성화 스크립트
#
# 소비 저장소에서 파일 위치:
#   scripts/setup-githooks.sh
#
# 사용법 (저장소 clone 한 머신에서 1회):
#   ./scripts/setup-githooks.sh
#
# 동작:
#   1) git config --local core.hooksPath scripts/githooks
#      → .git/hooks/ 대신 scripts/githooks/ 의 훅이 실행됨
#   2) scripts/githooks/ 하위 파일에 실행 권한 부여
#   3) gitleaks binary 설치 여부 확인 (경고만, 블록 안 함)
#
# 왜 core.hooksPath 방식?
#   - .git/hooks/ 는 clone 시 복제되지 않아 훅이 cross-machine 동기화 불가
#   - 저장소에 커밋되는 scripts/githooks/ 를 훅 디렉토리로 지정하면 훅 로직이
#     repo 와 함께 버전관리됨 (1번의 setup 명령만 머신별로 필요)
#   - husky / pre-commit framework 같은 언어 런타임 의존성 0
#
# 왜 별도 setup 스크립트?
#   - core.hooksPath 는 local config 라 repo 자체에 박아둘 수 없음 (머신별 설정)
#   - CONTRIBUTING.md 의 "클론 후 실행" 단일 엔트리로 수렴 가능

set -eu

cd "$(git rev-parse --show-toplevel)"

if [ ! -d scripts/githooks ]; then
    echo "Error: scripts/githooks 디렉토리가 없습니다."
    echo "       이 저장소는 git-native 훅 방식을 채택하지 않은 것으로 보입니다."
    exit 1
fi

git config --local core.hooksPath scripts/githooks

# 훅 디렉토리 전체에 실행 권한 부여 (Unix 계열에서만 의미 있음).
find scripts/githooks -type f -exec chmod +x {} +

echo "✅ Git hooks 활성화 완료 — core.hooksPath = scripts/githooks"
echo ""

if command -v gitleaks >/dev/null 2>&1; then
    echo "✅ gitleaks 감지: $(gitleaks version 2>&1 | head -1)"
else
    echo "⚠️  gitleaks 미설치. 다음 명령으로 설치:"
    echo "      brew install gitleaks"
    echo "   (hook 은 경고만 출력하고 커밋은 진행됨 — layer 1 방어가 꺼진 상태)"
fi

echo ""
echo "등록된 훅:"
ls -1 scripts/githooks | sed 's/^/  /'
