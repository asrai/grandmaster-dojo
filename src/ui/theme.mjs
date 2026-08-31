// 속성·등급의 표시 규약 (REQ-112·206·211). 삼각 규칙 자체는 balance.mjs 의 `ATTRS.beats` 가
// SoT 이고, 이 모듈은 그것을 색·형태·역인덱스로 옮기기만 한다.

import { ATTRS, BALANCE } from '../balance.mjs';

/** 색과 형태를 함께 준다 — 색각 이상에서도 속성이 구별되어야 한다 (REQ-112). */
export const ATTR_VIEW = {
  fast: { color: '#4aa8ff', shape: '▲' },
  hard: { color: '#ff5a5a', shape: '●' },
  fine: { color: '#43c98a', shape: '■' },
};

export const GRADE_VIEW = {
  crush: { color: '#ffd166', mark: '破' },
  advantage: { color: '#43c98a', mark: '優' },
  clash: { color: '#9aa4b2', mark: '相' },
  disadvantage: { color: '#e08a4a', mark: '劣' },
  reversal: { color: '#ff5a5a', mark: '逆' },
  struck: { color: '#ff5a5a', mark: '被' },
};

const BEATEN_BY = Object.fromEntries(Object.values(ATTRS).map((a) => [a.beats, a.id]));

/** 그 속성에 우세인 유일한 속성 = 상대 예고에 병기하는 「이기는 색」 (REQ-206). */
export const winAttrOf = (attrId) => BEATEN_BY[attrId];

export const attrLabel = (attrId) => ATTRS[attrId].label;
export const gradeLabel = (grade) => BALANCE.grades[grade].label;
