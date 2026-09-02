// 속성·등급의 표시 규약 (REQ-112·206·211·810·814). 삼각 규칙 자체는 balance.mjs 의 `ATTRS.beats` 가
// SoT 이고, 이 모듈은 그것을 색 토큰·형태·역인덱스로 옮기기만 한다. 수치와 색값은 여기 없다 —
// 시각 토큰 원장은 `index.html` 의 `:root` 한 곳이고 이 모듈은 그 이름을 JS 쪽에 내주는 접근 계층이다.

import { ATTRS, BALANCE } from '../balance.mjs';

/**
 * 색 원장 C1~C9 의 이름 (REQ-810) — 팔레트 색을 JS 에서 부르는 자리다. 역할 토큰(`--line`·`--dim`
 * 등)은 팔레트가 아니라 원장의 파생이라 이 표에 없고, 호출부가 그 이름을 직접 쓴다.
 */
export const C = {
  inkDeep: 'var(--c1)',
  inkMid: 'var(--c2)',
  paper: 'var(--c3)',
  gold: 'var(--c4)',
  seal: 'var(--c5)',
  swift: 'var(--c6)',
  force: 'var(--c7)',
  still: 'var(--c8)',
  paperFace: 'var(--c9)',
};

/** 색과 형태를 함께 준다 — 색각 이상에서도 속성이 구별되어야 한다 (REQ-112·819). */
export const ATTR_VIEW = {
  fast: { color: C.swift, shape: '▲' },
  hard: { color: C.force, shape: '●' },
  fine: { color: C.still, shape: '■' },
};

/**
 * 6단 판정의 자형(한자 낙관)과 등급 클래스 (REQ-814). 나머지 3축(위치·크기·색)은 그 클래스가
 * 원장에서 받아 가므로, 등급 하나를 튜닝하는 자리도 원장 한 곳이다.
 */
export const GRADE_VIEW = {
  crush: { cls: 'crush', mark: '破' },
  advantage: { cls: 'advantage', mark: '優' },
  clash: { cls: 'clash', mark: '衝' },
  disadvantage: { cls: 'disadvantage', mark: '劣' },
  reversal: { cls: 'reversal', mark: '逆' },
  struck: { cls: 'struck', mark: '擊' },
};

/** 수련 성공은 등급이 아니라 판정 오버레이의 자리·조판만 빌린다 (#46 · REQ-846). */
export const TRAIN_DONE_VIEW = { cls: 'train-done', label: '성공' };

/** 흔들림·히트스톱이 붙는 등급 (REQ-815) — 크기 축의 극단 2등급과 같은 집합이다. */
export const EXTREME_GRADES = new Set(['crush', 'reversal']);

const BEATEN_BY = Object.fromEntries(Object.values(ATTRS).map((a) => [a.beats, a.id]));

/** 그 속성에 우세인 유일한 속성 = 상대 예고에 병기하는 「이기는 색」 (REQ-206). */
export const winAttrOf = (attrId) => BEATEN_BY[attrId];

export const attrLabel = (attrId) => ATTRS[attrId].label;
export const gradeLabel = (grade) => BALANCE.grades[grade].label;
