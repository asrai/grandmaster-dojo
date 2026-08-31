# Security Policy

## Supported Versions

현재 저장소는 활성 개발 중인 단일 `main` 브랜치만 유지합니다. 태그된 릴리즈가 생기기 전까지는 `main`의 최신 커밋만 보안 픽스 대상입니다.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| 그 외 | ❌ |

## Reporting a Vulnerability

취약점을 발견하셨다면 **공개 Issue로 열지 말고** 아래 경로로 비공개 보고해 주세요.

1. GitHub 저장소 상단의 `Security` 탭 → `Report a vulnerability` 버튼 (GitHub Private Vulnerability Reporting 채널)
2. 제출 양식에 재현 절차 + 영향 범위 + PoC(가능한 경우)를 포함

Private Vulnerability Reporting 채널은 저장소 Settings → Code security & analysis에서 **활성화되어 있어야 합니다** — 미활성 상태라면 `Security` 탭의 "Report a vulnerability" 버튼이 노출되지 않으니, 보고자는 저장소 관리자에게 문의해 활성화를 요청해 주세요. 활성화 시 제3자가 볼 수 없는 보고 스레드가 즉시 생성되며, 수리 전까지 세부 사항은 외부에 노출되지 않습니다.

## Response Timeline

- **72시간 이내**: 보고 접수 확인 응답
- **30일 이내**: 초기 영향 분석 + 수리 계획 공유
- **90일 (coordinated disclosure 관행)**: 수리 완료 후 공개. 복잡도에 따라 협의하여 연장 가능

## Out of Scope

다음 항목은 보안 보고 대상이 아닙니다 (대신 일반 Issue로 제출):

- UI 오타, 레이아웃 깨짐
- 이미 공개된 의존성 CVE (Dependabot이 별도 처리)
- 공식 GitHub Security Advisory가 이미 있는 취약점

## Credits

보고자가 요청하면 수리 공개 시점에 credit을 명시합니다. 익명 보고도 환영합니다.
