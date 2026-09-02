// DOM 조립 헬퍼. src/ 루트 모듈(balance·core·log)은 DOM-free 계약이라, 문서를 아는 코드는
// 전부 src/ui/ 아래에만 산다.

import { ARROW } from '../balance.mjs';
import { isMuted, toggleMute } from './audio.mjs';

export const $ = (id) => document.getElementById(id);

/** `false`·`null` 속성값은 「속성 없음」이라, `aria-*` 의 거짓 값은 문자열 `'false'` 로 넘겨야 남는다. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k === 'disabled') node.disabled = Boolean(v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * 화면 크롬 조립 (REQ-801) — 상단 띠·하단부의 유무와 본문 여백을 화면이 정하므로, 어떤 화면도
 * 풀블리드 레이어를 y=0 부터 깔 수 있다 (REQ-802).
 * @param {object} ctx 화면 컨텍스트 — `root` 를 비워 다시 채우고 `ownTop` 으로 띠 갱신을 등록한다
 * @param {object} p
 * @param {{node: HTMLElement, paint: Function}} [p.top] `topBand` 번들 — 조립과 등록이 한 호출로
 *   묶여 있어, 띠를 붙이고 갱신 등록만 빠뜨린 상태가 만들어지지 않는다
 * @param {HTMLElement|HTMLElement[]} [p.body] 본문 자식 (falsy 항목은 버려진다)
 * @param {HTMLElement} [p.bottom] 하단부 (밴드·입력 패드)
 * @param {boolean} [p.padded] 본문 여백 12px/gap 12px 적용 여부
 * @returns {HTMLElement} 본문 노드
 */
export function composeScreen(ctx, {
  top = null, body = [], bottom = null, padded = true,
}) {
  const root = clear(ctx.root);
  if (top) {
    root.appendChild(top.node);
    ctx.ownTop(top.paint);
  }
  // 프로그램이 옮기는 포커스라 탭 순서에는 들어가지 않는다 — `-1` 이 그 구분이다.
  const main = el('main', { class: `screen-body${padded ? ' padded' : ''}`, tabindex: '-1' },
    [].concat(body).filter(Boolean));
  root.appendChild(main);
  if (bottom) root.appendChild(bottom);
  // 전환 직후 포커스가 body 로 떨어지면 키보드·낭독기 사용자는 새 화면의 첫 요소까지 Tab 을
  // 다시 짚어야 한다. 조립의 소유가 이 함수라 화면마다 반복되는 자리가 생기지 않는다 (#102).
  // 스크롤을 막는 것은 본문이 스크롤 상자여서 — 포커스가 그것을 맨 위로 당기면 안 된다.
  main.focus({ preventScroll: true });
  return main;
}

/**
 * 표준 상단 띠 (REQ-801) — 띠를 쓰는 화면이 각자 만들고, 갱신 주체도 그 화면이다.
 * @param {object} session
 * @param {string} artName 무공 이름 — 성이 초식 단위로 내려가 무공에는 표시할 성이 없다 (REQ-701·707)
 * @param {object} [p]
 * @param {Function} [p.onLeave] 물러나기 — 띠의 좌측 첫 자리에 고정된다 (REQ-897). 넘기지 않는
 *   화면은 그 자리를 비운다: 홈은 돌아갈 곳이 없어 예외이고, 결과는 띠 자체를 쓰지 않는다.
 * @returns {{node: HTMLElement, paint: () => void}} `paint` 를 `ctx.ownTop` 에 넘기면
 *   `ctx.refreshTop()` 이 그 화면의 띠만 다시 그린다
 */
export function topBand(session, artName, { onLeave = null } = {}) {
  const labelEl = el('b', { class: 'top-label' });
  const coinsEl = el('span', { class: 'top-coins' });
  const a11y = el('input', { id: 'a11y-window', type: 'checkbox' });
  a11y.checked = session.accessibility;
  a11y.addEventListener('change', () => {
    // 데이터 테이블은 시드로 두고 런타임 값은 세션이 갖는다 — 다음 창부터 반영된다.
    session.accessibility = a11y.checked;
    // 사이클 도중에 창 배율이 바뀐 세션은 모집단이 섞인 것이라, 판독기가 그 사실을 알아야 한다.
    session.accessibilityToggles += 1;
  });

  // 음소거는 싸우는 중이 아니라 들어가기 전에 정하는 설정이라, 실전 3단 좌표를 건드리지 않는
  // 이 설정 줄이 그 자리다 (REQ-926). 시안에 자리가 지정된 컨트롤이 아니다.
  const mute = el('button', { class: 'mute' });
  const paintMute = () => {
    const off = isMuted();
    mute.textContent = off ? '소리 꺼짐' : '소리 켜짐';
    mute.setAttribute('aria-pressed', String(off));
    mute.setAttribute('aria-label', off ? '음소거 해제' : '음소거');
    mute.classList.toggle('off', off);
  };
  mute.addEventListener('click', () => { toggleMute(); paintMute(); });
  paintMute();

  const node = el('header', { class: 'top-band' }, [
    el('div', { class: 'top-row' }, [
      onLeave ? el('button', { class: 'leave', text: '←', 'aria-label': '물러나기', onclick: onLeave }) : null,
      labelEl,
      el('span', { class: 'dim', text: artName }),
      coinsEl,
    ]),
    el('div', { class: 'top-row' }, [
      el('label', {}, [a11y, el('span', { text: '응수 창 ×1.3 (쉬움)' })]),
      mute,
    ]),
  ]);

  // 부분 갱신이면 `refreshTop()` 이 「띠가 지금 상태와 같아진다」를 보장하지 못한다 — 셋을 함께 그린다.
  const paint = () => {
    labelEl.textContent = session.label;
    coinsEl.textContent = `${session.coins} 냥`;
    a11y.checked = session.accessibility;
    paintMute();
  };
  paint();
  return { node, paint };
}

/**
 * 시퀀스 화살표 줄 — `revealed` 개까지만 실제 방향을 보이고 나머지는 가린다 (REQ-108).
 * @param {string[]} seq 초식 시퀀스
 * @param {number} done  이미 입력된 키 수
 * @param {number} revealed 점등된 키 수 (done 이하이면 입력분만 보인다)
 */
export function arrowRow(seq, done, revealed) {
  return el('div', { class: 'arrows' }, seq.map((dir, i) => el('i', {
    class: i < done ? 'on' : i < revealed ? 'hint' : 'dim',
    text: i < revealed ? ARROW[dir] : '·',
  })));
}

/**
 * 유도 툴팁 앵커 (#20) — 말풍선은 설명일 뿐이라 리스너도 포커스도 갖지 않는 `<span>` 이고,
 * 버튼이 `aria-describedby` 로 그것을 가리킨다. 어느 버튼을 누르라는 지목 자체는 `.tip-target`
 * 테두리가 지므로, 말풍선이 가려져도 안내는 읽힌다.
 */
export function tipAnchor(button, text, id) {
  button.setAttribute('aria-describedby', id);
  button.classList.add('tip-target');
  return el('div', { class: 'tip-anchor' }, [button, el('span', { class: 'tip', id, role: 'note', text })]);
}

/** 오입력 무시 피드백 (REQ-103) — CSS 애니메이션 재시작을 위해 클래스를 한 프레임 떼어낸다. */
export function shake(node, cls = 'shake') {
  if (!node) return;
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}
