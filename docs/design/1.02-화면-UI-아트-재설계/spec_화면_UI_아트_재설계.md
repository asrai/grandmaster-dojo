---
project: 일대종사
spec: 화면-UI-아트-재설계
agenda: 화면 UI·아트 재설계
source_ui: ui_화면_UI_아트_재설계
game_repo: https://github.com/asrai/grandmaster-dojo
engine: HTML5 (vanilla JS, zero dependency, no build step)
art_contract: true
vault_path: docs/design/1.02-화면-UI-아트-재설계/spec_화면_UI_아트_재설계.md
created: 2026-09-02 13:10
updated: 2026-09-02 14:26
tags:
  - 게임개발
  - 문서유형/설계서
---
# 화면 UI·아트 재설계 — Spec

**안건**: 화면 UI·아트 재설계 (일대종사 / 화면-UI-아트-재설계)
**생성**: /gamedev-spec v0.19 (ui 모드 · 통합 spec 구조 룰), 2026-09-02
**소스**: [[ui_화면_UI_아트_재설계]] (`/gamedev-ui` 결정 로그 — `progress: complete`, 7화면 확정 · 횡단 결정 D-1~D-9 · 에셋 원장 · 구현 가능성 체크 1회. debate·critic 미경유가 정상 — 시안 핑퐁이 토의를 대체)

---

## 개요

현행 v2 빌드는 코어 루프가 전부 동작하지만 화면은 v0 시절의 **다크 카드 리스트 = 관리 대시보드 톤**이다. 본 spec 은 **판정·입력·성장 규칙을 건드리지 않고 화면의 시각 언어를 무협으로 옮긴다** — 팔레트·서체·한자 조판 재정의, 6단 판정 다중 부호화, 게임필(juice + 기본 사운드), 대련·파견의 빈 공간을 아레나(배경 레이어 + 먹 실루엣 2인)로 전환, 그리고 7화면 전부의 이식.

**규칙 SoT 관계**: 판정·성장·해금 규칙의 SoT 는 [[spec_프로토타입_v2_통합_PRD]] 와 [[spec_성_축_초식_단위_재설계]] 다. 본 spec 은 그 규칙이 **어떻게 보이고 들리는가**를 정의하며, 예외적으로 § ⑨ 가 두 spec 의 **용어·공개 조건 개정 5건**(냥 · 초 · 창안자 · 전리품 · REQ-732)을 동반한다.

**구조상의 선행**: § ⓪ 의 B6(싱글턴 크롬 해체)는 7화면 전부를 막는 단일 구조 변경이다. 화면 이식 7종은 전부 그 뒤에 온다 — `/gamedev-build` 분해 시 REQ-801 이 첫 유닛이고 § ②~⑧ 이 그 뒤다.

**스코프 밖**: 정보 구조·화면 전환 흐름의 재설계 · 로컬라이즈(M3) · 접근성 옵션 UI 노출(M3, 단 색 이외 부호화는 본 spec 이 이미 다룬다).

## 구현 스펙

### ⓪ 선행 구조 변경 (화면 이식보다 먼저)

목업이 답할 수 없는 층. **7화면 전부가 이 블록에 막혀 있다** — 축소해도 줄지 않는 고정비다.

#### 요구사항 (EARS)

- **REQ-801** *(Ubiquitous)*: The system shall 화면별 렌더가 상단 띠·본문·하단부를 각자 소유하도록 싱글턴 크롬(`#top`·`#screen`·`#band`·`#pad`)을 해체하고, `app.mjs` 의 `$('label')`·`$('coins')`·`$('a11y')` 참조를 화면 렌더로 이주시킨다. 화면은 스테이지(393×852) 안에서 **풀블리드 레이어를 y=0 부터** 배치할 수 있어야 한다.
- **REQ-802** *(Ubiquitous)*: The system shall 상단 띠를 **화면별 선택 요소**로 취급한다 — S6 결과는 상단 띠 없이 무대가 y=0 에서 시작하고, `#screen{padding:12px; gap:12px}` 같은 전역 여백이 화면 콘텐츠에 강제되지 않는다. *(depends: REQ-801)*
- **REQ-803** *(Ubiquitous)*: The system shall 한글 명조(F1)를 **사용 글자 집합 기반 서브셋 woff2 2벌**(400/800)로 대체하고 `preload` 로 물리며, 문자 집합 커버리지를 CI 게이트로 검사한다. 서브셋 스크립트는 `scripts/subset-fonts.sh` 로 커밋한다. 문자 집합은 한글·라틴 본문에 더해 **기호류 `U+2190-21FF`(방향 화살표)를 포함**한다.
- **REQ-804** *(Unwanted)*: If 빌드에 쓰인 문자 중 서브셋 폰트가 커버하지 못하는 글리프가 하나라도 있으면, then the CI shall 해당 글자를 열거하며 실패한다. *(depends: REQ-803)*
- **REQ-805** *(Ubiquitous)*: The system shall 죽간 렌더러를 `pad.mjs` 에서 분리해 **십자 키패드 없이도 죽간만** 장착할 수 있게 한다 — S4 파견은 키패드가 없고, S3 수련은 죽간 1매 + 해설이다.
- **REQ-806** *(Ubiquitous)*: The system shall 판정 오버레이를 **시각 층과 낭독 층으로 분리**한다 — 시각 오버레이는 아레나 좌표계 안에 살고, `aria-live` 라이브 리전은 화면 생성·파괴와 무관하게 스테이지 직속으로 상주한다.
- **REQ-807** *(Unwanted)*: If 화면 전환으로 판정 오버레이 노드가 파괴되면, then the system shall 라이브 리전을 파괴하지 않고 유지해 판정 낭독이 침묵하지 않게 한다. *(depends: REQ-806)*

### ① 공통 시각 언어 (7화면이 상속하는 원장)

`§ ②~⑧` 의 모든 화면이 이 블록의 팔레트·서체·부호화·컴포넌트를 상속한다. **스타일 SoT 는 이 블록 하나이며, 화면별 재정의를 두지 않는다.**

#### 요구사항 (EARS)

- **REQ-810** *(Ubiquitous)*: The system shall 색을 **9종 토큰 원장 C1~C9 하나로만** 정의하고 화면·컴포넌트가 그 토큰을 참조하게 한다. 근거: `duel_v5_input.png` · 초기값 — C1 먹 심 `#12100e` / C2 먹 중 `#1e1a16` / C3 화선지 `#e8dcc8` / C4 금 `#c9a227` / C5 주사 `#a8332a` / C6 쾌 `#5fb3e8` / C7 강 `#e05a4d` / C8 정 `#4fbf7f` / C9 화선지 면 `#cdbb9c`.
- **REQ-811** *(Ubiquitous)*: The system shall C5(주사)를 **막힘·경고 전용**으로 고정한다 — 8성 벽 · 파견 잠금 · 패배 · 소문의 경계 · 낙관. 「이미 이긴 상대」처럼 막힘이 아닌 상태에는 쓰지 않는다. *(depends: REQ-810)*
- **REQ-812** *(Ubiquitous)*: The system shall 서체를 **명조 단일 계열**로 통일한다 — F1(한글·라틴 본문, 400/800) · F2(한자 보조 병기 전용, 400/800). 시스템 산세리프를 표면에 남기지 않는다. *(depends: REQ-803)*
- **REQ-813** *(Ubiquitous)*: The system shall **한글을 주 표기, 한자를 보조 병기**로 조판한다 — 한자만으로 쓰인 표기는 화면에 존재하지 않으며, 한자는 한글 옆 세로열 또는 아래에 작게(9~26px) 붙는다. 판정 오버레이도 예외가 아니다(대형 글자 = 「완파」, 「破」는 그 위 낙관 격). 한자 병기는 **단일 클래스 `.hj` 한 곳**으로 통일해 「한자 전면 제거」가 한 규칙 변경으로 닫히게 한다.
- **REQ-814** *(Ubiquitous)*: The system shall 6단 판정을 **4중 부호화**로 표시한다 — 위치(위=적이 맞음 / 중앙=상쇄 / 아래=내가 맞음) · 크기(완파·역파 96px > 우세·열세 66 > 상쇄 54, 피격 80) · 색(금·청 / 회 / 적) · 자형. 완파 ↔ 역파는 **상하 대칭**으로 배치해 위치 자체가 승패를 말한다. 근거: `duel_v4_crush.png` · `duel_v3_reversal.png`. *(depends: REQ-810)*
- **REQ-815** *(Event-driven)*: When 판정이 완파 또는 역파일 때, the system shall 화면 흔들림을 발화한다. **그 외 4등급에는 흔들지 않는다** — 흔들림은 크기 축과 같은 극단 2등급에만 배정된 부호화 축이다. *(depends: REQ-814)*
- **REQ-816** *(Ubiquitous)*: The system shall 흔들림을 스테이지(`transform: scale(var(--k))` 보유) 가 아니라 **내부 `.shell` 래퍼**에 건다 — 스테이지에 걸면 완파·역파마다 스케일이 날아가 화면이 100% 로 튄다. *(depends: REQ-815)*
- **REQ-817** *(Ubiquitous)*: The system shall 성(成) 계단을 **단일 컴포넌트**로 정의해 S2·S3·S5·S6 이 같은 클래스(`.st`/`.on`)를 공유하게 한다 — 12칸 눈금 · 지난 칸 금 충전 · 현재 칸 부분 채움 · **7↔8 사이 주사색 세로선(8성 벽)** · 11칸 `◆`·12칸 `✦` **형태 부호화는 CSS 도형**(유니코드 글리프 아님). 근거: `dojo_v2_growth.png`.
- **REQ-818** *(Unwanted)*: If 어떤 칸이 「8성 벽」이면서 동시에 「이번 판에 오른 칸」이면, then the system shall 두 규칙을 조합 규칙(`.st.on.wall` · `.st.gain.wall`)으로 해소해 발광이 벽 스타일에 먹히지 않게 한다. *(depends: REQ-817)*
- **REQ-819** *(Ubiquitous)*: The system shall 속성 3종을 **색 + 형태 병기**(▲쾌 / ●강 / ■정)로 계승한다 — 현행의 유일한 접근성 성공 자산이므로 축을 줄이지 않는다. *(depends: REQ-810)*

### ② S1 대련 — 아레나와 6단 판정의 착지점

나머지 4화면이 여기서 시각 언어를 상속한다. 근거 시안 `duel_v5_input.png`(채택 v5) · `duel_v5_telegraph.png` · `duel_v5_narrow.png` · `duel_v4_crush.png` · `duel_v3_reversal.png`.

#### 요구사항 (EARS)

- **REQ-820** *(Ubiquitous)*: The system shall 대련 화면을 **상단 띠 50 / 아레나 440 / 입력부 362 의 3단 고정**으로 구성한다. 초기값은 시안 실측이며 튜닝 대상이다. *(depends: REQ-802)*
- **REQ-821** *(Ubiquitous)*: The system shall 아레나를 **레이어 스택**으로 그린다 — 원경 산 · 중경 대나무 · 안개 · 비네트 · 지면, 그 위에 먹 실루엣 2인을 대각 대치로 배치하고 각 실루엣 뒤에 **역광(radial glow)** 을 둔다. 역광 없이는 먹 실루엣이 어두운 배경에서 사라진다. *(depends: REQ-820)*
- **REQ-822** *(Ubiquitous)*: The system shall 상대 예고를 **아레나 최상단 가로 스트립**에 고정한다 — 중앙은 판정 오버레이가 쓰는 자리이므로 예고가 점유하지 않는다. *(depends: REQ-820)*
- **REQ-823** *(Ubiquitous)*: The system shall 응수 창을 **아레나 하단 가장자리 전폭 게이지**로 분리한다 — 시간 압박은 아레나에 속한 정보이며, 실루엣을 보는 동안 주변시로 읽혀야 한다. **응수 창을 숫자 초로 표기하지 않는다**(D-5 초(招)↔초(秒) 충돌 회피). *(depends: REQ-820)*
- **REQ-824** *(State-driven)*: While 응수 창이 열려 있는 동안, the system shall 남은 후보 수만큼 죽간을 그린다(최대 4매, 중앙 정렬) — 4매 84px → 2매 132 → **1매 172 + 금테 확대**. 개수 감소 자체가 「좁혀진다」의 표현이고, 1매 = 확정이 화면에서 가장 큰 사건이 된다. 근거: `duel_v5_narrow.png`. *(depends: REQ-805, REQ-820)*
- **REQ-825** *(Event-driven)*: When 후보가 탈락할 때, the system shall 해당 죽간을 **짧게 흐려지며 가라앉는 exit 전이**로 제거한다 — 즉시 삭제하면 필터링 과정이 화면에서 사라진다. 죽간 렌더러는 개수 변화에 대해 **enter/exit 상태를 가진다**(후보가 바뀔 때마다 전량 재생성하지 않는다). *(depends: REQ-824)*
- **REQ-826** *(Unwanted)*: If 마지막 키가 「후보 1개 도달」과 「시퀀스 완주」를 겸해 확정 연출이 한 프레임도 보이지 않게 되면, then the system shall `.only` 금테 확대를 **최소 표시 시간 동안 유지**하고 그동안 판정 오버레이를 대기시킨다. 최소 시간 값은 밸런스 튜닝 대상이다. *(depends: REQ-824)*
- **REQ-827** *(Ubiquitous)*: The system shall 죽간 1매에 **속성 기호 · 성 배지 · 초식명(한글) · 한자 우측 세로열**을 한 행에 싣는다 — 위력이 `powerOf(성)` 이라 속성과 성이 한 쌍으로 위력을 정하므로(REQ-721) 둘을 갈라 두지 않는다. 탈락 죽간의 성은 회색으로 죽고 살아있는 후보의 성만 금색으로 남는다. *(depends: REQ-813, REQ-819, REQ-824)*
- **REQ-828** *(Ubiquitous)*: The system shall 진행형 후보 색을 **입력부 상단 전폭 발광 띠**로, 입력 트레일을 **28px** 로 표시한다 — 「지금 내 색」과 「몇 번째 글자를 받고 있는가」가 화면에서 가장 중요한 피드백이다. 초기값은 시안 실측(현행 12px 대비 확대). *(depends: REQ-820)*
- **REQ-829** *(Ubiquitous)*: The system shall 방향 키패드를 **화면 정중앙**에, 입력 되돌리기를 **우측 끝 · 오른쪽 화살표와 같은 행·같은 크기(64×58)** 에 둔다 — 키 간격 7px 대 되돌리기까지 21px, 간격 3배가 별개 그룹의 신호다. 오조작 비용이 정반대인 두 조작을 한 flex 행에 묶지 않는다. *(depends: REQ-820)*

