// 아레나 (REQ-821) — S3 수련·S4 파견·S6 결과가 S1 대련과 같은 무대에 서도록 연 계약면이다.
// 상속이 곧 서사이므로(REQ-850) 화면이 갈아 끼울 수 있는 것을 셋으로 못박는다: 무대 높이 ·
// 사람이 서는 자리 · 그 사람의 자세. 그 밖을 인자로 열면 상속이 포크로 갈린다.
// 좌표·색은 전부 `index.html` 의 원장이 지므로 이 모듈에 수치가 없다.

import { clear, el } from './dom.mjs';
import { PHASE } from './match.mjs';
import { attrLabel, winAttrOf } from './theme.mjs';
import { attrMark, attrTone } from './components/attr-mark.mjs';
import { hanja } from './components/hanja.mjs';

/** 사람이 설 수 있는 두 자리 — 대각 대치가 성립하는 최소 집합이다 (REQ-821). */
export const SPOT = { FAR: 'far', NEAR: 'near' };

/**
 * 역광이 닿지 않는 자세 (REQ-875) — 쓰러진 사람은 빛의 앞이 아니라 바닥에 있어, 형태를 지는
 * 것이 뒤에서 오는 빛이 아니라 윤곽선이다. 자세가 그 사실을 정하므로 화면이 끌 인자가 아니다.
 */
const UNLIT_POSES = new Set(['prone']);

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

/** 창 자리의 유일한 문면 — 상대는 감춘 것이 아니라 아직 내지 않았다 (#252). */
const VEIL_TEXT = '상대가 초식을 펼치려고 한다';

/** 상대 스트립이 설 수 있는 상태 — 어느 자리에 무엇이 실렸는지가 이름으로 남는다 (REQ-822). */
export const FOE_STRIP = { OPEN: 'open', OPENED: 'opened', VEILED: 'veiled', REVEALED: 'revealed' };

/**
 * 스트립 상태 결정 — 문서를 만지지 않으므로 하네스가 이 판단만 따로 단정할 수 있다 (REQ-822).
 * @param {object} view `createMatch` 의 view — 모든 필드가 같은 초를 말한다 (#252)
 * @param {object} [texts] 자리별 빈틈 문면
 * @param {?string} [texts.open] 창 자리 빈틈 문면 — 예고 모드만 넘기고 감춤 모드는 null 이라,
 *   창에 빈틈이 서는 경로 자체가 없다
 * @param {?string} [texts.resolved] 판정 자리 빈틈 문면 — 그 자리에 서는 사람이 누구냐로 갈린다
 * @param {?string} [texts.missed] 그 빈틈을 흘린 갈래의 판정 자리 문면. 미전달이면 `resolved` 로
 *   접히므로, 흘림이 성립하지 않는 화면(파견)은 넘기지 않는 것이 곧 그 화면의 선언이다 (#255)
 * @returns {{state: string, foe?: object, text?: string}}
 */
export function foeStripState(view, { open = null, resolved = null, missed = null } = {}) {
  // 그 초의 상대가 실려 있으면 그것이 그 초의 사실이다 — 빈틈은 상대가 초식을 내지 않은 초에만 선다.
  if (view.telegraphed) return { state: FOE_STRIP.REVEALED, foe: view.telegraphed };
  // 값보다 자리가 먼저다 — 값부터 보면 판정 자리의 빈틈이 창 자리 문면으로 새어 나간다 (#252).
  if (view.phase === PHASE.RESOLVE && view.foeOpen) {
    // 등급을 여기서만 읽는 것이 계약이다 — 창 자리 view 의 `verdict` 는 직전 초의 것이라 남의 초를 말한다 (#255).
    const taken = view.verdict?.grade === 'crush';
    return { state: FOE_STRIP.OPENED, text: !taken && missed != null ? missed : resolved };
  }
  if (view.foeOpen && open) return { state: FOE_STRIP.OPEN, text: open };
  // 자리를 비우면 공개 순간에 조판이 튀고, 상대가 아직 내지 않았다는 사실이 화면에서 사라진다 (#243 결정 2).
  return { state: FOE_STRIP.VEILED, text: VEIL_TEXT };
}

/**
 * 상대 초식 스트립 (REQ-822) — 아레나 최상단 가로 스트립이다. 중앙은 판정 오버레이의 자리라
 * 점유하지 않고, 「이기는 색」이 그 옆에 붙어 판단이 한 눈에 닫힌다 (REQ-206).
 */
function foeView(view, texts) {
  const strip = foeStripState(view, texts);
  if (strip.state !== FOE_STRIP.REVEALED) return el('div', { class: `tele ${strip.state}`, text: strip.text });
  const foe = strip.foe;
  const win = winAttrOf(foe.attr);
  return el('div', { class: 'tele', style: `--attr:${attrTone(foe.attr)}` }, [
    el('div', { class: 'tele-attr' }, [
      attrMark(foe.attr, { size: 'big', silent: true }),
      el('span', { class: 'an', text: attrLabel(foe.attr) }),
    ]),
    el('div', { class: 'tele-id' }, [
      el('b', { class: 'kr', text: foe.name }),
      el('span', { class: 'sub' }, [hanja(foe.hanja), el('span', { class: 'dim', text: `${foe.len}수 초식` })]),
    ]),
    el('div', { class: 'tele-win', style: `--attr:${attrTone(win)}` }, [
      el('span', { class: 'cap', text: '이기는 색' }),
      el('span', { class: 'val' }, [attrMark(win, { silent: true }), el('b', { text: attrLabel(win) })]),
    ]),
  ]);
}

/**
 * 기력 한 줄 (REQ-850·856) — 누가 누구인지를 색 그라디언트에만 맡기지 않고 라벨로 못박는다.
 * 자리(`SPOT`)가 곧 실루엣이 선 자리라, 대련의 사부와 파견의 제자가 같은 좌표를 쓴다.
 */
