// DOM 조립 헬퍼. src/ 루트 모듈(balance·core·log)은 DOM-free 계약이라, 문서를 아는 코드는
// 전부 src/ui/ 아래에만 산다.

import { ARROW } from '../balance.mjs';
import { ATTR_VIEW } from './theme.mjs';

export const $ = (id) => document.getElementById(id);

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
 * 화면 크롬 조립 (REQ-801) — 상단 띠·하단부의 유무와 본문 여백을 화면이 정한다. 전역 규칙이던
 * 시절에는 어떤 화면도 풀블리드 레이어를 y=0 부터 깔 수 없었다 (REQ-802).
 * @param {HTMLElement} root 화면 컨테이너 (`#app`) — 이 함수가 비우고 다시 채운다
 * @param {object} p
 * @param {HTMLElement} [p.top] 상단 띠 — 넘기지 않으면 본문이 y=0 에서 시작한다
 * @param {HTMLElement} [p.bottom] 하단부 (밴드·입력 패드)
 * @param {boolean} [p.padded] 본문 여백 12px/gap 12px 적용 여부
 * @returns {HTMLElement} 본문 노드
 */
export function composeScreen(root, {
  top = null, body = [], bottom = null, padded = true,
}) {
  clear(root);
  if (top) root.appendChild(top);
  const main = el('main', { class: `screen-body${padded ? ' padded' : ''}` },
    [].concat(body).filter(Boolean));
  root.appendChild(main);
  if (bottom) root.appendChild(bottom);
  return main;
}

/**
 * 표준 상단 띠 (REQ-801) — 띠를 쓰는 화면이 각자 만들고, 갱신 주체도 그 화면이다.
 * @param {object} session
 * @param {string} artName 무공 이름 — 성이 초식 단위로 내려가 무공에는 표시할 성이 없다 (REQ-701·707)
 * @returns {{node: HTMLElement, paint: () => void}} `paint` 를 `ctx.ownTop` 에 넘기면
 *   `ctx.refreshTop()` 이 그 화면의 띠만 다시 그린다
 */
export function topBand(session, artName) {
  const labelEl = el('b', { class: 'top-label' });
  const coinsEl = el('span', { class: 'top-coins' });
  const a11y = el('input', { type: 'checkbox' });
  a11y.checked = session.accessibility;
  a11y.addEventListener('change', () => {
    // 데이터 테이블은 시드로 두고 런타임 값은 세션이 갖는다 — 다음 창부터 반영된다.
    session.accessibility = a11y.checked;
    // 사이클 도중에 창 배율이 바뀐 세션은 모집단이 섞인 것이라, 판독기가 그 사실을 알아야 한다.
    session.accessibilityToggles += 1;
  });

  const node = el('header', { class: 'top-band' }, [
    el('div', { class: 'top-row' }, [
      labelEl,
      el('span', { class: 'dim', text: artName }),
      coinsEl,
    ]),
    el('div', { class: 'top-row' }, [
      el('label', {}, [a11y, el('span', { text: '응수 창 ×1.3 (쉬움)' })]),
    ]),
  ]);

  const paint = () => {
    labelEl.textContent = session.label;
    coinsEl.textContent = `元 ${session.coins}`;
  };
  paint();
  return { node, paint };
}

/** 속성 = 색 + 형태 중복 표현 (REQ-112). */
export function attrMark(attrId, { size = '' } = {}) {
  const view = ATTR_VIEW[attrId];
  return el('span', { class: `mark ${size}`.trim(), text: view.shape, style: `color:${view.color}` });
}

export function hpBar(hp, max) {
  const pct = Math.max(0, Math.min(1, hp / max)) * 100;
  return el('div', { class: 'hpbar' }, [el('i', { style: `width:${pct}%` })]);
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
