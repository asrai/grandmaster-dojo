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

/** 오입력 무시 피드백 (REQ-103) — CSS 애니메이션 재시작을 위해 클래스를 한 프레임 떼어낸다. */
export function shake(node, cls = 'shake') {
  if (!node) return;
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}
