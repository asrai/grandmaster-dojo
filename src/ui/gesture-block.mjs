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

/**
 * WebKit 이 두 탭을 확대로 읽는 최대 간격 — 플랫폼 제스처 상수라 게임-룰 원장이 아니라 여기 산다.
 * 이 값보다 짧은 간격이 곧 「연타」이므로, 차단이 무는 구간과 연타 무손실 구간은 같은 구간이다.
 */
export const DOUBLE_TAP_MS = 300;

/**
 * 더블 탭 확대 차단 — `touch-action` 이 iOS 에서 이 억제를 걸지 않아 JS 층이 대신 진다 (#215).
 * 두 번째 탭의 기본 동작을 막으면 WebKit 이 그 탭의 `click` 까지 함께 죽이므로, 입력이 소실되지
 * 않게 같은 타깃으로 click 을 직접 흘린다 — 코어 입력 무손실이 확대 차단보다 우선한다.
 *
 * @param {{addEventListener: Function}} target 배선을 받을 대상 — 문서를 주입해 표면 전역을 덮는다
 * @param {() => number} now 밀리초 시계 — 탭 간격 판정의 유일한 시간 출처다
 * @returns {void}
 */
export function blockDoubleTapZoom(target, now) {
  let lastTapAt = -Infinity;
  target.addEventListener('touchend', (event) => {
    // 핀치의 꼬리는 탭이 아니다 — 손가락이 하나만 떠났고 화면에 남은 것이 없을 때만 탭으로 센다.
    if (event.changedTouches?.length !== 1 || event.touches?.length) return;
    const at = now();
    const isDoubleTap = at - lastTapAt < DOUBLE_TAP_MS;
    lastTapAt = at;
    if (!isDoubleTap) return;
    event.preventDefault();
    // 방향키는 글리프만 든 버튼이고 되돌리기는 자식 span 을 두므로, 버블링이 두 경우를 함께 덮는다.
    event.target?.click?.();
  }, { passive: false });
}