function vital(spot, label) {
  const fill = el('i', { class: 'fill' });
  const node = el('div', { class: `vital ${spot}` }, [
    el('span', { class: 'lbl', text: label }),
    el('span', { class: 'track' }, [fill]),
  ]);
  return {
    node,
    set(hp, max) { fill.style.width = `${Math.max(0, Math.min(1, hp / max)) * 100}%`; },
  };
}

/** 실루엣과 그 역광은 한 쌍이라, 자세를 갈아 끼우는 자리가 빛의 유무도 함께 정한다 (REQ-875). */
function wear({ glow }, pose) {
  glow.classList.toggle('off', UNLIT_POSES.has(pose));
}

/**
 * @param {object} [p]
 * @param {?string} [p.height] 무대 높이 **토큰 이름** — 생략하면 원장의 기본값이고, 접어 쓰는
 *   화면만 준다. 값이 아니라 이름을 받으므로 높이 수치는 여전히 원장 한 곳에만 있다 (REQ-870).
 * @param {{spot: string, id: string, pose: string}[]} [p.figures] 아레나에 서는 사람 —
 *   `id`·`pose` 는 파일 경로가 아니라 에셋 id·자세이고, 둘을 이은 이름이 곧 클래스다 —
 *   그 클래스에서 파일로 가는 표는 `index.html` 한 곳에만 있다 (REQ-931·932).
 * @param {?{id: string, pose: string}} [p.watcher] 아레나 **밖** 앞 구석에서 지켜보는 사람
 *   (REQ-854) — 서는 사람이 아니라 관객이라 역광 없이 앞에서 잘린다.
 * @param {?{far: string, near: string}} [p.bout] 이 무대에서 실전이 벌어지면 그 세간(기력 2 ·
 *   상대 슬롯 · 응수 창)이 같은 좌표로 함께 선다 (REQ-850·822·823). 값은 기력 두 줄의 라벨이다.
 *   주지 않은 화면에는 `setVital`·`teleSlot`·`setWindow` 자체가 없다.
 * @returns {{node: HTMLElement, setFigure: Function, setVital?: Function,
 *   showFoe?: Function, setWindow?: (ratio: number) => void}}
 */
export function createArena({ height = null, figures = [], watcher = null, bout = null } = {}) {
  const scenery = el('div', { class: 'scenery', 'aria-hidden': 'true' });
  scenery.innerHTML = SCENERY;

  // 수를 넘기면 `var(360)` 이 되어 CSS 파서가 조용히 버리고 무대가 기본 높이로 선다 — 그 자리에서 문다.
  if (height !== null && !String(height).startsWith('--')) {
    throw new Error(`무대 높이는 원장 토큰 이름이어야 한다: ${height}`);
  }
  const node = el('div', {
    class: 'scene',
    style: height === null ? null : `--scene-h:var(${height})`,
  }, [el('div', { class: 'layer sky' }), scenery, el('div', { class: 'layer mist' })]);

  // 역광이 없으면 먹 실루엣이 어두운 배경에서 사라진다 — 사람과 한 쌍으로만 존재한다 (REQ-821).
  const placed = new Map(figures.map(({ spot, id, pose }) => {
    const glow = el('div', { class: `backlight ${spot}`, 'aria-hidden': 'true' });
    const fig = el('div', { class: `fig ${spot} ${id}_${pose}`, 'aria-hidden': 'true' });
    node.append(glow, fig);
    const pair = { fig, glow };
    wear(pair, pose);
    return [spot, pair];
  }));

  node.appendChild(el('div', { class: 'layer vignette' }));
  node.appendChild(el('div', { class: 'ground' }));
  // 무대의 앞이라 비네트·바닥보다 뒤에 붙는다 — 그래야 잘린 뒷모습이 무대 위로 온다 (REQ-854).
  if (watcher) node.appendChild(el('div', { class: `fig watcher ${watcher.id}_${watcher.pose}`, 'aria-hidden': 'true' }));

  const api = {
    node,
    /** 자세·인물 교체 — 결과 화면이 승패를 자세로 먼저 말하는 자리다 (REQ-875). */
    setFigure(spot, { id, pose }) {
      const pair = placed.get(spot);
      // 세우지 않은 자리에 자세를 주면 조용히 아무것도 바뀌지 않으므로 그 자리에서 터뜨린다.
      if (!pair) throw new Error(`아레나에 없는 자리: ${spot}`);
      pair.fig.className = `fig ${spot} ${id}_${pose}`;
      wear(pair, pose);
    },
  };
  if (!bout) return api;

  const vitals = new Map(Object.entries(bout).map(([spot, label]) => [spot, vital(spot, label)]));
  for (const bar of vitals.values()) node.appendChild(bar.node);
  const teleSlot = el('div', { class: 'tele-slot' });
  const windowFill = el('i', {});
  node.append(teleSlot, el('div', { class: 'gauge' }, [windowFill]));

  api.setVital = (spot, hp, max) => {
    const bar = vitals.get(spot);
    if (!bar) throw new Error(`기력이 없는 자리: ${spot}`);
    bar.set(hp, max);
  };
  /** @param {object} texts 자리별 빈틈 문면 — 갈래는 `foeStripState` 가 정한다 (REQ-822). */
  api.showFoe = (view, texts) => {
    clear(teleSlot).appendChild(foeView(view, texts));
  };
  /** 시간 압박은 아레나에 속한 정보라 실루엣을 보는 동안 주변시로 읽힌다 — 숫자 초는 없다 (REQ-823). */
  api.setWindow = (ratio) => { windowFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`; };
  return api;
}
