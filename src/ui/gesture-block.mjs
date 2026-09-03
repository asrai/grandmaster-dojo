// 브라우저 확대 차단 — 확대는 무대 배율 산식 밖에서 뷰포트를 바꾸므로 레터박스 계약을 깬다 (#204).
// 대상을 주입받아 모듈 스코프를 DOM-free 로 유지한다 — 하네스가 같은 배선을 검사할 수 있는 자리다.

/** WebKit 전용 비표준 핀치 제스처 — iOS Safari 가 뷰포트 meta 를 무시하므로 핀치 차단이 여기로 내려온다. */
export const PINCH_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'];

/** 셋을 모두 덮어 어느 단계에서 제스처를 잡든 같은 결과가 되게 한다. */
export function blockPinchZoom(target) {
  for (const type of PINCH_EVENTS) {
    // 브라우저 기본값에 기대지 않고 비-passive 를 못박는다 — passive 리스너의 preventDefault 는 무시된다.
    target.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  }
}

/** WebKit 이 두 탭을 확대로 읽는 최대 간격 — 플랫폼 제스처 상수라 게임-룰 원장이 아니라 여기 산다. */
export const DOUBLE_TAP_MS = 300;

/** 제자리 탭으로 셀 이동 상한(px) — 더 움직인 끝은 타깃 밖으로 뺀 취소라 브라우저도 그 자리를 누르지 않는다. */
const TAP_SLOP_PX = 10;

/** 두 탭을 한 짝으로 셀 거리 상한(px) — 화면 양끝을 번갈아 치는 연타는 확대 판정 대상이 아니다. */
const TAP_PAIR_PX = 40;

const tapPoint = (touch) => (touch ? { x: touch.clientX, y: touch.clientY } : null);
const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 더블 탭 확대 차단 — iOS 가 `touch-action` 으로는 이 억제를 걸지 않아 JS 층이 대신 진다 (#215).
 * 막힌 탭은 그 `click` 까지 함께 죽으므로 같은 타깃으로 직접 흘린다 — 코어 입력 무손실이 확대 차단보다 앞선다.
 *
 * @param {{addEventListener: Function}} target 배선을 받을 대상 — 문서를 주입해 표면 전역을 덮는다
 * @param {() => number} now 밀리초 시계 — 탭 간격 판정의 유일한 시간 출처다
 * @returns {void}
 */
export function blockDoubleTapZoom(target, now) {
  let began = null;
  let lastTap = null;

  target.addEventListener('touchstart', (event) => {
    // 손가락이 둘 이상 닿는 순간은 핀치라, 그 터치는 탭 추적에서 뺀다.
    began = event.touches?.length === 1 ? tapPoint(event.changedTouches?.[0]) : null;
  }, { passive: true });

  target.addEventListener('touchend', (event) => {
    const from = began;
    began = null;
    // 화면에 손가락이 남았거나 여럿이 함께 떨어진 끝은 핀치의 꼬리다.
    if (event.touches?.length || event.changedTouches?.length !== 1) return;
    const ended = tapPoint(event.changedTouches[0]);
    // 타깃은 터치가 시작된 요소로 고정되므로, 밖으로 뺀 취소에 press 를 만들어 주지 않으려면 이동량을 봐야 한다.
    if (!from || !ended || apart(from, ended) > TAP_SLOP_PX) return;
    const at = now();
    const paired = lastTap !== null
      && at - lastTap.at < DOUBLE_TAP_MS
      && apart(lastTap, ended) <= TAP_PAIR_PX;
    lastTap = { ...ended, at };
    if (!paired) return;
    event.preventDefault();
    // 방향키는 글리프만 든 버튼이고 되돌리기는 자식 span 을 두므로, 버블링이 두 경우를 함께 덮는다.
    event.target.click();
  }, { passive: false });
}