### ③ S2 도장 — 홈, 성 계단이 사는 곳

근거 시안 `dojo_v2_growth.png`(채택 v2) · `dojo_v2_disciple.png`.

#### 요구사항 (EARS)

- **REQ-830** *(Ubiquitous)*: The system shall 초식 행마다 **성 게이지(12칸 계단) + 다음 계단 안내 한 줄**을 표시한다 — 「다음 9성 — 대련 유효 성공」 · 「다음 5성 — 파운현월이 열린다」 · 「다음 8성 — 수련은 여기까지, 대련으로만」(주사색). 적립 수단이 구간마다 바뀌는 규칙(REQ-707)이 게이지 밖 설명문에만 있으면 화면은 다시 숫자만 남는다. *(depends: REQ-817)*
- **REQ-831** *(State-driven)*: While 초식이 만성(12성)이거나 잠겨 있는 동안, the system shall 그 행의 게이지를 접고 **성 배지만** 남기며, 12성 행에서는 「수련」 버튼도 제거한다 — 전부 금색 / 전부 빈 칸은 정보량이 0인데 세로를 행마다 먹는다. 회수한 세로가 제자 블록의 자리다. *(depends: REQ-830)*
- **REQ-832** *(Ubiquitous)*: The system shall 무공 카드의 크롬(테두리·배경·색띠)을 벗겨 **머리글 한 줄**로 대체한다 — 목록을 감싼 카드가 목록을 또 하나의 패널로 만든다.
- **REQ-833** *(Ubiquitous)*: The system shall **제자 블록**을 신설한다 — 수련 지정 · 진척 막대 · 남은 시간 · 초식별 성 4열(REQ-752). 제자의 **존재·정서는 도장 정경의 실루엣이, 조작·수치는 이 블록이** 맡는 역할 분리다. *(depends: REQ-831)*
- **REQ-834** *(Ubiquitous)*: The system shall 홈에 **다음 상대 요약 1건만** 두고, 이긴 도전자 전체 목록은 S7 도전자 선택 화면이 진다 — 목록은 그 행동의 진입 화면에 속하지 홈에 속하지 않는다. 홈은 「지금 무엇을 할 수 있나」의 요약이다.
- **REQ-835** *(Event-driven)*: When 다음 상대가 절초 파해가 공개된 도전자일 때, the system shall 홈의 다음 상대 요약에도 **예고 화면과 동일한 공개 층**의 정보를 표시한다 — 같은 정보를 두 화면에서 다르게 주면 예고 화면이 함정이 된다. *(depends: REQ-834, REQ-894)*
- **REQ-836** *(Unwanted)*: If 파견이 성 미달로 잠겨 있으면, then the system shall 버튼에서 **잠긴 이유까지 읽히게** 한다 — 「행운유수 3성 · 권장 5성」. 하드 잠금(REQ-743)의 이유가 같은 자리에서 끝나야 한다.
- **REQ-837** *(Ubiquitous)*: The system shall 도장 정경을 배너로 두고 그 안에 **사부·제자 실루엣과 도장 현판**을 배치하며, 본문 영역은 잘림 대신 세로 스크롤로 넘친다(`overflow-y:auto`) — 문구가 2줄로 접혔을 때 제자 블록부터 조용히 잘리는 실패 모드를 막는다.

### ④ S3 수련 — 실전과 손의 좌표를 맞추는 화면

근거 시안 `train_v4_input.png`(채택 v4) · `train_v4_success.png`.

#### 요구사항 (EARS)

