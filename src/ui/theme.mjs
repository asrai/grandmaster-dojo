// 속성·등급의 표시 규약 (REQ-112·206·211·810·814). 삼각 규칙 자체는 balance.mjs 의 `ATTRS.beats` 가
// SoT 이고, 이 모듈은 그것을 색 토큰·형태·역인덱스로 옮기기만 한다. 수치와 색값은 여기 없다 —
// 시각 토큰 원장은 `index.html` 의 `:root` 한 곳이고 이 모듈은 그 이름을 JS 쪽에 내주는 접근 계층이다.

import { ATTRS, BALANCE } from '../balance.mjs';
import { REVEAL_TIER, SELECT_REASON } from '../core.mjs';
import { SCREEN_IDS } from '../log.mjs';

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

/**
 * 수련 성공은 등급이 아니라 판정 오버레이의 자리·조판만 빌린다 (#46 · REQ-846). 6단의 낙관을
 * 빌리면 그 판정으로 오학습되므로 자기 낙관을 새긴다.
 */
export const TRAIN_DONE_VIEW = { cls: 'train-done', mark: '成功', label: '성공' };

/** 제자가 그 초식을 고른 이유의 화면 문구 (REQ-852) — 관전의 콘텐츠는 결과가 아니라 판단이다. */
export const REASON_VIEW = {
  [SELECT_REASON.ADVANTAGE]: '우세를 골랐다',
  [SELECT_REASON.CLASH]: '상쇄를 골랐다',
  [SELECT_REASON.AVOID_REVERSAL]: '역파를 피했다',
};

// 계열이 늘었는데 문구가 없으면 그 초의 판단이 조용히 빈칸으로 뜬다 — 부팅 때 문다 (REQ-853).
for (const reason of Object.values(SELECT_REASON)) {
  if (!REASON_VIEW[reason]) throw new Error(`선택 이유 문구가 없다: ${reason}`);
}

/**
 * 절초 공개 3층의 화면 문구 (REQ-882~884) — 층이 늘었는데 문구가 없으면 그 대면의 브리핑이
 * 조용히 빈칸으로 뜨므로, `REASON_VIEW` 와 같은 형태로 아래에서 부팅 때 문다.
 * 인자는 그 대면에서 실제로 아는 것만 받는다 — `RUMOR` 문구가 `finisher` 를 쓰면 소문 층이
 * 이름을 쥔 채 렌더되고, 그 순간 층 구분이 문구 하나로 무너진다.
 */
export const REVEAL_VIEW = {
  [REVEAL_TIER.NONE]: {
    cls: 'none',
    title: () => '절초 없음',
    note: () => '이 도전자는 답을 가르칠 것이 없다',
  },
  [REVEAL_TIER.RUMOR]: {
    cls: 'rumor',
    title: () => '이 상대는 절초를 쓴다고 한다',
    note: () => '이름도 파해도 알려진 바 없다 — 한 번 이겨 두면 다음 대면에 드러난다',
  },
  [REVEAL_TIER.COUNTER]: {
    cls: 'tell-open',
    title: ({ finisher }) => `절초 ${finisher.name}`,
    note: ({ answer }) => `파해는 ${answer.name} · 그 초식을 내지 않으면 역파는 일어나지 않는다`,
  },
};

// 층을 복사해 늘리다 한 칸만 빠뜨리면 부팅이 아니라 그 대면의 렌더에서 죽는다 — 형까지 문다 (REQ-882·884).
for (const tier of Object.values(REVEAL_TIER)) {
  const view = REVEAL_VIEW[tier];
  if (!view || typeof view.title !== 'function' || typeof view.note !== 'function') {
    throw new Error(`절초 공개 층 문구가 없다: ${tier}`);
  }
}

/**
 * 라우트 → 화면 좌표축 + 전환 낭독 이름 (spec § 통합 로그 스키마 · REQ-911). 로그의 `screen` 과
 * 화면을 바꿨다는 낭독이 같은 표를 읽으므로, 한쪽만 아는 화면이 생기지 않는다. 파견은 예고와
 * 관전이 한 좌표(`s4`)를 나눠 쓴다 — spec 의 시안 커버리지가 임무 표찰을 S4 로 세었다.
 */
export const SCREEN = {
  duel: { id: 's1', label: '사부 대련' },
  dojo: { id: 's2', label: '도장' },
  train: { id: 's3', label: '수련' },
  preview: { id: 's4', label: '파견 예고' },
  dispatch: { id: 's4', label: '파견 관전' },
  transmit: { id: 's5', label: '전수' },
  result: { id: 's6', label: '결과' },
  select: { id: 's7', label: '도전자 선택' },
};

// 좌표 없는 라우트는 로그에서 통째로 사라지고 낭독도 침묵한다 — 부팅 때 문다.
for (const [route, view] of Object.entries(SCREEN)) {
  if (!SCREEN_IDS.includes(view.id)) throw new Error(`화면 좌표가 축 밖이다: ${route} → ${view.id}`);
  if (!view.label) throw new Error(`화면 이름이 없다: ${route}`);
}
// 반대 방향 — 축의 한 칸을 어떤 라우트도 쓰지 않으면 7화면 이식의 완주가 그 칸에서 판독 불능이다.
for (const id of SCREEN_IDS) {
  if (!Object.values(SCREEN).some((v) => v.id === id)) throw new Error(`도달하는 라우트가 없는 화면 좌표: ${id}`);
}

/**
 * 받침 유무로 갈리는 조사 (REQ-830) — 초식·도전자 이름이 데이터라 문구에 조사를 박을 수 없고,
 * 박으면 이름을 하나 늘릴 때마다 「파운현월가 열린다」가 된다.
 * @param {string} word 조사가 붙는 말
 * @param {string} after 받침 있는 말 뒤에 오는 형태 (`이`·`은`·`을`)
 * @param {string} bare  받침 없는 말 뒤에 오는 형태 (`가`·`는`·`를`)
 */
export function particle(word, after, bare) {
  const last = word.codePointAt(word.length - 1);
  const hangul = last >= 0xAC00 && last <= 0xD7A3;
  return hangul && (last - 0xAC00) % 28 !== 0 ? after : bare;
}

/** 흔들림·히트스톱이 붙는 등급 (REQ-815) — 크기 축의 극단 2등급과 같은 집합이다. */
export const EXTREME_GRADES = new Set(['crush', 'reversal']);

const BEATEN_BY = Object.fromEntries(Object.values(ATTRS).map((a) => [a.beats, a.id]));

/** 그 속성에 우세인 유일한 속성 = 상대 예고에 병기하는 「이기는 색」 (REQ-206). */
export const winAttrOf = (attrId) => BEATEN_BY[attrId];

export const attrLabel = (attrId) => ATTRS[attrId].label;
export const gradeLabel = (grade) => BALANCE.grades[grade].label;
