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