- **REQ-840** *(Ubiquitous)*: The system shall 수련 화면을 **S1 과 픽셀 단위로 같은 3단**(상단 띠 50 / 수련장 440 / 입력부 362)으로 구성한다 — 전이를 만드는 것은 규칙의 동일함이 아니라 좌표의 동일함이다. *(depends: REQ-820)*
- **REQ-841** *(Ubiquitous)*: The system shall 구결 족자를 **기능 요소**로 쓴다 — 3구절이 방향 한 개씩에 1:1 대응하고, 친 만큼 점등되며 남은 구절은 흐려진다. 딜레이드 힌트(REQ-712, 수련은 0)가 이 점등으로 구현된다.
- **REQ-842** *(Ubiquitous)*: The system shall 족자를 **화면에서 유일하게 밝은 면**(C9 화선지 면)으로 렌더하고 상하 축 + 주사 낙관을 둔다 — 화선지를 글자색이 아니라 표면으로 쓰는 유일한 자리다. *(depends: REQ-810)*
- **REQ-843** *(Ubiquitous)*: The system shall 수련 화면의 죽간을 **1매(수련 대상 초식)만** 표시한다 — 수련에는 후보 필터가 없고, 다른 초식을 후보처럼 늘어놓으면 「지금 무엇을 익히는가」가 흐려진다. *(depends: REQ-805)*
- **REQ-844** *(Ubiquitous)*: The system shall 비운 자리에 **초식 해설 3줄(창안 / 특성 / 파해)** 을 둔다 — 파해 1:1 대응(REQ-731)이 지금까지 비급 구결 텍스트에만 있었고(REQ-207), 수련은 그 초식만 보는 유일한 화면이라 해설의 제자리다. 「창안」 줄의 값은 § ⑨ 의 창안자 필드가 채운다. *(depends: REQ-891)*
- **REQ-845** *(Ubiquitous)*: The system shall 수련 진척을 **3칸 계단 + 다음 성 안내**로 표시한다 — 「수련 3회 = 1성」(REQ-702)이 정확히 3칸이고, S2 의 계단 언어를 상속한다. *(depends: REQ-817)*
- **REQ-846** *(Event-driven)*: When 수련 시퀀스를 완주했을 때, the system shall 대형 「성공 / 成功」을 **실전 판정 오버레이와 같은 자리·같은 조판**으로 표시하고, **실패에는 아무 표시도 하지 않는다**(#46 비대칭 승계). *(depends: REQ-813, REQ-814)*

### ⑤ S4 파견 관전 — 아레나를 상속하고 손을 뺀다

근거 시안 `dispatch_v1_beckon.png`(채택 v1) · `dispatch_v1_auto.png` · `dispatch_v1_crush.png`.

#### 요구사항 (EARS)

- **REQ-850** *(Ubiquitous)*: The system shall 파견 관전 화면이 **S1 아레나를 통째로 상속**하게 한다 — 레이어 스택·역광·비네트·기력 2·상대 예고·응수 창이 전부 같은 좌표이며, 바뀌는 것은 아레나에 서는 사람뿐이다(사부 → 제자). 상속이 곧 서사다. *(depends: REQ-821, REQ-822, REQ-823)*
- **REQ-851** *(Ubiquitous)*: The system shall **키패드가 있던 자리를 비운다** — S1 에서 손이 있던 하단 362px 의 십자·되돌리기·트레일이 이 화면에는 없다. 그 자리를 다른 조작으로 메우면 「손 놓고 보는 것」(REQ-407)이 사라진다. *(depends: REQ-805, REQ-850)*
- **REQ-852** *(Ubiquitous)*: The system shall 비운 손자리에 **제자의 판단**을 표시한다 — 「우세를 골랐다 — 유운보 ▲」 + 지난 수 한 줄. 관전의 콘텐츠는 제자의 판단 그 자체다. *(depends: REQ-851, REQ-853)*
- **REQ-853** *(Ubiquitous)*: The system shall 제자 초식 선택 로직(REQ-403: 우세 → 상쇄 → 역파 회피)이 **선택 결과와 함께 선택 이유를 반환**하게 한다 — 현행 `selectDiscipleStyle` 은 이유를 내보내지 않아 화면에 결과만 나온다. DOM-free 층 변경이므로 harness 회귀를 동반한다.
- **REQ-854** *(Ubiquitous)*: The system shall 사부를 **아레나 밖 앞 구석**에 잘린 뒷모습으로 둔다 — 사부를 지우면 관객이 사라지고 아레나에 넣으면 파견이 아니게 된다. 앞쪽에서 잘린 뒷모습이 카메라가 곧 사부의 시선임을 말한다. *(depends: REQ-850)*
- **REQ-855** *(Event-driven)*: When 제자가 해당 수의 파해를 보유해 유도가 뜰 때, the system shall 그 죽간을 **금색 맥동**으로 반짝인다 — 지시는 굳은 금테 + 「지시」 꼬리표, 유도는 금색 맥동 + 「파해」 꼬리표이며, 색이 아니라 **형태(정지/맥동)와 꼬리표**로 갈린다. 금은 이 프로젝트에서 달성·확정의 색이고 유도는 그 예고다. 채택 시안 `dispatch_v1.html` 이 지시·유도를 둘 다 금색으로 그렸고, 원장 9색에 상태용 여분이 없어(남는 자리 = 속성색 C6·C7·C8 · 주사 C5) 지시를 다른 색으로 내리면 죽간이 이미 지는 속성 부호화(REQ-112·819)와 이중 부호화로 충돌한다. *(depends: REQ-810, REQ-811)*
- **REQ-856** *(Ubiquitous)*: The system shall 제자 죽간에 **성 배지 + 한자 우측열을 S1 죽간과 동일 규약**으로 싣고, 기력 라벨을 `적` / `제자` 로 못박는다 — 색 그라디언트만으로 누가 누구인지 구분하지 않는다. 도장에서 키운 값이 여기서 읽혀야 수련의 보상이 닫힌다. *(depends: REQ-827)*
- **REQ-857** *(Ubiquitous)*: The system shall 지시 안내를 **화면 바닥 한 줄**로 둔다 — 「죽간을 탭하면 이 초만 지시한다」. 선택이라는 사실은 바닥에 조용히 있어야 관전을 재촉하지 않는다(REQ-407 알림·재촉·타이머 없음). *(depends: REQ-893)*

### ⑥ S5 전수 — 보고 따라 하는 순간

근거 시안 `transmit_v2_done.png`(채택 v2) · `transmit_v2_follow.png`.

#### 요구사항 (EARS)

- **REQ-860** *(Ubiquitous)*: The system shall 전수를 **사부의 시범과 제자의 따라 하기**로 연출한다 — 둘 다 같은 방향을 보고, 제자는 사부의 등 뒤에서 같은 자세를 잡는다. 자세의 어긋남 → 일치가 전수의 전후를 말한다.
- **REQ-861** *(Event-driven)*: When 전수가 완료될 때, the system shall 제자의 팔 각도를 **사부와 나란해지도록 전이**한다 — 팔을 별도 그룹으로 분리해 회전 각도 하나로 시범/따라 하기를 전환하며, 프레임 애니메이션(스프라이트 시트)을 필요로 하지 않는다. *(depends: REQ-860)*
- **REQ-862** *(Ubiquitous)*: The system shall 화면에서 빛나는 것을 **무공 인장 하나로 제한**한다 — 넓게 퍼지는 헤일로는 도장 전체를 띄워 먹 톤을 지운다(D-1 팽팽·절제 위반). *(depends: REQ-810)*
- **REQ-863** *(Ubiquitous)*: The system shall 무공명을 **세로 조판 인장**으로 두 사람 위에 세운다(한자 우측 세로열) — 건너가는 것은 초식 4개가 아니라 무공 하나이므로(REQ-761), 이름이 서 있어야 아래 목록이 부속으로 읽힌다. *(depends: REQ-813)*
- **REQ-864** *(Ubiquitous)*: The system shall 두 컬럼 diff 를 폐기하고 **초식마다 한 줄**의 이관 행으로 렌더한다 — 2단 구성(초식명·사부 성 / 시퀀스·제자 성 계단), 사부 성은 금(C4)·제자 성은 쾌의 청(C6), 제자 계단은 12칸 중 1칸 점등. *(depends: REQ-817)*
- **REQ-865** *(State-driven)*: While 전수 연출이 진행 중인 동안, the system shall 하단 버튼 자리를 비우지 않는다 — 연출 중에는 「건너뛰기」(약한 테두리), 완료 후 「도장으로」(금 테두리). 빈 바닥은 의도와 무관하게 결손으로 읽힌다.
- **REQ-866** *(Ubiquitous)*: The system shall 전수 화면에서 **복사 안내 문구와 단계 승급 표시를 출력하지 않는다** — 「무공은 사부에게 남는다」는 무협 관습상 자명해 없는 공포에 답하는 문구이고, 단계 승급은 전수와 별개 축이다.

### ⑦ S6 결과 — 보상의 정점

근거 시안 `result_v2_duel.png`(채택 v2) · `result_v2_lose.png` · `result_v2_rematch.png` · `result_v2_dispatch.png`.

#### 요구사항 (EARS)

- **REQ-870** *(Ubiquitous)*: The system shall 결과 화면을 **무대 360 / 정산 492 의 2단**으로 구성하고, **상단 띠 없이 무대가 y=0 에서 시작**하게 한다. *(depends: REQ-802)*
- **REQ-871** *(Ubiquitous)*: The system shall 정산을 **「고정 3블록 → 구분선 → 조건부 블록」 2층**으로 고정한다 — 위(순서 불변): 판정 분포 · 결정타 · 재화. 아래(있을 때만): 성 변화 · 전리품 · 해금. 순서를 상황에 맡기면 매번 눈이 다시 훑어야 한다. *(depends: REQ-870)*
- **REQ-872** *(Ubiquitous)*: The system shall **판정 분포**를 6열 1행(라벨 위 / 숫자 아래)으로 표시하며 S1 의 색 부호화를 그대로 쓴다 — 6단 판정별 횟수는 로그에 이미 있는 데이터이고, 6단 게임의 결과 화면이 당연히 답해야 할 질문이다. *(depends: REQ-814, REQ-871)*
- **REQ-873** *(Ubiquitous)*: The system shall **성 변화**를 초식마다 12칸 계단 + `8성 → 9성` 으로 표시하고, **이번 판에 오른 칸만 발광**시킨다(REQ-406). 발광한 칸이 이 판에서 번 것의 전부이자 정확한 양이다. *(depends: REQ-817, REQ-818, REQ-871)*
- **REQ-874** *(Ubiquitous)*: The system shall **판정 낙인을 104px** 로 조판한다 — 한 초의 결론(판정 오버레이 96px)보다 한 판의 결론이 작으면 위계가 뒤집힌다. 조판 규약은 판정 오버레이와 같다. *(depends: REQ-813, REQ-814)*
- **REQ-875** *(Ubiquitous)*: The system shall S1 아레나를 360px 로 접어 무대로 쓰고 **승패를 자세로 먼저 말한다** — 선 실루엣 / 엎드린 실루엣. 패배 시 서 있는 쪽이 도전자, 쓰러진 쪽이 사부로 **위치를 맞바꾼다**. 엎드린 자세는 선 자세의 회전이 아니라 별도 자세이며, 역광이 닿지 않는 쪽이라 윤곽선으로 형태를 살린다. *(depends: REQ-821, REQ-870)*
- **REQ-876** *(State-driven)*: While 결과가 패배인 동안, the system shall **성 변화와 판정 분포를 그대로** 표시하고 재화를 「없음」으로, 전리품·해금은 아예 붙이지 않는다 — 적립 단위가 유효 성공(REQ-703)이라 져도 성은 오르며, 그 사실을 숨기면 유저는 패배를 순손실로 학습하고 재도전을 멈춘다. *(depends: REQ-872, REQ-873)*
- **REQ-877** *(State-driven)*: While 결과가 재대련인 동안, the system shall 재화 줄을 **「재대련은 재화를 주지 않는다」 문장**으로 대체하고 전리품 블록도 붙이지 않는다(REQ-734 + D-6) — 보상이 없다는 사실을 빈칸이 아니라 문장으로 말해야 파밍 차단이 규칙으로 읽힌다. *(depends: REQ-871, REQ-892)*
- **REQ-878** *(Unwanted)*: If 성이 오른 초식이 많아 정산부가 스테이지 높이를 넘으면, then the system shall 정산부만 세로 스크롤하고 **하단 확정 버튼은 패널 밖 형제로 항상 보이게** 한다 — 유일한 출구가 잘리는 것이 현행 구조의 실패 모드다. 상대 표찰에는 이름·한자·초 수만 싣고 남은 기력은 싣지 않는다. *(depends: REQ-871)*

### ⑧ S7 도전자 선택 — 고르기와 준비하기

현행 빌드에 대응 화면이 없는 **신규 화면**이다. 근거 시안 `select_v2_first.png`(채택 v2) · `select_v2_a4rematch.png` · `select_v2_swap.png` · `select_v2_rematch.png`.

#### 요구사항 (EARS)

- **REQ-880** *(Ubiquitous)*: The system shall 도전자 선택 화면을 **목록 위 / 브리핑 아래의 2단**으로 구성한다 — 위에서 고르면 아래가 그 도전자로 갱신되고 「대련 시작」은 늘 바닥이다. 고르기와 준비하기가 화면 전환으로 갈리면 왕복 잡무가 된다. *(depends: REQ-802)*
- **REQ-881** *(Unwanted)*: If 도전자 목록이 길어져 화면을 넘으면, then the system shall **목록만 스크롤**하고 브리핑과 「대련 시작」을 고정 하단 시트로 유지한다. *(depends: REQ-880)*
- **REQ-882** *(State-driven)*: While 선택된 도전자가 **첫 대면**인 동안, the system shall 상대 초식 브리핑을 붙이지 않고 **첫 대면 안내**를 대신 세우며, 목록 행의 속성 칩을 「미상」으로 접는다 — 싸워본 적 없는 상대의 초식을 이미 아는 것은 성립하지 않는다. *(depends: REQ-894)*
- **REQ-883** *(State-driven)*: While 선택된 도전자가 첫 대면이고 절초를 보유한 동안, the system shall **절초의 존재만 소문으로** 남긴다 — 「…은 절초를 쓴다고 한다 — 이름도 파해도 알려진 바 없다」, 목록 행에도 「절초」 칩만. 전면 비공개는 REQ-732 의 목적을 첫 A-4 에서 통째로 무효화한다. *(depends: REQ-882, REQ-894)*
- **REQ-884** *(State-driven)*: While 선택된 도전자를 이미 겪은 동안, the system shall 상대 초식 3매 카드(절초는 금테 + 「절초」 태그)와 **절초의 이름·파해 대상**을 공개한다 — 게임 전체에서 파해를 이름으로 알려 주는 유일한 자리다(REQ-207 예외). *(depends: REQ-894)*
- **REQ-885** *(Ubiquitous)*: The system shall **파해 대응표를 만들지 않는다** — 상대 초식과 내 슬롯을 나란히 보여줄 뿐, 어느 슬롯이 어느 초식을 파해하는지 선으로 잇지 않는다. 여백이 남는다고 대응표를 채우면 「외운 자만 완파한다」가 무너진다. **절초 하나만 예외**라는 규칙이 화면 구성으로도 지켜져야 한다.
- **REQ-886** *(Event-driven)*: When 슬롯 칸을 탭했을 때, the system shall **이 화면 안에서 슬롯을 교체**하고 도장 동선도 함께 유지한다(REQ-736) — 판단의 순간과 조작의 장소가 붙어야 슬롯 압박이 잡무가 아니라 판단이 된다. 슬롯 부족은 「무엇이 없는지」가 아니라 **「없으면 무슨 일이 나는지」** 로 경고한다(주사색 → 교체 후 금색 확인).
- **REQ-887** *(Ubiquitous)*: The system shall 도전자의 성을 **숫자로 표시하지 않는다**(REQ-722) — 난이도 신호는 목록 순서와 절초 유무뿐이다. 「이미 이긴 상대」는 주사색이 아니라 회색 보통 굵기로 쓴다. *(depends: REQ-811)*

### ⑨ 횡단 용어·규칙 개정 (1.01 / 1.03 spec 개정 동반)

**본 블록은 UI 표기에 그치지 않는 규칙 변경이다.** 각 항목은 `docs/design/glossary.md` · [[spec_프로토타입_v2_통합_PRD]] · [[spec_성_축_초식_단위_재설계]] 의 개정을 같은 PR 에서 동반한다.

#### 요구사항 (EARS)

- **REQ-890** *(Ubiquitous)*: The system shall 재화 단위를 `元` 에서 **「냥」** 으로 바꾼다(표기 `260 냥`) — 한자 단독 표기 금지(REQ-813)에 걸려 `元` 은 남을 수 없고, 「위안」은 현대 중국 화폐로 읽혀 무협 톤을 깬다. 교체 대상: `glossary.md` · `spec_프로토타입_v2_통합_PRD.md` · 코드 4곳 · `docs/balance-log.md` · `docs/screenshots/README.md` (`docs/PRD.md` 는 v0 판본 기록이라 제외). *(depends: REQ-813)*
- **REQ-891** *(Ubiquitous)*: The system shall 초식 데이터에 **창안자 필드**를 신설하고 기성 4종의 창안자를 확정하며(현행 「운객(雲客)」은 플레이스홀더), 수련 화면 해설의 「창안」 줄이 그 값을 표시하게 한다. 창안 시스템·전수 시 창안자 승계·멀티플레이 닉네임 노출은 Phase 2 다 — 이 필드는 UI 를 바꾸지 않고 값만 바뀌는 확장점이다.
- **REQ-892** *(Ubiquitous)*: The system shall 결과 화면에 **전리품 블록의 자리와 노출 조건**을 정의한다 — 획득처는 대련과 파견 둘 다이고 **재대련은 재화도 전리품도 주지 않는다**. 전리품의 종류·용도·수급 곡선은 M2 이며, M1 은 표시 자리와 조건부 노출 규칙까지다(현행 시안의 「비급 조각 2 · 영약 1」은 플레이스홀더). *(depends: REQ-871)*
- **REQ-893** *(Ubiquitous)*: The system shall 공방 한 판의 단위를 **「초(招)」** 로 부르고(`3초째`, `12초 상한`), **「수」를 초식 시퀀스 길이 전용**으로 남긴다(`3수 초식`). 교체 대상은 **공방 단위뿐**이다 — `glossary.md` 표제어(「수 | exchange」 → 「초 | exchange」) · `spec_프로토타입_v2_통합_PRD.md` 12건 · `result.mjs` 2건 · `core.mjs`/`session.mjs` 주석 · `balance-log.md`. 비대상: `3수 초식` · 영문 식별자 · brief 문서(라운드 이력 소급 금지).
- **REQ-894** *(Ubiquitous)*: The system shall 절초 파해 공개를 **대면 이력에 묶는다**(REQ-732 개정) — 첫 대면은 존재만 소문으로, 재대련부터 이름 + 파해 대상. **첫 대면 여부의 판별은 그 도전자의 재대련 회차가 0인지로 가른다**(REQ-734 가 이미 회차를 누적하므로 새 플래그를 두지 않는다). 개정 대상 조문은 [[spec_성_축_초식_단위_재설계]] REQ-732 이며, 「A-4 도전자 예고 화면이 뜨면 절초의 파해 대상을 공개한다」에서 대면 이력 조건이 추가된다.
- **REQ-895** *(Ubiquitous)*: The system shall **스펙 내부 식별자를 화면에 노출하지 않는다** — `A-1`~`A-4`(사부 대련 차수) · `B-1`/`B-2+`(파견 단계). 도전자·임무는 이름으로만 불리고, 진행 순서는 목록 순서와 해금 흐름이 말한다. **데이터의 식별자는 그대로 두고 표시 계층에서만 이름으로 매핑**한다.
- **REQ-896** *(Ubiquitous)*: The system shall 로그 이벤트의 식별자(`dispatch{stage: B-1|B-2+}` 등)를 **유지**한다 — 기계 대상이므로 REQ-895 의 적용 범위가 아니다. 바뀌는 것은 사람이 읽는 표면뿐이다. *(depends: REQ-895)*
- **REQ-897** *(Ubiquitous)*: The system shall 상단 띠를 쓰는 모든 화면의 **좌측 첫 자리에 물러나기**를 둔다. 예외는 둘뿐이다 — S2 도장(홈, 돌아갈 곳이 없어 자리 자체를 비운다) · S6 결과(상단 띠를 쓰지 않고 하단 확정 버튼이 출구를 진다). 「어디로 나가는가」는 화면마다 배우는 것이 아니라 한 번 배우면 끝나는 것이어야 한다.

### ⑩ 접근성·성능

#### 요구사항 (EARS)

- **REQ-910** *(Ubiquitous)*: The system shall 탭 가능한 모든 요소의 **히트 영역을 최소 44px** 로 확보한다(시각 크기는 유지, 확장용 의사요소 사용) — 현행 죽간·행은 28~30px 이다.
- **REQ-911** *(Ubiquitous)*: The system shall 죽간을 `<button>` 으로, 도전자 행을 `role="radio"` 그룹으로 렌더하고 속성 도형(▲●■)에 **텍스트 대체를 동반**하며, 잠긴 버튼에 `disabled`/`aria-disabled` 를 준다 — 현행 `pad.mjs` 가 이미 `<button>` 이므로 `<div>` 렌더는 접근성 후퇴다. *(depends: REQ-819)*
- **REQ-912** *(Ubiquitous)*: The system shall **규칙을 나르는 문구**(다음 계단 안내 · 판정 칩 · 상태 배지 · 지시 안내)의 대비를 본문 수준으로 올린다 — 가장 중요한 규칙이 가장 낮은 대비에 있으면 안 된다.
- **REQ-913** *(Ubiquitous)*: The system shall 판정 오버레이·스크림·비네트를 **1회 생성 후 토글**하는 상주 노드로 두고, 파견 반짝임을 `box-shadow` 펄스가 아닌 **합성 프로퍼티(`opacity`/`transform`) 펄스**로 구현한다. *(depends: REQ-855)*
- **REQ-914** *(Ubiquitous)*: The system shall 아레나 레이어에 **미세 패럴랙스 오프셋 이동**을 넣되, **프레임률이 50fps 미만으로 떨어지면 조건부 비활성화**한다. *(depends: REQ-821, REQ-915)*
- **REQ-915** *(Ubiquitous)*: The system shall 저사양 실기에서 **판정 프레임 예산을 측정**한다 — 흔들림 + 96px 글로우 + 스크림이 겹치는 프레임이 측정 대상이며, 결과가 REQ-914 의 활성 임계와 juice 강도의 근거가 된다(검증 스파이크). *(depends: REQ-815)*

### ⑪ 사운드 (M1 기본 세트)

결정 로그는 사운드를 M3 로 적어 두었으나 **운영자 판단(2026-09-02)으로 기본 세트가 M1 에 들어온다**. 「기본」의 범위는 아래 REQ 가 정의하며, 3음 이상의 레이어링·동적 믹싱·상황별 BGM 분기는 M3 다.

#### 요구사항 (EARS)

- **REQ-920** *(Ubiquitous)*: The system shall 오디오 재생을 **단일 모듈**로 두고 `src/` 루트의 DOM-free 계약을 지키게 한다 — 재생은 `src/ui/` 층이 소유하고, 어떤 이벤트에 어떤 소리가 붙는지의 매핑만 데이터로 둔다.
- **REQ-921** *(Event-driven)*: When 최초의 사용자 입력이 발생했을 때, the system shall 오디오 컨텍스트를 재개한다 — 브라우저 자동재생 정책상 그 전에는 소리가 나지 않는다. *(depends: REQ-920)*
- **REQ-922** *(Event-driven)*: When 방향 키가 입력될 때, the system shall 타격음을 **피치 랜덤화**해 재생한다 — 같은 소리가 연속으로 반복되면 손맛이 죽는다. *(depends: REQ-920)*
- **REQ-923** *(Event-driven)*: When 후보가 1개로 확정될 때, the system shall 확정음을 재생한다 — `.only` 금테 확대와 같은 순간이다. *(depends: REQ-826, REQ-920)*
- **REQ-924** *(Event-driven)*: When 판정이 확정될 때, the system shall 판정 계열에 따라 **3음 중 하나**를 재생한다 — 완파(유리 극단) / 우세·상쇄·열세(중립 교차) / 역파·피격(불리). 흔들림이 극단 2등급에만 걸리는 것과 달리, 소리는 6단 전부를 3계열로 덮는다. *(depends: REQ-814, REQ-920)*
- **REQ-925** *(Event-driven)*: When 성이 한 칸 오를 때, the system shall 성 상승음을 재생한다 — 결과 화면의 발광 칸(REQ-873)과 짝이다. *(depends: REQ-873, REQ-920)*
- **REQ-926** *(Ubiquitous)*: The system shall 도장·대련 공용 **BGM 루프 1종**을 재생하고, 음소거 토글을 제공한다. 상황별 BGM 분기는 M3 다. *(depends: REQ-920)*

### ⑫ 에셋 이관

#### 요구사항 (EARS)

- **REQ-930** *(Ubiquitous)*: The system shall 목업의 폰트 실파일을 **게임 번들로 이관**하고 표면 역할을 매핑한다 — F1 나눔명조 400/800(한글·라틴 본문·강조, 전 표면 주력) · F2 Noto Serif KR 한자 서브셋 400/800(한자 보조 병기 `.hj`). 둘 다 OFL 이며 **라이선스 파일을 동봉**한다. 한자 서브셋은 가변 폰트를 weight 고정 후 `pyftsubset` 으로 한자만 남기는 절차이며, 문자 집합을 늘릴 때 같은 절차를 반복한다. *(depends: REQ-803, REQ-812)*
- **REQ-931** *(Ubiquitous)*: The system shall 목업의 되돌리기 아이콘 실파일(`mockups/assets/reset.svg`)을 **초기 에셋으로 그대로 채용**한다 — S1 입력 되돌리기 · S3 입력 되돌리기. 코드는 파일 경로가 아니라 아이콘 id 를 참조해, 후속 아트 개선이 파일 스왑으로 닫히게 한다. *(depends: REQ-829)*
- **REQ-932** *(Ubiquitous)*: The system shall 실루엣 12종을 **투명 PNG 에셋으로 교체**한다 — 현행 인라인 SVG 는 손으로 그린 검증용이며 최종 품질이 아니다. 코드는 id 참조를 유지하고, 자산 명세는 § 아트 계약이 진다. 속성 기호(▲●■)·성 계단 표식·정경·아레나 레이어·족자·낙관은 **의도적 코드 렌더로 남긴다**(상태에 따라 색·크기가 변하고 코드 렌더가 폴백이기도 하다). *(depends: REQ-821, REQ-875)*

### 통합 로그 스키마

7화면이 가로지르는 검증 로그. **좌표 모델의 축은 `screen`**(어느 화면에서 일어났는가)이며, 아래 신규 이벤트는 전부 그 축에 키잉된다.

| 이벤트 | 발화 서브시스템 | 필드 | 무엇의 입력인가 |
|---|---|---|---|
| `screen_view` | ⓪ · ②~⑧ | `screen`(s1~s7) · `ms`(체류) · `from` | 7화면 이식 완주 판정 — 어느 화면이 아직 구 크롬을 쓰는지 |
| `font_ready` | ⓪ | `ms` · `bytes` · `subset_hit`(true/false) | REQ-803 서브셋 효과 — 로딩 비용이 주 변수라는 진단의 검증 |
| `frame_budget` | ⑩ | `screen` · `scene`(verdict/parallax/idle) · `p95_ms` · `dropped` | REQ-914 패럴랙스 활성 임계 · REQ-915 스파이크의 산출 |
| `undo_used` | ② · ④ | `screen` · `count` · `exchange_no` | REQ-829 되돌리기 분리 배치의 오조작 감소 효과 |
| `audio_state` | ⑪ | `resumed`(true/false) · `muted` · `ms_to_resume` | REQ-921 자동재생 정책 우회가 실제로 뚫렸는지 |

**좌표 모델 변경에 따른 기존 측정 재정합 — 전수 열거 결과: 뜻이 바뀌는 필드 0건.**

- REQ-893(「수」 → 「초」)은 **한국어 표면 명칭만** 바꾼다. 로그의 영문 키(`exchange`·`maxExchanges`)와 그 값의 의미는 무변경이므로 schema 판별 토큰이 필요 없다.
- REQ-895(스펙 식별자 비노출)는 REQ-896 이 명시하듯 **로그 식별자를 유지**한다 — `dispatch{stage}` 의 `B-1`/`B-2+` 는 그대로다.
- REQ-891(창안자)·REQ-892(전리품)는 **새 필드의 신설**이지 기존 필드의 뜻 변경이 아니다.

따라서 본 spec 은 기존 측정 이벤트에 schema 판별 토큰을 부여하지 않는다.

### 데이터 구조

- **스타일 토큰 원장** — 색 C1~C9(REQ-810) · 서체 F1/F2(REQ-812) · 판정 크기 6단(REQ-814) · 성 계단 규격(REQ-817). 화면이 아니라 **하나의 토큰 원장**이 SoT 이며, 시안 실측값이 초기 시드다.
- **초식 데이터** — `founder`(창안자) 필드 신설(REQ-891). 기성 4종의 값은 이 spec 의 구현 단계에서 확정한다.
- **도전자 데이터** — 신규 필드 없음. 첫 대면 판별은 기존 재대련 회차 0 여부를 읽는다(REQ-894).
- **아이콘 참조** — 코드는 파일 경로가 아니라 id 로 참조한다(REQ-931 · REQ-932).
- **사운드 매핑** — 이벤트 → 사운드 id 의 매핑 테이블(REQ-920). 실파일 경로는 매핑 테이블 밖에 둔다.

### 상태 머신 / 핵심 로직

- **죽간 렌더러** — 후보 수 변화에 대해 enter / hold / exit / only 4상태를 가진다(REQ-824~826). `only` 는 최소 표시 시간을 가지며 그동안 판정 오버레이가 대기한다.
- **제자 선택 로직** — `selectDiscipleStyle` 이 `{style, reason}` 을 반환한다(REQ-853). `reason` 은 우세 선택 / 상쇄 선택 / 역파 회피의 3 계열이며 S4 의 「제자의 판단」 문구가 이 값을 읽는다. DOM-free 층이므로 harness 회귀를 동반한다.
- **판정 오버레이 호스트** — 시각 노드(아레나 소속, 화면과 함께 생성·파괴) 와 낭독 노드(스테이지 직속, 상주)가 분리된다(REQ-806 · REQ-807).
- **화면 크롬 소유권** — 상단 띠·본문·하단부의 소유가 싱글턴에서 화면별 렌더로 이동한다(REQ-801 · REQ-802). 이 전이가 완료되기 전에는 어떤 화면도 이식할 수 없다.

### UI / UX 명세

§ ②~⑧ 의 REQ 가 화면별 명세 본체다. 화면 인벤토리와 흐름:

| # | 화면 | REQ 밴드 | 확정 시안 |
|---|---|---|---|
| S1 | 대련 | REQ-820~829 | `duel_v5_input.png` (v5) |
| S2 | 도장 | REQ-830~837 | `dojo_v2_growth.png` (v2) |
| S3 | 수련 | REQ-840~846 | `train_v4_input.png` (v4) |
| S4 | 파견 관전 | REQ-850~857 | `dispatch_v1_beckon.png` (v1) |
| S5 | 전수 | REQ-860~866 | `transmit_v2_done.png` (v2) |
| S6 | 결과 | REQ-870~878 | `result_v2_duel.png` (v2) |
| S7 | 도전자 선택 | REQ-880~887 | `select_v2_first.png` (v2) |

흐름: `도장 ⇄ 수련` · `도장 → 도전자 선택 → 대련 → 결과 → 도장` · `도장 → 전수 → 도장` · `도장 → 파견 관전 → 결과 → 도장`.

**픽셀 값·CSS 속성은 REQ 의 계약이 아니다.** REQ 본문의 수치는 시안 실측 초기값이며 구현은 이를 스타일 토큰 원장(REQ-810)의 시드로 쓰고 이후 튜닝으로 갱신한다.

#### 시안 요소 커버리지 (확정 시안 7종 ↔ REQ 대조)

결정 로그의 요소 인벤토리(`data-ui` 원장 전사)를 REQ 에 대조한 결과다. 미커버 요소는 명시 처분을 붙였다.

| 화면 | 요소 그룹 | 커버 REQ | 미커버 처분 |
|---|---|---|---|
| S1 | 상단 띠(E1·E1-1~4) | REQ-820 · REQ-893 · REQ-895 · REQ-897 | — |
| S1 | 아레나·레이어·실루엣·역광(E2~E4) | REQ-821 · REQ-932 | — |
| S1 | 상대 예고(E5~E5-3) · 기력 2(E6·E7) · 응수 창(E8) | REQ-822 · REQ-823 · REQ-856 | — |
| S1 | 판정 오버레이(E9~E9-2) | REQ-806 · REQ-813 · REQ-814 | — |
| S1 | 진행형 색·죽간·트레일(E10~E12) | REQ-824~828 | — |
| S1 | 키패드·되돌리기(E13~E14) | REQ-829 · REQ-910 · REQ-931 | — |
| S2 | 상단 띠(E1~E1-2) · 정경(E2~E2-5) | REQ-837 · REQ-890 · REQ-897 | — |
| S2 | 무공 머리글·초식 목록(E3~E4-12) | REQ-830~832 · REQ-817 | — |
| S2 | 유도 툴팁(E6) | REQ-912 | — |
| S2 | 하단 액션 바(E7~E7-2) | REQ-836 · REQ-895 | — |
| S2 | 제자 블록(E9~E9-4) · 다음 상대(E10~E10-4) | REQ-833~835 | — |
| S3 | 상단 띠·수련장·실루엣(E1~E3) | REQ-840 · REQ-897 · REQ-932 | — |
| S3 | 구결 족자·낙관(E4~E4-2) | REQ-841 · REQ-842 | — |
| S3 | 진척 계단(E5) · 응수 창(E6) · 판정(E7) | REQ-845 · REQ-846 · REQ-823 | — |
| S3 | 죽간 1매(E9~E9-4) · 트레일·키패드·되돌리기(E10~E12) | REQ-843 · REQ-827~829 | — |
| S3 | 초식 해설(E13~E13-3) | REQ-844 · REQ-891 | — |
| S4 | 임무 표찰(E1~E1-4) | REQ-895 · REQ-897 | — |
| S4 | 아레나 상속(E2~E8) | REQ-850 | — |
| S4 | 제자 초식·판단·지시 안내(E10~E13) | REQ-852 · REQ-855~857 | — |
| S4 | 지켜보는 사부(E15) | REQ-854 · REQ-932 | — |
| S5 | 상단 띠(E1~E1-1) · 무대·광휘(E2~E2-2) | REQ-862 · REQ-897 | — |
| S5 | 실루엣 2인·동작(E3·E4·E11) | REQ-860 · REQ-861 · REQ-932 | — |
| S5 | 무공 인장(E6) · 이관 명세(E7~E7-8) | REQ-863 · REQ-864 | — |
| S5 | 하단 버튼(E10) | REQ-865 | — |
| S6 | 무대·레이어·실루엣(E1~E3) | REQ-870 · REQ-875 · REQ-932 | — |
| S6 | 판정 낙인(E4~E4-2) · 상대 표찰(E5) | REQ-874 · REQ-878 | — |
| S6 | 결정타(E6) · 재화(E8) · 판정 분포(E11~E11-1) | REQ-871 · REQ-872 · REQ-877 | 결정타 카드의 금테 강조는 REQ-871 고정 ② 에 흡수 |
| S6 | 성 변화(E7~E7-4) · 해금(E9) · 전리품(E12~E12-1) | REQ-873 · REQ-892 | 해금 블록은 REQ-871 조건부 층에 흡수 (개별 REQ 신설 안 함 — 표시 규칙이 고정/조건부 룰과 동일) |
| S6 | 하단 버튼(E10~E10-2) | REQ-878 | — |
| S7 | 상단 띠(E1~E1-3) | REQ-890 · REQ-897 | — |
| S7 | 도전자 목록(E2~E2-5) | REQ-880 · REQ-881 · REQ-887 | — |
| S7 | 상대 초식 브리핑(E3~E3-2) · 절초 공개/소문(E4) | REQ-882~885 | — |
| S7 | 내 슬롯(E5~E5-3) · 대련 시작(E6) · 첫 대면 안내(E7) | REQ-886 · REQ-882 | — |

**은퇴 요소는 이관 대상이 아니다** — S2 E3-2/E3-3/E3-4/E4-5/E4-6/E5/E8 · S3 E1-3 · S5 E5/E8/E9 · S7 E2-2. 각각 성 축 소멸(1.03)·중복·D-8·명시 삭제 결정으로 은퇴했다.

**주석 스니펫은 출하 코드에 들어가지 않는다** — `.ui-annotate-*` / `body.ui-capture` 는 목업 7파일 전부에 있고 `position: fixed` 를 쓰는 유일한 규칙이라, 스테이지 안으로 따라 들어가면 스케일 스테이지의 알려진 함정을 밟는다. 이식 경계에서 제외한다.

### 기술 의존성

- **엔진 = HTML5 그 자체** — 목업의 CSS 층은 거의 그대로 이식되고, HTML 구조는 렌더 함수로 번역되며, `?state=` 스크립트 JS 층은 전량 폐기된다. **목업의 스타일 결함이 곧 게임의 결함**이라는 것이 이 프로젝트의 특수 조건이다.
- **DOM-free 경계** — `src/` 루트(`balance.mjs`·`core.mjs`·`log.mjs`·`bot.mjs`)와 harness 가 import 하는 `src/ui/` 4모듈(`sequence-input`·`match`·`session`·`wiring`)은 DOM 을 참조할 수 없다. REQ-853(제자 선택 이유)이 이 층을 건드리므로 harness 회귀가 필수다.
- **스케일 스테이지** — `#stage` 가 `transform: scale(var(--k))` 를 쓰므로 흔들림은 내부 래퍼에 걸어야 하고(REQ-816), `position: fixed` 는 스테이지 안에서 쓰지 않는다.
- **세로쓰기** — `writing-mode: vertical-rl` + `text-orientation: upright` 는 한글에서도 성립하지만, 컨테이너 높이가 부족하면 조용히 2열로 접힌다. `white-space: nowrap` + 충분한 높이 + `overflow: hidden` 이 3점 세트다.
- **폰트 로딩** — F1 이 전 표면 주력이 되면서 로딩 비용의 주 변수가 됐다(REQ-803).
- **오디오** — WebAudio 자동재생 정책상 첫 사용자 입력 전에는 소리가 나지 않는다(REQ-921).

### build-Plan 결정 사항

`/gamedev-build` 가 Plan mode 진입 시 코드를 정찰해 결정한다 — spec 시점에 정할 근거가 없는 것들이다.

- **히트스톱의 정지 길이** — 완파·역파 프레임 정지를 몇 ms 로 둘지는 실플레이 손감으로 정한다(REQ-815 흔들림과 같은 극단 2등급 배정). spec 은 「후보를 넣는다」까지만 쓴다.
- **`.only` 최소 표시 시간의 값** — REQ-826 이 규칙을 고정하고, 값(ms)은 실측 튜닝 대상이다.
- **패럴랙스 오프셋의 크기와 50fps 판정 방식** — REQ-914 · REQ-915. 저사양 프레임 예산 측정 결과가 나온 뒤에 정해진다.
- **B6 해체의 분할 단위** — REQ-801·REQ-802 를 한 PR 로 갈지 크롬 요소별로 쪼갤지는 현행 `app.mjs`·`index.html` 정찰 후 결정한다. 다만 **화면 이식보다 먼저 끝난다**는 순서는 spec 이 고정한다.
- **사운드 실파일의 포맷 폴백** — 아트 계약은 `ogg` 를 계약 포맷으로 두지만, 사파리 대응이 필요하면 동일 id 의 `m4a` 폴백을 추가할지 구현 단계에서 판단한다.

## 스코프

### MVP 포함

- 선행 구조 변경 5건 — 싱글턴 크롬 해체(B6) · 한글 폰트 서브셋 + CI 게이트(B4) · 죽간 렌더러 분리(I6) · 판정 오버레이 호스트 분리(I8) · 코드↔시안 정본화(I9)
- 7화면 전부 이식 — S1~S7. **축소선을 취하지 않는다**(운영자 결정 2026-09-02)
- 공통 시각 언어 원장 — 팔레트 9색 · 명조 2계열 · 한글 주/한자 보조 조판 · 6단 판정 4중 부호화 · 성 계단 단일 컴포넌트
- juice — 화면 흔들림(극단 2등급 한정) · 히트 플래시 · 피해 비네트 · 히트스톱(값은 build-Plan)
- 사운드 기본 세트 — SFX 6종 + BGM 루프 1종 + 음소거
- 횡단 규칙 개정 5건 — 냥 · 초 · 창안자 필드 · 전리품 자리 · REQ-732 대면 이력 조건 + 표시 계층 식별자 분리 + 물러나기 위치
- 접근성 — 히트 44px · 시맨틱 요소 · 텍스트 대체 · 대비 상향
- 에셋 이관 — 폰트 4파일 + 아이콘 1파일 + 실루엣 12종 PNG 교체
- 검증 스파이크 1건 — 저사양 실기 판정 프레임 예산 측정

### Phase 2 이관 (범위 밖)

- **캐릭터 프레임 애니메이션** (스프라이트 시트 + CSS `steps()`) → M2 로드맵. 트리거 = 「M1 7화면 이식 완료 + 실루엣 아트 교체 납품」. S5 전수의 시범·따라 하기는 팔 회전 트랜지션 하나로 이미 성립하므로 이 이관의 대상이 아니다.
- **창안 시스템 · 전수 시 창안자 승계 · 멀티플레이 닉네임 노출** — 창안자 필드(REQ-891)의 확장 경로 ⓑⓒ.
- **전리품의 종류·용도·수급 곡선** → M2. **용도가 성 적립에 닿으면 8성 벽(REQ-706) 우회 여부를 먼저 검토**한다.
- **상황별 BGM 분기 · 사운드 레이어링·동적 믹싱** → M3.
- **로컬라이즈 · 접근성 옵션 UI 노출** → M3.
- **정보 구조·화면 전환 흐름의 전면 재설계** — M1 통합 PRD 와 파일 스코프가 크게 겹쳐 기각.
- **디버그 컨트롤(응수 창 ×1.3)·수련 시뮬의 이주** — 게임 스테이지 밖으로 빼는 것까지는 M1(REQ-802 의 크롬 해체가 자리를 만든다), 개발자 치트 패널(REQ-781)로의 통합은 그 spec 의 몫이다.

## 설계 결정

| 결정 (spec 반영 위치 병기) | 기각 대안 (1줄) | 출처 |
|---|---|---|
| 톤의 주인은 무협(팽팽·절제) — 아이들 아케이드 관습은 톤을 잡지 않는다 (§ ① 전반) | 코지·둥글둥글 톤을 주인으로 — 상위 장르 관습이라 안전하지만 무협 기호와 정면으로 당겨 어정쩡해진다(문서화된 실패 패턴) | ui 결정 (D-1) |
| 한글이 주 표기, 한자는 보조 병기 — 한자 단독 표기는 존재하지 않는다 (REQ-813) | 한자를 대형 표시의 주역으로 — 무협 임팩트는 최대지만 플레이어가 한국인이라 순간 판독을 잃는다 | ui 결정 (D-2) |
| 재화 단위 `元` → 「냥」 (REQ-890) | ⓐ `元` 유지 — D-2 의 예외를 하나 만들어야 한다 ⓑ 「문(文)」 — 저액 단위라 현행 수치 체계를 밸런스 표까지 손봐야 한다 | ui 결정 (D-3) |
| 창안자를 초식 필드로 신설, M1 은 필드 + 기성 4종 확정 + 표시까지 (REQ-891 · REQ-844) | ⓐ 표시 자리만 두고 값은 계속 플레이스홀더 — 나중에 레이아웃은 안 열지만 값이 계속 가짜다 ⓑ 전수 승계까지 M1 — 창안 시스템 없이는 승계할 값이 기성 4종뿐이라 이득이 얇다 | ui 결정 (D-4) · 운영자 판단 2026-09-02 |
| 공방 한 판의 단위는 「초(招)」, 「수」는 시퀀스 길이 전용 (REQ-893) | 현행 유지(둘 다 「수」) — 상단 띠 `3수째`(회차)와 예고 `3수 초식`(키 3개)이 15px 거리에서 다른 것을 가리킨다 | ui 결정 (D-5) |
| 전리품은 M1 에 자리와 노출 조건만, 내용은 M2 (REQ-892) | M1 에 전리품 시스템까지 정의 — 용도가 성 적립에 닿는 순간 8성 벽 우회 구멍이 생겨 막 확정된 성 축 균형을 다시 연다 | ui 결정 (D-6) |
| 절초 공개를 「소문 → 이름 → 파해」 3층으로, 대면 이력이 층을 가른다 (REQ-882~884 · REQ-894) | ⓐ 첫 대면부터 전부 공개(REQ-732 원문) — 싸워본 적 없는 상대의 초식을 아는 것이 성립하지 않는다 ⓑ 첫 대면 전면 비공개 — REQ-732 의 목적이 첫 A-4 에서 통째로 무효화되어 반드시 한 번은 역파를 맞고 시작한다 | ui 결정 (D-7) |
| 첫 대면 판별은 재대련 회차 0 여부로 (REQ-894) | `seen` 플래그 신설 — REQ-734 가 이미 회차를 누적하므로 같은 사실을 두 곳에 두게 된다 | spec 위임 |
| 스펙 식별자(`A-n`/`B-n`)를 화면에서 전면 제거, 데이터·로그는 유지 (REQ-895 · REQ-896) | 낙관에 한자 순번(`一`~`四`) — 무협 조형으로는 맞지만 D-2(한자 단독 표기 금지)를 정면으로 어긴다 | ui 결정 (D-8) |
| 상단 띠가 있으면 좌측 첫 자리는 언제나 물러나기, 예외는 홈과 결과 둘뿐 (REQ-897) | 전 화면을 상단 띠 + 물러나기로 통일 — S6 에 띠를 넣으면 104px 낙인이 눌려 승패 그림의 강도를 일관성과 맞바꾼다 | ui 결정 (D-9) |
| 6단 판정 전부를 4중 부호화로, 완파↔역파는 상하 대칭 (REQ-814) | 현행 「완파만 표시」 유지 — 실질 2단으로 체감되고 색만으로 구분하면 색각 접근성이 무너진다 | ui 결정 (S1 가독성) |
| 죽간을 후보 수만큼 그리는 가변으로 (REQ-824) | 고정 4슬롯 + 빈칸 — 「후보 1개 도달 시 중앙 확대」(REQ-110)가 성립하지 않고 좁혀지는 과정이 화면에 없다 | ui 결정 (S1 v4) |
| 탈락 죽간에 exit 전이를 준다 (REQ-825) | 개수 감소만으로 충분 — 확정 시안에 `.out` 이 안 붙어 실증이 없으나, 즉시 삭제는 필터링 과정을 지운다 | ui 결정 (§ 잔여 논의 drain ⓐ) |
| `.only` 에 최소 표시 시간을 주고 판정을 대기시킨다 (REQ-826) | 확정 연출을 판정 오버레이에 위임(추가 지연 0) — 「좁혀짐」의 마지막 한 칸이 화면에서 사라진다 | ui 결정 (§ 잔여 논의 drain ⓐ) |
| 파견은 키패드 자리를 비우고 제자의 판단으로 채운다 (REQ-851 · REQ-852) | 그 자리에 관전 조작을 넣는다 — 「손 놓고 보는 것」(REQ-407)이 사라진다 | ui 결정 (S4) |
| 전수는 보고 따라 하는 것으로 연출한다 (REQ-860) | 전수 광선(v1) — 「데이터가 전송된다」는 은유라 이 게임이 파는 사제 관계와 어긋난다 | ui 결정 (S5 v2) |
| 결과 정산을 고정 3블록 → 조건부 블록 2층으로 (REQ-871) | 항목 순서를 상황에 맡긴다 — 판마다 항목 수가 달라 매번 눈이 다시 훑는다 | ui 결정 (S6 v2) |
| 패배에도 성 변화와 판정 분포를 그대로 보여준다 (REQ-876) | 패배는 손실만 표시 — 적립 단위가 유효 성공이라 져도 성은 오르는데, 숨기면 패배를 순손실로 학습하고 재도전을 멈춘다 | ui 결정 (S6) |
| 파해 대응표를 만들지 않는다 (REQ-885) | 여백에 대응표를 채운다 — 「외운 자만 완파한다」가 무너지고 절초만 예외라는 규칙이 깨진다 | ui 결정 (S7) |
| I9 정본 = **표시층은 시안, 내부 키는 코드** — 속성 3색 `#5fb3e8`/`#e05a4d`/`#4fbf7f`, 판정 한자 상쇄 `衝`·피격 `擊` 를 정본으로, 속성 키 `fast`/`hard`/`fine` 은 유지 (REQ-810 · REQ-813 · REQ-814) | ⓐ 전면 시안 정본 — 속성 키까지 개명하면 `balance.data.json`·로그 스키마·harness·`bot.mjs` 가 따라오는데 화면에 안 보이는 값이라 이득이 0 ⓑ 전면 코드 정본 — 확정 목업 7종 CSS 재작업 + 팔레트 원장 개정 | 운영자 결정 2026-09-02 |
| 실루엣을 투명 PNG 아트 에셋으로 교체하고 본 spec 의 아트 계약이 진다 (REQ-932 · § 아트 계약) | ⓐ M2 로드맵 승격 — M1 이 손그림 검증용 형상으로 출하된다 ⓑ 코드 렌더를 최종으로 확정 — 결정 로그가 「형상은 확정한 것이 아니다」라고 명시 부인했다 | 운영자 결정 2026-09-02 |
| 사운드 기본 세트를 M1 에 넣는다 (§ ⑪) | 전량 M3 배치(결정 로그 원안) — 무음 빌드는 juice 3종의 체감을 절반만 낸다 | 운영자 결정 2026-09-02 |
| 리뷰어 일정 견적(50% 19~23일)을 채택하지 않고 7화면 전부 유지 | S1·S6 축소선 — 견적이 구현자가 LLM 이라는 전제 없이 사람 개발자 기준으로 산정됐다(실측 반증: 성 축 T2 기능 3건이 3시간 8분에 랜딩). 다만 견적의 *구조*(B6 선행 · 검증 스파이크 2건은 시간이 아니라 불확실성)는 유효하다 | ui 결정 (§ 구현 노트) |

## 일정

- **선행 스파이크 (검증 2건)**: 한글 서브셋 문자 집합 확정(REQ-803) · 저사양 실기 판정 프레임 예산 측정(REQ-915) — 2026-09-03, 개발자 본인. **시간이 아니라 불확실성**이므로 결과를 봐야 다음이 정해진다.
- **선행 구조 변경 (§ ⓪)**: B6 해체를 첫 유닛으로 — 2026-09-03, 개발자 본인. 7화면 전부가 여기 막혀 있다.
- **본 구현 (§ ①~⑫)**: 공통 시각 언어 → S1 → S2·S3 → S4·S5 → S6·S7 → 횡단 개정 → 사운드 — 2026-09-04~06, 개발자 본인(LLM 구현자 dispatch).
- **아트 생성 (§ 아트 계약)**: 실루엣 3 시트 + 사운드 7종 — 구조 변경과 **병렬** 착수 가능(코드는 id 참조라 파일 스왑으로 닫힌다).
- **셀프 검증 + 검증 로그 박기**: 2026-09-06~07, 개발자 본인. 마감 2026-09-07 23:59 KST.

## 아트 계약

> /gamedev-art 가 이 표를 결정론 conformance 대조. 코드는 항상 `id` 참조(filename 아님).
> 의미 적합 2층: 구조=결정론·authoritative / 의미=사람-attested(/gamedev-art 기록만).
> AI 생성에 바로 쓸 프롬프트 등급 묘사는 아래 `## 아트 생성 브리프` 의 `[{id}]` 블록 참조 (이 표의 `semantic_intent` 는 1~2문장 앵커일 뿐).
> **스캔 루트는 `assets/`** — 이 프로젝트는 Unity 가 아니라 HTML5(빌드 스텝 없음)이므로 `repo_path` 는 repo 루트 상대 경로다.
> **실루엣 캔버스는 512×1024 로 통일**한다 — 자세마다 실제 점유 영역이 달라도(엎드림·잘린 뒷모습) 같은 캔버스를 쓰면 conformance 대조와 배치 좌표가 함께 단순해진다.
> **폰트와 되돌리기 아이콘은 이 표에 없다** — 이미 실파일로 존재하는 이관 자산이고 `format` enum(png/jpg/ogg/wav)이 ttf·woff2·svg 를 표현하지 못한다. 각각 REQ-930 · REQ-931 이 이관을 명세한다.

| id | class | spec_ref | filename | format | dimensions | alpha | bgm_loop | count | tier | consistency_group | semantic_intent | license_meta | repo_path |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sil_master | sprite | REQ-932 | sil_master_{pose}.png | png | 512x1024 | true | — | 6 | final | ink_silhouette | 사부의 먹 실루엣 6자세 — 대치(S1·S6 승자 겸용) · 도장 서기(S2) · 잘린 뒷모습 관전(S4) · 시범 몸통과 팔 분리 2파일(S5) · 엎드림(S6 패배). 붓으로 친 단색 실루엣이며 얼굴 이목구비가 없다. | AI 생성(MJ base + NB variant) · 상업 이용 가능 · 생성 이력 `docs/ai-log.md` 기록 | assets/art/silhouettes/ |
| sil_disciple | sprite | REQ-932 | sil_disciple_{pose}.png | png | 512x1024 | true | — | 4 | final | ink_silhouette | 제자의 먹 실루엣 4자세 — 도장 서기(S2) · 아레나 대치(S4) · 따라 하기 몸통과 팔 분리 2파일(S5). 사부보다 작고 어깨가 좁아 한눈에 갈린다. | AI 생성(MJ base + NB variant) · 상업 이용 가능 · 생성 이력 `docs/ai-log.md` 기록 | assets/art/silhouettes/ |
| sil_challenger | sprite | REQ-932 | sil_challenger_{pose}.png | png | 512x1024 | true | — | 2 | final | ink_silhouette | 도전자의 먹 실루엣 2자세 — 대치(S1·S4·S6 승자 겸용) · 엎드림(S6 승리). 사부와 실루엣만으로 구분되도록 도포 자락과 무기 실루엣이 다르다. | AI 생성(MJ base + NB variant) · 상업 이용 가능 · 생성 이력 `docs/ai-log.md` 기록 | assets/art/silhouettes/ |
| sfx_key | sfx | REQ-922 | sfx_key.ogg | ogg | — | — | — | 1 | final | dojo_sfx | 방향 키 하나를 칠 때의 짧고 건조한 타격음. 재생 시 피치가 랜덤화되므로 자체는 무색·무잔향이어야 한다. | Suno Sounds 생성 · 상업 이용 가능 · 생성 이력 `docs/ai-log.md` 기록 | assets/audio/ |
| sfx_lock | sfx | REQ-923 | sfx_lock.ogg | ogg | — | — | — | 1 | final | dojo_sfx | 후보가 1개로 확정되는 순간의 잠김음. 금테 확대와 같은 순간이라 「맞물렸다」로 읽혀야 한다. | Suno Sounds 생성 · 상업 이용 가능 · 생성 이력 `docs/ai-log.md` 기록 | assets/audio/ |
| sfx_break | sfx | REQ-924 | sfx_break.ogg | ogg | — | — | — | 1 | final | dojo_sfx | 완파 판정의 결정음. 6단 중 유일하게 통쾌해야 하는 소리이며 화면 흔들림과 동시에 난다. | Suno Sounds 생성 · 상업 이용 가능 · 생성 이력 `docs/ai-log.md` 기록 | assets/audio/ |
| sfx_clash | sfx | REQ-924 | sfx_clash.ogg | ogg | — | — | — | 1 | final | dojo_sfx | 우세·상쇄·열세를 덮는 중립 교차음. 승패를 말하지 않고 「부딪혔다」만 말한다. | Suno Sounds 생성 · 상업 이용 가능 · 생성 이력 `docs/ai-log.md` 기록 | assets/audio/ |
| sfx_hit | sfx | REQ-924 | sfx_hit.ogg | ogg | — | — | — | 1 | final | dojo_sfx | 역파·피격의 둔탁한 피격음. 완파와 정반대 방향으로 읽혀야 하며 피해 비네트와 동시에 난다. | Suno Sounds 생성 · 상업 이용 가능 · 생성 이력 `docs/ai-log.md` 기록 | assets/audio/ |
| sfx_rank | sfx | REQ-925 | sfx_rank.ogg | ogg | — | — | — | 1 | final | dojo_sfx | 성이 한 칸 오를 때의 상승음. 결과 화면의 발광 칸과 짝이며 짧고 맑다. | Suno Sounds 생성 · 상업 이용 가능 · 생성 이력 `docs/ai-log.md` 기록 | assets/audio/ |
| bgm_dojo | bgm | REQ-926 | bgm_dojo.ogg | ogg | — | — | true | 1 | final | dojo_bgm | 도장·대련 공용 배경 루프. 무협의 절제된 긴장을 깔되 멜로디가 기억에 남지 않아야 반복 재생을 견딘다. | Suno Custom 생성 · 상업 이용 가능 · 생성 이력 `docs/ai-log.md` 기록 | assets/audio/ |

## 아트 생성 브리프

> /gamedev-art conformance 와 **무관** — 외부 생성(nano-banana / Midjourney / Suno / 외주 / 사람 작화) 입력. `## 아트 계약` 표의 `{id}` 와 1:1.
> 헬퍼(`art_conformance.py`)는 이 섹션을 파싱하지 않으므로 14컬럼 라운드트립 계약과 무관 — 블록 필드는 게임/도구 특성에 맞게 자유 조정 가능(스키마 동결 아님).
> 각 블록 = 3슬롯 자급자족: [A] 생성 프롬프트 본문(외부 AI 복붙, 내부 참조 0건) / [B] 추가 지침(첨부·도구 옵션) / [C] 내부 참조(REQ 매핑·트리거, AI 비전달). 이미지 블록은 [A] 뒤에 [A-ko] 한글 외주 명세 추가.

### [sil_master] 사부 먹 실루엣 6자세

**[A-base] MJ base 생성 프롬프트** (MJ 1회 호출 · 산출 raw PNG 가 나머지 5변형의 anchor)

```
Subject: a single martial arts master, full body, standing in a ready combat stance, rendered as a solid flat ink silhouette with no interior detail
Character appearance: adult male martial arts master, tall and broad-shouldered, long flowing robe reaching below the knees with wide sleeves, a wide sash at the waist, topknot hairstyle held by a small headpiece, no facial features visible at all, no weapon in hand, silhouette read entirely from the outline of robe hem, sleeve fall, sash ends and topknot
Expression / pose / action: neutral ready stance, weight low and centered, one foot forward, arms relaxed and slightly away from the body, facing three-quarter left (default_neutral baseline — this image will serve as anchor for all derived pose variants)
Composition: full body standing, centered, plain pure white seamless background, even soft studio lighting with no cast shadows on background, vertical portrait orientation
Style: solid single-color ink silhouette, brush-painted edge quality with slight bleed and dry-brush texture at the hem and sleeve tips, East Asian ink wash sensibility, absolutely no interior shading, no gradients, no line art inside the shape
Palette / tone: pure black shape on pure white background, no other color anywhere
Format: PNG, 1024x2048 (background will be removed in a subsequent Nano Banana step — do NOT attempt transparent output)
Avoid (negative prompt): facial features, eyes, interior detail, cel shading, gradients, outlines around the silhouette, watermarks, text, weapons, complex background, cast shadow on background, cropped limbs
```

MJ V1-V4 중 자세 안정성·도포 실루엣 가독성이 가장 높은 1장 선택 → `assets/art/silhouettes/sil_master_base_raw.png` 임시 저장 (manifest 미등록, [A-variant] 입력 anchor).

**[A-variant] NB variant edit 프롬프트** (변형당 NB 1회 호출 · base 첨부 후 호출 · 총 6 pass)

Pass 0 — `stance` 완성 (BG 제거 / alpha / 리사이즈, 자세 변경 없음):

```
Take the attached ink silhouette (martial arts master, ready stance, plain white background).
Remove the white background completely — output transparent PNG with a clean alpha edge around the silhouette. Do not alter the pose, proportions, or the brush edge quality. Resize to exactly 512x1024.
Output filename: sil_master_stance.png
```

Pass 1 ~ 5 — derived 자세 변형 (base 첨부 + 자세만 modify + BG 제거 + alpha):

```
Take the attached ink silhouette (martial arts master, ready stance, plain white background).
Keep the character identity, robe shape (long robe with wide sleeves and waist sash), body proportions (tall, broad-shouldered), topknot hairstyle, the solid flat black fill with no interior detail, and the brush-painted edge quality IDENTICAL to the attached base. Do not re-render from scratch — edit the attached image.

Modify ONLY the pose described below.

Background: remove the white background completely — output transparent PNG with clean alpha edge around the silhouette.
Format: transparent PNG, 512x1024, silhouette vertically centered on the canvas with transparent margin where the pose does not reach.
Output filename: as specified below.
```

| pass | variant.pose | variant.output_filename |
|---|---|---|
| 1 | standing calmly at rest inside a dojo, feet together, hands loosely at the sides, facing three-quarter right | `sil_master_dojo.png` |
| 2 | seen from behind, cropped at the chest so only the back of the head, topknot and shoulders are in frame, occupying the lower half of the canvas as a foreground observer | `sil_master_watch.png` |
| 3 | demonstrating a technique, body only — both arms REMOVED from the shape entirely (arms are supplied as a separate layer), torso turned three-quarter left with weight on the front foot | `sil_master_demo_body.png` |
| 4 | a single pair of arms only, no torso, extended forward and slightly upward in a demonstrating gesture, drawn to attach at the shoulder joints of the previous body image, pivot point at the shoulder | `sil_master_demo_arm.png` |
| 5 | fallen and face down on the ground, prone, one arm folded under, robe spread out, occupying only the lower third of the canvas — readable as a person and not as a black blob, so keep the head, shoulder, hip and robe hem separations distinct | `sil_master_prone.png` |

**[A-ko] 한글 외주 명세** (외주 작가 fallback 입력 · [A] 의 한글 의역 1:1)

```
주제: 무협 사부 1인의 전신 먹 실루엣 6자세 (일괄 납품)
캐릭터 외형: 성인 남성 무술 사부 · 키가 크고 어깨가 넓다 · 무릎 아래까지 오는 도포(넓은 소매) · 허리에 넓은 띠 · 상투 머리에 작은 관 · 이목구비는 전혀 그리지 않는다 · 무기 없음 · 실루엣은 도포 자락·소매 낙차·띠 끝·상투의 윤곽만으로 읽힌다
표정 / 포즈 / 동작: ① 대치 준비 자세(무게 낮게, 한 발 앞, 팔은 몸에서 살짝 벌림, 좌 3/4) ② 도장에서 편히 선 자세(발 모음, 손 자연스럽게 내림, 우 3/4) ③ 뒤에서 본 뒷모습 — 가슴에서 잘려 뒤통수·상투·어깨만, 캔버스 아래 절반을 차지하는 전경 인물 ④ 시범 자세 몸통만 — 팔을 형태에서 완전히 제외(팔은 별도 파일) ⑤ 팔만 — 몸통 없이, 앞으로 살짝 위를 향해 뻗은 시범 제스처, 어깨 관절이 회전 축이 되도록 ④ 의 어깨에 맞물리게 ⑥ 엎어져 쓰러진 자세 — 한 팔은 몸 아래로 접히고 도포가 펼쳐짐, 캔버스 아래 1/3만 차지, 검은 덩어리가 아니라 사람으로 읽히도록 머리·어깨·엉덩이·도포단의 경계를 살릴 것
구도: 전신 중앙 정렬 · 세로 방향 · ①②④⑤ 는 캔버스 세로를 대부분 채우고 ③⑥ 은 지정 영역만
화풍: 단색 먹 실루엣 · 붓으로 친 가장자리(도포 자락·소매 끝에 약간의 번짐과 갈필) · 내부 음영·그라디언트·내부 선 일절 없음
팔레트 / 톤: 순수 검정 도형 · 다른 색 없음
포맷: 투명 PNG · 512x1024 · 6파일 일괄
회피 (negative): 이목구비 · 내부 디테일 · 셀 셰이딩 · 그라디언트 · 실루엣 외곽선 · 워터마크 · 글자 · 무기 · 배경 · 사지 잘림(③ 제외)
```

**[B] 추가 지침**

- MJ base 는 1024x2048 로 뽑고 NB pass 에서 512x1024 로 다운스케일한다 — 실루엣 가장자리의 붓 질감이 축소 후에도 남는지 Pass 0 에서 먼저 검수하고, 부실하면 [A-base] 를 재호출한다(anchor 부실은 파생 5장에 전부 증폭된다).
- Pass 3·4(시범 몸통 / 팔)는 **어깨 관절이 정확히 맞물려야** 팔 회전 트랜지션(REQ-861)이 성립한다. 두 파일을 겹쳐 확인한 뒤 납품한다.
- `sil_disciple` · `sil_challenger` 생성 시 이 캐릭터의 Pass 0 산출본을 톤 reference 로 첨부해 붓 질감을 맞춘다.
- `sil_master_base_raw.png` 는 manifest 미등록 · 빌드 복사 제외 — 최종 6파일 산출 후 삭제 가능.

**[C] 내부 참조**

- REQ 매핑: REQ-932(실루엣 PNG 교체) · REQ-821(역광 위에 얹히는 대상) · REQ-854(관전 뒷모습) · REQ-861(팔 분리 회전) · REQ-875(승자/패자 자세)
- consistency_group: `ink_silhouette` — `sil_disciple` · `sil_challenger` 와 동시 비교 대상
- 메모: 결정 로그가 「먹 실루엣 노선이 성립한다는 사실을 확정한 것이지 현행 형상을 확정한 것이 아니다」라고 명시 부인했다. 현행 인라인 SVG 는 이 산출물로 대체된다.

### [sil_disciple] 제자 먹 실루엣 4자세

**[A-base] MJ base 생성 프롬프트**

```
Subject: a single young martial arts disciple, full body, standing at rest, rendered as a solid flat ink silhouette with no interior detail
Character appearance: teenage or young adult apprentice, noticeably shorter and narrower in the shoulders than a grown master, simple short training robe ending at mid-thigh over loose trousers, cloth belt, hair tied in a small high knot with no headpiece, no facial features visible at all, no weapon, silhouette read entirely from the outline of the short robe hem, trouser fall and hair knot
Expression / pose / action: standing at rest, feet together, hands loosely at the sides, facing three-quarter right (default_neutral baseline — this image will serve as anchor for all derived pose variants)
Composition: full body standing, centered, plain pure white seamless background, even soft studio lighting with no cast shadows on background, vertical portrait orientation
Style: solid single-color ink silhouette, brush-painted edge quality with slight bleed and dry-brush texture at the hem and sleeve tips, East Asian ink wash sensibility, absolutely no interior shading, no gradients, no line art inside the shape
Palette / tone: pure black shape on pure white background, no other color anywhere
Format: PNG, 1024x2048 (background will be removed in a subsequent Nano Banana step — do NOT attempt transparent output)
Avoid (negative prompt): facial features, interior detail, cel shading, gradients, outlines around the silhouette, watermarks, text, weapons, complex background, cast shadow on background, adult proportions, long flowing robe
```

MJ V1-V4 중 사부와의 체격 대비가 가장 뚜렷한 1장 선택 → `assets/art/silhouettes/sil_disciple_base_raw.png` 임시 저장.

**[A-variant] NB variant edit 프롬프트** (총 4 pass)

Pass 0 — `dojo` 완성:

```
Take the attached ink silhouette (young disciple, standing at rest, plain white background).
Remove the white background completely — output transparent PNG with a clean alpha edge around the silhouette. Do not alter the pose, proportions, or the brush edge quality. Resize to exactly 512x1024.
Output filename: sil_disciple_dojo.png
```

Pass 1 ~ 3 — derived 자세 변형:

```
Take the attached ink silhouette (young disciple, standing at rest, plain white background).
Keep the character identity, short training robe and trousers, smaller body proportions, small high hair knot, the solid flat black fill with no interior detail, and the brush-painted edge quality IDENTICAL to the attached base. Do not re-render from scratch — edit the attached image.

Modify ONLY the pose described below.

Background: remove the white background completely — output transparent PNG with clean alpha edge around the silhouette.
Format: transparent PNG, 512x1024, silhouette vertically centered on the canvas with transparent margin where the pose does not reach.
Output filename: as specified below.
```

| pass | variant.pose | variant.output_filename |
|---|---|---|
| 1 | ready combat stance facing three-quarter left, weight low and centered, one foot forward, arms slightly away from the body — mirroring a master's fighting stance but with the smaller apprentice proportions | `sil_disciple_stance.png` |
| 2 | copying a demonstrated technique, body only — both arms REMOVED from the shape entirely (arms are supplied as a separate layer), torso turned three-quarter left with weight on the front foot | `sil_disciple_follow_body.png` |
| 3 | a single pair of arms only, no torso, raised forward in an imitating gesture but at a slightly awkward angle as if not yet matching the teacher, drawn to attach at the shoulder joints of the previous body image, pivot point at the shoulder | `sil_disciple_follow_arm.png` |

**[A-ko] 한글 외주 명세**

```
주제: 무협 제자 1인의 전신 먹 실루엣 4자세 (일괄 납품)
캐릭터 외형: 십대~청년 견습생 · 사부보다 눈에 띄게 작고 어깨가 좁다 · 허벅지 중간까지 오는 짧은 수련복 + 헐렁한 바지 · 천 허리띠 · 관 없이 작게 묶은 상투 · 이목구비 전혀 없음 · 무기 없음 · 실루엣은 짧은 옷자락·바지 낙차·머리 묶음의 윤곽으로 읽힌다
표정 / 포즈 / 동작: ① 편히 선 자세(발 모음, 손 자연스럽게 내림, 우 3/4) ② 대치 준비 자세(좌 3/4, 무게 낮게, 한 발 앞 — 사부의 자세를 작은 체격으로 옮긴 것) ③ 따라 하기 몸통만 — 팔을 형태에서 완전히 제외(팔은 별도 파일) ④ 팔만 — 몸통 없이, 흉내 내듯 앞으로 들어 올렸으되 아직 사부와 어긋난 각도, ③ 의 어깨에 맞물리게(회전 축은 어깨)
구도: 전신 중앙 정렬 · 세로 방향
화풍: 단색 먹 실루엣 · 붓으로 친 가장자리 · 내부 음영·그라디언트·내부 선 일절 없음
팔레트 / 톤: 순수 검정 도형 · 다른 색 없음
포맷: 투명 PNG · 512x1024 · 4파일 일괄
회피 (negative): 이목구비 · 내부 디테일 · 셀 셰이딩 · 그라디언트 · 외곽선 · 워터마크 · 글자 · 무기 · 배경 · 성인 체형 · 긴 도포
```

**[B] 추가 지침**

- `sil_master` Pass 0 산출본 1장을 톤 reference 로 첨부해 붓 질감을 맞춘다. **체격 대비가 이 자산의 존재 이유** — 나란히 놓았을 때 누가 사부이고 누가 제자인지 실루엣만으로 갈려야 한다.
- Pass 2·3(따라 하기 몸통 / 팔)의 어깨 관절은 `sil_master` Pass 3·4 와 **같은 회전 축 규약**을 쓴다 — 두 인물의 팔이 같은 각도에서 나란해지는 것이 전수 완료의 연출이다(REQ-861).
- `sil_disciple_base_raw.png` 는 manifest 미등록 · 빌드 복사 제외.

**[C] 내부 참조**

- REQ 매핑: REQ-932 · REQ-833(도장 정경 제자) · REQ-850(아레나에 서는 제자) · REQ-860/REQ-861(따라 하기)
- consistency_group: `ink_silhouette`
- 메모: 제자는 S2 정경·S4 아레나·S5 전수 3화면에 등장한다. 체격 대비가 무너지면 S5 의 「사부와 제자」가 「같은 사람 둘」이 된다.

### [sil_challenger] 도전자 먹 실루엣 2자세

**[A-base] MJ base 생성 프롬프트**

```
Subject: a single rival martial artist, full body, standing in an aggressive ready stance, rendered as a solid flat ink silhouette with no interior detail
Character appearance: adult martial artist of a rival school, lean and angular, mid-length coat with a sharply cut asymmetric hem and a high collar, narrow sash, hair worn long and loose rather than tied in a topknot, a straight sword carried low in one hand, no facial features visible at all, silhouette read entirely from the outline of the angular coat hem, loose hair and the sword line
Expression / pose / action: aggressive ready stance, weight forward, sword hand low and away from the body, facing three-quarter right (default_neutral baseline — this image will serve as anchor for the derived pose variant)
Composition: full body standing, centered, plain pure white seamless background, even soft studio lighting with no cast shadows on background, vertical portrait orientation
Style: solid single-color ink silhouette, brush-painted edge quality with slight bleed and dry-brush texture at the hem and hair tips, East Asian ink wash sensibility, absolutely no interior shading, no gradients, no line art inside the shape
Palette / tone: pure black shape on pure white background, no other color anywhere
Format: PNG, 1024x2048 (background will be removed in a subsequent Nano Banana step — do NOT attempt transparent output)
Avoid (negative prompt): facial features, interior detail, cel shading, gradients, outlines around the silhouette, watermarks, text, complex background, cast shadow on background, topknot hairstyle, long flowing robe
```

MJ V1-V4 중 사부(도포·상투)와 실루엣이 가장 뚜렷하게 갈리는 1장 선택 → `assets/art/silhouettes/sil_challenger_base_raw.png` 임시 저장.

**[A-variant] NB variant edit 프롬프트** (총 2 pass)

Pass 0 — `stance` 완성:

```
Take the attached ink silhouette (rival martial artist, aggressive ready stance, plain white background).
Remove the white background completely — output transparent PNG with a clean alpha edge around the silhouette. Do not alter the pose, proportions, or the brush edge quality. Resize to exactly 512x1024.
Output filename: sil_challenger_stance.png
```

Pass 1 — derived 자세 변형:

```
Take the attached ink silhouette (rival martial artist, aggressive ready stance, plain white background).
Keep the character identity, angular asymmetric coat with high collar, lean proportions, long loose hair, the sword, the solid flat black fill with no interior detail, and the brush-painted edge quality IDENTICAL to the attached base. Do not re-render from scratch — edit the attached image.

Modify ONLY the pose: fallen and face down on the ground, prone, the sword dropped just out of the hand, coat spread out, occupying only the lower third of the canvas — readable as a person and not as a black blob, so keep the head, shoulder, hip and coat hem separations distinct.

Background: remove the white background completely — output transparent PNG with clean alpha edge around the silhouette.
Format: transparent PNG, 512x1024, silhouette placed in the lower third of the canvas with transparent margin above.
Output filename: sil_challenger_prone.png
```

**[A-ko] 한글 외주 명세**

```
주제: 무협 도전자(적대 문파) 1인의 전신 먹 실루엣 2자세 (일괄 납품)
캐릭터 외형: 성인 무인 · 마르고 각진 체형 · 비대칭으로 날카롭게 재단된 중간 길이 코트 + 높은 깃 · 좁은 띠 · 상투가 아니라 길게 푼 머리 · 한 손에 직검을 낮게 들었다 · 이목구비 전혀 없음 · 실루엣은 각진 옷자락·풀어헤친 머리·검의 선으로 읽힌다
표정 / 포즈 / 동작: ① 공격적인 준비 자세(무게 앞, 검 든 손은 낮게 몸에서 벌림, 우 3/4) ② 엎어져 쓰러진 자세 — 검은 손에서 막 떨어져 나갔고 코트가 펼쳐짐, 캔버스 아래 1/3만 차지, 검은 덩어리가 아니라 사람으로 읽히도록 머리·어깨·엉덩이·옷단 경계를 살릴 것
구도: 전신 중앙 정렬 · 세로 방향 · ② 는 캔버스 아래 1/3
화풍: 단색 먹 실루엣 · 붓으로 친 가장자리 · 내부 음영·그라디언트·내부 선 일절 없음
팔레트 / 톤: 순수 검정 도형 · 다른 색 없음
포맷: 투명 PNG · 512x1024 · 2파일 일괄
회피 (negative): 이목구비 · 내부 디테일 · 셀 셰이딩 · 그라디언트 · 외곽선 · 워터마크 · 글자 · 배경 · 상투 · 긴 도포
```

**[B] 추가 지침**

- `sil_master` Pass 0 산출본 1장을 톤 reference 로 첨부한다. **사부와의 구분이 이 자산의 존재 이유** — 아레나에 둘이 마주 섰을 때 도포·상투 대 각진 코트·푼 머리로 갈려야 한다.
- 결과 화면(S6)은 승패에 따라 이 인물과 사부의 자리가 맞바뀐다 — `stance` 는 승자 자세로, `prone` 은 패자 자세로 재사용되므로 두 자세가 **같은 인물로 읽히는지** 나란히 확인한다.
- `sil_challenger_base_raw.png` 는 manifest 미등록 · 빌드 복사 제외.

**[C] 내부 참조**

- REQ 매핑: REQ-932 · REQ-821(대각 대치) · REQ-850(파견 상대) · REQ-875(승자/패자 맞바꿈)
- consistency_group: `ink_silhouette`
- 메모: M1 은 도전자 1종으로 A-1~A-4 를 공용한다. 도전자별 실루엣 분화는 M2 아트 확장의 몫이다.

### [sfx_key] 방향 키 타격음

**[A] Sound 필드**

```
A very short, dry percussive tick — a single wooden clave hit with almost no sustain and no reverb tail. Clean, neutral, no pitch character of its own. 0.1 second long.
```

**[B] 추가 지침**

- Type: One-Shot. BPM: Auto. Key: Any.
- 재생 시 코드가 피치를 랜덤화하므로(REQ-922) **원본은 무색·무잔향**이어야 한다 — 잔향이 있으면 피치 변조가 금속성으로 들린다.
- 폴백 = ElevenLabs SFX / Freesound(CC0).

**[C] 내부 참조**

- REQ 매핑: REQ-922 · REQ-828(입력 트레일과 동시 발화)
- 트리거: 방향 키 1회 입력마다 · 연타 시 중첩 재생 허용

### [sfx_lock] 후보 확정음

**[A] Sound 필드**

```
A short, satisfying mechanical lock-in — a crisp latch click with a faint metallic ring that decays immediately. Confident and final, not sharp or alarming. 0.25 second long.
```

**[B] 추가 지침**

- Type: One-Shot. BPM: Auto.
- `.only` 금테 확대(REQ-826)와 같은 순간에 난다 — 최소 표시 시간 안에 소리가 끝나야 판정음과 겹치지 않는다.

**[C] 내부 참조**

- REQ 매핑: REQ-923 · REQ-824 · REQ-826
- 트리거: 후보가 1개로 좁혀지는 순간 1회

### [sfx_break] 완파 결정음

**[A] Sound 필드**

```
A powerful impact for a decisive martial arts finishing blow — a deep body-thud layered with a sharp cloth snap and a brief low resonance underneath, ending cleanly. Triumphant and heavy, no musical tone, no metallic clang. 0.6 second long.
```

**[B] 추가 지침**

- Type: One-Shot. BPM: Auto.
- 화면 흔들림(REQ-815)과 동시에 난다 — 6단 판정 중 유일하게 통쾌해야 하는 소리이므로 `sfx_clash` 보다 확실히 무겁게 뽑는다.

**[C] 내부 참조**

- REQ 매핑: REQ-924 · REQ-814 · REQ-815
- 트리거: 판정 = 완파

### [sfx_clash] 중립 교차음

**[A] Sound 필드**

```
Two martial arts strikes meeting mid-air — a short, dry collision of cloth and wood with a light scatter of debris, neutral in weight, neither triumphant nor painful. 0.35 second long.
```

**[B] 추가 지침**

- Type: One-Shot. BPM: Auto.
- 우세·상쇄·열세 3등급을 한 소리로 덮는다(REQ-924) — **승패를 말하지 않는 것**이 이 소리의 요구사항이다.

**[C] 내부 참조**

- REQ 매핑: REQ-924 · REQ-814
- 트리거: 판정 ∈ {우세, 상쇄, 열세}

### [sfx_hit] 피격음

**[A] Sound 필드**

```
A dull, unpleasant body impact — a muffled low thud with a short compressed tail, as if the listener themselves were struck. Heavy and negative, no brightness, no metallic content. 0.5 second long.
```

**[B] 추가 지침**

- Type: One-Shot. BPM: Auto.
- 피해 비네트와 동시에 난다 — `sfx_break` 와 **정반대 방향**으로 읽혀야 하므로 밝은 성분을 빼고 눌린 저역으로 뽑는다.

**[C] 내부 참조**

- REQ 매핑: REQ-924 · REQ-814 · REQ-815(역파도 흔들림 대상)
- 트리거: 판정 ∈ {역파, 피격}

### [sfx_rank] 성 상승음

**[A] Sound 필드**

```
A short, clear ascending chime — two soft struck-metal tones rising a small interval, warm and bright with a brief decay. A small reward, not a fanfare. 0.7 second long.
```

**[B] 추가 지침**

- Type: One-Shot. BPM: Auto. Key: Any (BGM 과 부딪히면 BGM 키에 맞춰 재생성).
- 결과 화면의 발광 칸(REQ-873)과 짝이다 — 한 판에 여러 칸이 오르면 코드가 연쇄 재생하므로 **꼬리가 짧아야** 겹쳐도 뭉치지 않는다.

**[C] 내부 참조**

- REQ 매핑: REQ-925 · REQ-873 · REQ-817
- 트리거: 성이 1칸 오를 때마다 1회

### [bgm_dojo] 도장·대련 공용 배경 루프

**[A-1] Lyrics 필드** (Write 모드 · 구조 메타태그만)

```
[Intro]
(a single low struck string, wide silence around it)
[Instrumental]
(sparse plucked strings over a low sustained drone, no vocals)
[Instrumental Break]
(the drone alone, one breath of near-silence)
[Bridge]
(the same plucked figure returns unchanged, no climax)
[Outro]
(the drone thins out and holds)
```

**[A-2] Style 필드**

```
Genre / mood: East Asian traditional instrumental, restrained martial arts tension, spacious and austere, no vocals
BPM / key: ~64 BPM, D minor pentatonic, steady tempo throughout
Instrumentation: foreground plucked zither, background low bowed string drone, occasional single struck wood block for space, no percussion kit
Melody: a short plucked figure repeating every 8 bars, deliberately unmemorable, no hooks, no key changes, no builds
```

**[A-3] Exclude 필드**

```
drums, drum kit, percussion loop, vocals, choir, brass, orchestral swell, key change, climax, fade-out ending, cinematic trailer hits, synth pads
```

**[B] 추가 지침**

- Suno Custom 모드 · v5 이상. **Instrumental 토글은 켜지 말 것** — Lyrics 필드가 비활성화돼 [A-1] 구조 태그를 못 넣고 짧은 클립으로 끝난다. 무보컬은 [A-2] `no vocals` + [A-1] 괄호 묘사로 유지한다.
- 슬라이더 — Weirdness 낮게(균질한 텍스처), Style Influence 높게.
- **무이음 루프는 Suno 가 직접 못 만든다** — 길게 생성한 뒤 DAW 로 가장 균질한 구간을 잘라 루프 포인트를 만든다. 아트 계약의 `bgm_loop: true` 는 이 루프 처리가 끝난 파일을 가리킨다.
- 도장과 대련이 같은 트랙을 쓴다(REQ-926) — 어느 화면에서 진입해도 어색하지 않게 **감정의 방향이 없어야** 한다.

**[C] 내부 참조**

- REQ 매핑: REQ-926 · REQ-920(재생 모듈) · REQ-921(자동재생 정책)
- 트리거 컨텍스트: 도장 진입 시 재생 시작, 대련·수련·파견 전환에도 끊기지 않고 지속. 상황별 분기는 M3

## 수용 기준 (Acceptance Criteria)

> 본 spec 의 명세를 만족했는지 확인하는 외부 관찰 가능한 기준.
> 구현 plan 의 검증 4단계와는 다른 layer — 후자는 `/gamedev-build` → 글로벌 Plan-driven Flow 가 별도로 정의한다.

### 1. 데이터/빌드

- [ ] `node --check` 전 `*.mjs` 통과 · `scripts/check-imports.mjs` 모듈 그래프 링크 통과 · `node tests/harness.mjs` 통과 (CI job `ci` green)
- [ ] 서브셋 폰트 4파일이 번들에 존재하고 라이선스 파일이 동봉되어 있다 *(REQ-930)*
- [ ] 폰트 커버리지 CI 게이트가 존재하고, 미커버 글리프를 심으면 실패하며 그 글자를 열거한다 *(REQ-804)*
- [ ] 아트 계약 표의 10 id 가 전부 `assets/` 아래 존재하고 format·dimensions·alpha 가 표와 일치한다 *(REQ-932 · § 아트 계약)*
- [ ] `sil_*_base_raw.png` 3파일이 빌드 산출물에 진입하지 않는다
- [ ] 출하 코드에 `.ui-annotate-*` / `body.ui-capture` 규칙이 없다

### 2. 동작 (input → expected)

- [ ] 케이스 1 *(REQ-801, REQ-802)*: S6 결과 화면 진입 → 무대가 y=0 에서 시작하고 상단 띠가 없으며, 전역 padding 이 콘텐츠를 밀지 않는다
- [ ] 케이스 2 *(REQ-814, REQ-815, REQ-816)*: 6단 판정을 하나씩 발생 → 위치·크기·색·자형 4축이 등급마다 다르고, 완파·역파에서만 흔들리며, 흔들림 중 스테이지 스케일이 튀지 않는다
- [ ] 케이스 3 *(REQ-824, REQ-825)*: 후보 4 → 2 → 1 로 좁혀지는 시퀀스 입력 → 죽간이 4매 → 2매 → 1매로 줄고 폭·위치가 전이하며, 탈락 죽간은 흐려지며 가라앉은 뒤 사라진다
- [ ] 케이스 4 *(REQ-826)*: 마지막 키가 후보 확정과 시퀀스 완주를 겸하는 초식 발동 → 금테 확대가 최소 표시 시간 동안 보인 뒤 판정 오버레이가 뜬다
- [ ] 케이스 5 *(REQ-830, REQ-831, REQ-817)*: 8성 초식·12성 초식·잠긴 초식이 섞인 도장 진입 → 8성 행은 7↔8 사이 주사색 벽과 다음 계단 안내를 보이고, 12성·잠김 행은 게이지가 접히고 배지만 남는다
- [ ] 케이스 6 *(REQ-818)*: 8성 벽을 넘는 판을 끝냄 → 결과 화면에서 벽 칸의 발광이 살아 있다
- [ ] 케이스 7 *(REQ-852, REQ-853)*: 파견 관전 진행 → 매 초 「우세를 골랐다 / 상쇄를 골랐다 / 역파를 피했다」 중 실제 선택 이유가 표시된다
- [ ] 케이스 8 *(REQ-855)*: 제자가 파해를 보유한 초 → 해당 죽간만 금색으로 맥동하며 「파해」 꼬리표가 붙고(`.slip.beckon`), 그 초를 지시한 죽간의 굳은 금테 + 「지시」 꼬리표(`.slip.picked`)와 형태·꼬리표로 구분된다
- [ ] 케이스 9 *(REQ-861, REQ-865)*: 전수 실행 → 제자의 팔이 사부와 나란해지는 전이가 일어나고, 연출 중에는 「건너뛰기」·완료 후 「도장으로」가 항상 바닥에 있다
- [ ] 케이스 10 *(REQ-871, REQ-876, REQ-877)*: 대련 승리 / 대련 패배 / 재대련 승리 / 파견 완수 4상태의 결과 화면 → 고정 3블록의 자리·순서가 4상태 모두 동일하고, 패배에도 성 변화·판정 분포가 있으며, 재대련은 재화 문장 + 전리품 없음이다
- [ ] 케이스 11 *(REQ-878)*: 성이 오른 초식 4개인 결과 화면 → 정산부가 스크롤되고 하단 확정 버튼이 잘리지 않는다
- [ ] 케이스 12 *(REQ-882, REQ-883, REQ-884, REQ-894)*: 절초 보유 도전자를 **첫 대면**으로 열기 → 상대 초식 카드가 없고 첫 대면 안내 + 절초 소문만 보인다. 같은 도전자를 이긴 뒤 다시 열기 → 초식 3매 + 절초 이름 + 파해 대상이 공개된다
- [ ] 케이스 13 *(REQ-886)*: A-4 브리핑에서 슬롯 칸 탭 → 화면 전환 없이 슬롯이 교체되고 경고가 주사색에서 금색 확인으로 바뀐다
- [ ] 케이스 14 *(REQ-881)*: 도전자 6행 상태로 진입 → 목록만 스크롤되고 「대련 시작」이 항상 보인다
- [ ] 케이스 15 *(REQ-890, REQ-893, REQ-895)*: 7화면 전수 순회 → `元` 0건 · 공방 회차 표기가 전부 「초」 · `A-n`/`B-n` 식별자 0건이며, 로그에는 `stage: B-1` 이 그대로 남아 있다
- [ ] 케이스 16 *(REQ-897)*: 7화면 전수 순회 → 상단 띠를 쓰는 화면의 좌측 첫 자리가 전부 물러나기이고, 예외는 S2(자리 비움)·S6(띠 없음) 둘뿐이다
- [ ] 케이스 17 *(REQ-813)*: 7화면 전수 순회 → 한자 단독 표기 0건이며 모든 한자가 `.hj` 클래스를 통해 렌더된다
- [ ] 케이스 18 *(REQ-921, REQ-922, REQ-924)*: 새 탭에서 첫 입력 → 그 입력부터 소리가 나고, 방향 키 연타 시 피치가 매번 다르며, 6단 판정이 3계열 중 맞는 소리를 낸다
- [ ] 케이스 19 *(REQ-910, REQ-911)*: 키보드만으로 죽간·도전자 행 조작 → 포커스가 도달하고 낭독되며, 잠긴 버튼은 포커스를 받지 않는다
- [ ] 케이스 20 *(REQ-806, REQ-807)*: 화면을 여러 번 전환한 뒤 판정 발생 → 판정이 스크린 리더로 낭독된다
- [ ] **L4 시안 대조 *(S1)***: 구현 캡처 ↔ `duel_v5_input.png` 나란히 비교 → 구조 요소·폰트 계열·색 톤 일치 (픽셀 동일성 아님)
- [ ] **L4 시안 대조 *(S2)***: 구현 캡처 ↔ `dojo_v2_growth.png` 나란히 비교 → 구조 요소·폰트 계열·색 톤 일치
- [ ] **L4 시안 대조 *(S3)***: 구현 캡처 ↔ `train_v4_input.png` 나란히 비교 → 구조 요소·폰트 계열·색 톤 일치
- [ ] **L4 시안 대조 *(S4)***: 구현 캡처 ↔ `dispatch_v1_beckon.png` 나란히 비교 → 구조 요소·폰트 계열·색 톤 일치
- [ ] **L4 시안 대조 *(S5)***: 구현 캡처 ↔ `transmit_v2_done.png` 나란히 비교 → 구조 요소·폰트 계열·색 톤 일치
- [ ] **L4 시안 대조 *(S6)***: 구현 캡처 ↔ `result_v2_duel.png` 나란히 비교 → 구조 요소·폰트 계열·색 톤 일치
- [ ] **L4 시안 대조 *(S7)***: 구현 캡처 ↔ `select_v2_first.png` 나란히 비교 → 구조 요소·폰트 계열·색 톤 일치

### 3. 회귀 (영향 범위)

- [ ] `gradeOf` (6단 판정·파해·속성 삼각)와 성장 로직의 **수치 거동 무변경** — 본 spec 은 표시 층이며 REQ-853(선택 이유 반환)만이 DOM-free 층을 건드린다
- [ ] `selectDiscipleStyle` 이 반환 형태를 바꾼 뒤에도 harness 의 봇 사이클 assertion 이 전부 통과한다 *(REQ-853)*
- [ ] `src/` 루트와 harness 가 import 하는 `src/ui/` 4모듈에 `document` 참조가 들어가지 않았다
- [ ] 「수」 → 「초」 교체가 **시퀀스 길이 표기(`3수 초식`)와 영문 식별자를 건드리지 않았다** *(REQ-893)*
- [ ] 기존 로그 이벤트의 필드 이름·의미가 바뀌지 않았다 *(§ 통합 로그 스키마)*

### 4. 셀프 플레이 + 검증 로그 박기

- [ ] 7화면 전수를 도는 셀프 플레이 3회(대련 승 / 대련 패 / 파견 완수) — 개발자 본인 1인, 외부 테스터 없음
- [ ] 저사양 실기 1대에서 판정 프레임 예산 측정 — 흔들림 + 96px 글로우 + 스크림이 겹치는 프레임의 p95 *(REQ-915)*
- [ ] 검증 로그 5종이 빌드에 박혔다 — `screen_view` · `font_ready` · `frame_budget` · `undo_used` · `audio_state` *(§ 통합 로그 스키마)*
- [ ] `docs/ai-log.md` 에 아트·사운드 생성 도구의 채택/수정/폐기 결정이 **결정 시점에** 적혔다 (사후 재구성 금지 — 과제 제출물)
- [ ] `docs/balance-log.md` 에 본 사이클의 판본(rev)이 기록되고, 봇 페이스 회귀가 재설계 전후로 비교됐다

## 관련 Backlog

본 spec 호출 시 § 4.5 drain 게이트가 결정 로그의 § 잔여 논의 6건 + § 후속 작업 19건을 결정 시점 즉시 처분했다. 종료 조건 = backlog `## 활성 항목` = 0.

- 결정 버퍼 파일: [[backlog_화면-UI-아트-재설계]] (해소 이력만 누적, 활성은 0 상태)
- ⓒ 로드맵 행 승격 1건: 캐릭터 프레임 애니메이션(M2) — 로드맵 노트 `3. 로드맵/로드맵 현황.md` 거주
- 원칙 SoT: 메모리 `gamedev-residue-drain-principle`

## 참고 자료

- [[ui_화면_UI_아트_재설계]] — 본 spec 의 유일한 소스. 7화면 축별 결정·요소 인벤토리·시안 PNG 42장·목업 HTML 은 전부 거기 있다
- [[spec_프로토타입_v2_통합_PRD]] — 판정·입력 규칙 SoT. § ⑨ 가 「元」·「수」 표기를 개정한다
- [[spec_성_축_초식_단위_재설계]] — 성·해금·전수·파견·재대련 규칙 SoT. § ⑨ 가 REQ-732 를 개정한다
- `docs/design/glossary.md` — 용어 SoT. 본 spec 이 「초」·「냥」·화면 요소 용어를 append 한다
- `docs/research/2026-09-01_UI-아트-레퍼런스-조사.md` (#25 / PR #26) — 5축 조사 + 그래픽 스타일 후보 3안, 권고 = ① 먹 실루엣
- `docs/screenshots/` — 현행 빌드 15종 (#53). 진단의 근거이자 L4 시안 대조의 before
- 목업 7종 — `docs/design/1.02-화면-UI-아트-재설계/mockups/` (HTML · `assets/` 실물 에셋). CSS 층은 거의 그대로 이식된다

## 메타

- 커맨드: `/gamedev-spec`
- 버전: v0.19 (2026-08-31). 이전 변경 이력은 git log 참조
- 생성 시각: 2026-09-02 13:10 KST
- 후속 구현 진입: 게임 저장소 cwd 의 새 세션에서 `/gamedev-build docs/design/1.02-화면-UI-아트-재설계/spec_화면_UI_아트_재설계.md` → 글로벌 Plan-driven Flow 11단계. **분해 시 REQ-801(B6 싱글턴 크롬 해체)이 첫 유닛이고 화면 이식 7종이 그 뒤다** — B6 는 7화면 전부를 막는 선행 구조 변경이다
- 후속:
  - 구현 중 명세 변경 발생 시 → 본 spec 을 Edit 으로 갱신하고 **해당 구현 PR 에 동승**시킨다 (별도 T0 PR 아님)
  - 대규모 재설계 시 → 새 안건으로 `/gamedev-ui` 또는 `/gamedev-brief` 재호출
