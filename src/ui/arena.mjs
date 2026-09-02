// 아레나 (REQ-821) — S1 대련이 세우고 S3 수련·S4 파견·S6 결과가 그대로 물려받는 무대다.
// 상속이 곧 서사라(REQ-850) 화면마다 바꾸는 것은 셋뿐이고, 그 셋만 인자로 열려 있다:
// 무대 높이(S6 이 360 으로 접는다) · 사람이 서는 자리 · 그 사람의 자세.
// 좌표·색은 전부 `index.html` 의 원장이 지므로 이 모듈에 수치가 없다.

import { el } from './dom.mjs';

/** 사람이 설 수 있는 두 자리 — 대각 대치가 성립하는 최소 집합이다 (REQ-821). */
export const SPOT = { FAR: 'far', NEAR: 'near' };

/**
 * 정경은 상태에 따라 변하지 않는 코드 렌더라 마크업이 상수다 — 실루엣만 PNG 로 간다(REQ-932).
 * 외부 입력이 닿지 않는 정적 리터럴이므로 파싱 한 번으로 세운다.
 */
const SCENERY = `
<svg class="layer ridge" viewBox="0 0 393 440" preserveAspectRatio="none" aria-hidden="true">
  <path class="far" d="M-10 250 C 40 196, 74 218, 112 178 C 150 138, 178 172, 214 150
    C 252 126, 286 164, 322 140 C 352 120, 380 148, 403 132 L 403 440 L -10 440 Z"/>
  <path class="near" d="M-10 300 C 46 266, 92 284, 138 256 C 190 224, 232 258, 278 238
    C 322 218, 362 246, 403 228 L 403 440 L -10 440 Z"/>
</svg>
<svg class="layer bamboo" viewBox="0 0 393 440" preserveAspectRatio="none" aria-hidden="true">
  <g class="stalk">
    <path d="M26 440 C 22 330, 32 240, 20 132"/>
    <path d="M74 440 C 80 346, 68 258, 80 158"/>
    <path d="M340 440 C 346 338, 334 252, 348 150"/>
    <path d="M380 440 C 374 348, 386 264, 372 172"/>
  </g>
  <g class="leaf">
    <path d="M22 218 C 44 206, 60 214, 76 202"/>
    <path d="M78 286 C 56 274, 40 282, 22 272"/>
    <path d="M344 232 C 322 220, 306 228, 290 216"/>
    <path d="M376 308 C 354 298, 338 306, 320 296"/>
  </g>
</svg>`;

/**
 * @param {object} [p]
 * @param {?number} [p.height] 무대 높이(px) — 생략하면 원장의 기본값이고, 접어 쓰는 화면만 준다.
 * @param {{spot: string, id: string, pose: string}[]} [p.figures] 아레나에 서는 사람 —
 *   `id`·`pose` 는 파일 경로가 아니라 에셋 id 이고, 경로 표는 `index.html` 한 곳에 있다 (REQ-932).
 * @returns {{node: HTMLElement, setFigure: (spot: string, fig: {id: string, pose: string}) => void}}
 */
export function createArena({ height = null, figures = [] } = {}) {
  const scenery = el('div', { class: 'scenery', 'aria-hidden': 'true' });
  scenery.innerHTML = SCENERY;

  const node = el('div', {
    class: 'scene',
    style: height === null ? null : `--scene-h:${height}px`,
  }, [el('div', { class: 'layer sky' }), scenery, el('div', { class: 'layer mist' })]);

  // 역광이 없으면 먹 실루엣이 어두운 배경에서 사라진다 — 사람과 한 쌍으로만 존재한다 (REQ-821).
  const placed = new Map(figures.map(({ spot, id, pose }) => {
    node.appendChild(el('div', { class: `backlight ${spot}`, 'aria-hidden': 'true' }));
    const fig = el('div', { class: `fig ${spot} sil-${id}-${pose}`, 'aria-hidden': 'true' });
    node.appendChild(fig);
    return [spot, fig];
  }));

  node.appendChild(el('div', { class: 'layer vignette' }));
  node.appendChild(el('div', { class: 'ground' }));

  return {
    node,
    /** 자세·인물 교체 — 결과 화면이 승패를 자세로 먼저 말하는 자리다 (REQ-875). */
    setFigure(spot, { id, pose }) {
      const fig = placed.get(spot);
      // 세우지 않은 자리에 자세를 주면 조용히 아무것도 바뀌지 않으므로 그 자리에서 터뜨린다.
      if (!fig) throw new Error(`아레나에 없는 자리: ${spot}`);
      fig.className = `fig ${spot} sil-${id}-${pose}`;
    },
  };
}
