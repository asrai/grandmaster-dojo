// 결과 화면 (REQ-870~878·892 · #70) — 7화면 중 유일하게 상단 띠가 없어 무대가 y=0 에서 시작하고,
// 하단 확정 버튼은 정산 패널 **밖**의 형제라 정산이 아무리 길어져도 출구가 잘리지 않는다.
// 정산은 렌더가 아니라 진입에 묶여 있다 — `settleResult` 가 그 계약을 지므로 이 파일의 렌더는
// 몇 번을 돌아도 세션을 움직이지 않는다.

import { BALANCE } from '../../balance.mjs';
import { styleById } from '../../core.mjs';
import { composeScreen, el } from '../dom.mjs';
import { SPOT, createArena } from '../arena.mjs';
import { GRADE_VIEW, gradeLabel } from '../theme.mjs';
import { attrMark, attrTone } from '../components/attr-mark.mjs';
import { hanja } from '../components/hanja.mjs';
import { rankStair } from '../components/rank-stair.mjs';
import {
  DISPATCH_CHALLENGER, challengerOfStage, duelAttemptOf, rematchBonusOf, settleResult,
} from '../session.mjs';

/** 결과 무대의 높이 (REQ-870·875) — S1 아레나(440)를 접은 값이고 나머지가 정산부다. */
const STAGE_H = 360;

/**
 * 6단의 표시 순서 (REQ-872) — 판정표의 `order` 가 그 축이라 화면이 등급 목록을 따로 갖지 않는다.
 * 등급이 늘면 이 배열이 함께 늘고, 아래 칩 6열도 같은 수만큼 늘어난다.
 */
const GRADE_ORDER = Object.keys(BALANCE.grades)
  .sort((a, b) => BALANCE.grades[a].order - BALANCE.grades[b].order);

/**
 * 한 판의 결론 (REQ-874) — 한 초의 판정 오버레이와 같은 조판을 쓰되 그보다 크다. 파견의 승리를
 * 「완수」로 따로 부르는 것은 그 판을 끝낸 손이 사부가 아니기 때문이다.
 */
const BRAND = {
  win: { cls: 'win', mark: '勝', label: '승리' },
  done: { cls: 'win', mark: '完', label: '완수' },
  lose: { cls: 'lose', mark: '敗', label: '패배' },
};

/** 엎드림 자세가 납품된 실루엣 (spec § 아트 계약) — 제자의 4자세에는 엎드림이 없다. */
const PRONE_ASSETS = new Set(['sil_master', 'sil_challenger']);

/**
 * 결과 무대에 서는 두 사람 (REQ-875) — 승자가 근경에 서고 패자가 원경에 쓰러진다. 패배는 두
 * 자리를 통째로 맞바꾸는 것이지 자세만 바꾸는 것이 아니다. 엎드림 에셋이 없는 사람은 자리를
 * 비우고 이긴 쪽만 세운다 — 선 자세를 회전으로 눕히면 승패 그림이 무너진다.
 */
function stageFigures(kind, win) {
  const mine = kind === 'duel' ? 'sil_master' : 'sil_disciple';
  const [standing, fallen] = win ? [mine, 'sil_challenger'] : ['sil_challenger', mine];
  return [
    PRONE_ASSETS.has(fallen) ? { spot: SPOT.FAR, id: fallen, pose: 'prone' } : null,
    { spot: SPOT.NEAR, id: standing, pose: 'stance' },
  ].filter(Boolean);
}

/** 정산 한 줄 — 키는 왼쪽에 작게, 값은 오른쪽에 크게. 값이 문장인 줄은 그 크기를 접는다. */
const line = (cap, value, { muted = false, cls = '' } = {}) => el('div', {
  class: `ln ${cls}${muted ? ' none' : ''}`.trim(),
}, [
  el('span', { class: 'k', text: cap }),
  el('span', { class: 'v' }, [].concat(value)),
]);

/** 정산 블록 한 덩이 — 키 한 줄 아래에 내용이 앉는 형태다. */
const block = (cap, body, cls) => el('section', { class: `blk ${cls}` }, [
  el('span', { class: 'k', text: cap }),
  body,
]);

/** 초식 이름 + 보조 한자 — 결정타 줄과 성 변화 행이 같은 조판을 쓴다 (REQ-813). */
const styleName = (style) => [
  attrMark(style.attr),
  el('span', { class: 'nm', text: style.name }),
  hanja(style.hanja),
];

/**
 * 고정 3블록의 순서 (REQ-871) — **순서가 계약**이라 그 순서가 이 배열 하나에만 있다.
 * 4상태(대련 승·패 / 재대련 / 파견 완수)가 같은 자리를 쓰는 것이 이 배열의 존재 이유다.
 */
const FIXED_BLOCKS = ['verdicts', 'finisher', 'coins'];

/** 조건부 블록의 순서 (REQ-871) — 있을 때만 붙되 붙는 순서는 고정이다. */
const CONDITIONAL_BLOCKS = ['ranks', 'spoils', 'unlock'];

/**
 * 전리품의 M1 범위는 자리와 노출 조건까지다 (REQ-892) — 종류·용도·수급 곡선은 M2 이므로 이
 * 목록은 **의도된 플레이스홀더**이고, 값이 성 적립에 닿는 순간 8성 벽 우회 구멍이 열린다.
 */
const SPOILS_PLACEHOLDER = [{ name: '비급 조각', count: 2 }, { name: '영약', count: 1 }];

/**
 * 블록별 렌더 (REQ-871). 고정 3블록은 어떤 상태에서도 노드를 내야 하고, 조건부 블록만 null 로
 * 「붙지 않음」을 말한다 — 그 구분은 아래 `ledgerBlocks` 가 기계로 문다.
 * @param {object} s `settleResult` 의 정산 스냅샷
 * @param {{session: object, foe: object}} at 그 판의 세션과 상대
 */
const BLOCK_VIEW = {
  verdicts: (s) => block('판정', el('div', { class: 'chips' }, GRADE_ORDER.map((grade) => {
    const count = s.verdicts[grade] ?? 0;
    return el('span', { class: `c ${GRADE_VIEW[grade].cls}${count ? ' on' : ''}` }, [
      el('span', { text: gradeLabel(grade) }),
      el('b', { text: String(count) }),
    ]);
  })), 'verdicts'),

  // 결정타는 11·12성 계단의 유일한 인과라, 없을 때도 자리를 비우지 않고 없다고 말한다 (REQ-708).
  finisher: (s) => {
    const cap = s.kind === 'duel' ? '결정타' : '제자 결정타';
    if (!s.finisher) {
      return el('div', { class: 'finish empty' }, [
        el('span', { class: 'k', text: cap }),
        el('span', { class: 'nm', text: '없다 — 끝내지 못했다' }),
      ]);
    }
    return el('div', { class: 'finish' }, [
      el('span', { class: 'k', text: cap }),
      ...styleName(styleById(s.finisher)),
    ]);
  },

  // 재대련 무보상은 규칙이라 빈칸이 아니라 문장이어야 파밍 차단으로 읽힌다 (REQ-877).
  coins: (s) => {
    if (s.rematch && s.win) return line('재화', '재대련은 재화를 주지 않는다', { muted: true });
    if (!s.win) return line('재화', '없음', { muted: true });
    return line('재화', [el('b', { text: `+${s.reward}` }), el('span', { class: 'u', text: '냥' })], { cls: 'coin' });
  },

  // 져도 성은 오른다 (REQ-703·876) — 발광한 칸이 이 판에서 번 것의 전부이자 정확한 양이다.
  ranks: (s) => (s.gains.length ? block('성 변화', el('div', { class: 'ranks' }, s.gains.map((gain) => {
    const style = styleById(gain.style);
    return el('div', { class: 'rk', style: `--attr:${attrTone(style.attr)}` }, [
      el('div', { class: 'rk-top' }, [
        ...styleName(style),
        el('span', { class: 'move' }, [
          el('span', { class: 'from', text: `${gain.from}성` }),
          el('span', { class: 'arrow', text: '→' }),
          el('span', { class: 'to', text: `${gain.to}성` }),
        ]),
      ]),
      rankStair({ rank: gain.to, gained: gain.to - gain.from }),
    ]);
  })), 'ranks') : null),

  spoils: (s) => (s.win && !s.rematch
    ? block('전리품', el('div', { class: 'items' }, SPOILS_PLACEHOLDER.map((it) => el('span', {
      class: 'it',
    }, [el('span', { text: it.name }), el('b', { text: String(it.count) })]))), 'loot')
    : null),

  unlock: (s, at) => {
    if (!s.win) return null;
    if (s.kind !== 'duel') return line('해금', '다음 임무');
    if (s.unlocked) return line('해금', `${s.unlocked.name} · ${s.unlocked.stage}차`);
    // 전 차수 격파 고지는 처음 넘은 순간의 것이다 — 재대련마다 다시 뜨면 문구가 소음이 된다.
    if (s.cleared && !s.rematch) return line('해금', '사부 대련 전 차수 격파 — 남은 것은 전수와 파견이다');
    // 재대련이 여는 것은 새 상대가 아니라 다음 대면의 무게다 (REQ-734).
    const bonus = rematchBonusOf(at.session, at.foe.id);
    return bonus > 0
      ? line('다음', `${duelAttemptOf(at.session, at.foe.id)}차 · 상대 성 +${bonus}`) : null;
  },
};

// 블록이 늘었는데 렌더가 없으면 그 자리가 조용히 빈칸으로 뜬다 — 부팅 때 문다 (REQ-871).
for (const key of [...FIXED_BLOCKS, ...CONDITIONAL_BLOCKS]) {
  if (typeof BLOCK_VIEW[key] !== 'function') throw new Error(`정산 블록 렌더가 없다: ${key}`);
}

/**
 * 「고정 3블록 → 구분선 → 조건부 블록」 2층 (REQ-871). 고정 블록이 자리를 비우면 4상태의 순서
 * 계약이 그 상태에서만 조용히 깨지므로, 비운 사실을 그 자리에서 터뜨린다.
 */
function ledgerBlocks(settled, at) {
  const fixed = FIXED_BLOCKS.map((key) => {
    const node = BLOCK_VIEW[key](settled, at);
    if (!node) throw new Error(`고정 블록이 비었다: ${key}`);
    return node;
  });
  const conditional = CONDITIONAL_BLOCKS.map((key) => BLOCK_VIEW[key](settled, at)).filter(Boolean);
  return [
    ...fixed,
    conditional.length ? el('div', { class: 'cond' }, conditional) : null,
  ].filter(Boolean);
}

/** 상대 표찰 (REQ-878) — 이름·한자·초 수까지다. 남은 기력은 끝난 판의 정보가 아니다. */
function foeTag(settled, foe, exchanges) {
  const marks = [
    settled.kind === 'duel' ? null : '임무',
    settled.attempt > 1 ? `재대련 ${settled.attempt}차` : null,
    `${exchanges}초`,
  ].filter(Boolean);
  return el('div', { class: 'foe-tag' }, [
    el('b', { text: foe.name }),
    hanja(foe.hanja),
    el('span', { class: 'sub', text: ` · ${marks.join(' · ')}` }),
  ]);
}

/** 판정 낙인 (REQ-874) — 한자는 한글 위에 얹히는 보조 낙관이다 (REQ-813). */
const brandView = (brand) => el('div', { class: `brand ${brand.cls}` }, [
  hanja(brand.mark),
  el('span', { class: 'word', text: brand.label }),
]);

export function renderResult(ctx) {
  const { session, params } = ctx;
  // 렌더가 아니라 진입이 정산한다 — 이 호출은 같은 진입에서 몇 번을 돌아도 한 번만 움직인다 (#70).
  const settled = settleResult(session, params);
  const duel = settled.kind === 'duel';
  const foe = duel ? challengerOfStage(params.stage) : DISPATCH_CHALLENGER;
  const brand = settled.win ? (duel ? BRAND.win : BRAND.done) : BRAND.lose;
  const retryable = duel && !settled.win;

  const arena = createArena({ height: STAGE_H, figures: stageFigures(settled.kind, settled.win) });
  arena.node.append(brandView(brand), foeTag(settled, foe, params.view.exchange));

  composeScreen(ctx, {
    padded: false,
    body: [
      arena.node,
      // 정산부만 스크롤한다 — 확정 버튼은 이 패널의 자식이 아니라 형제다 (REQ-878).
      el('section', { class: 'settle' }, ledgerBlocks(settled, { session, foe })),
    ],
    bottom: el('div', { class: 'acts' }, retryable ? [
      el('button', { text: '도장으로', onclick: () => ctx.go('dojo') }),
      // 진 자리에서 바로 같은 슬롯으로 되돌아가면 절초 공개·슬롯 교체(REQ-732·736)가 가장 필요한
      // 순간에만 빠진다 — 선택 화면을 거치는 것이 그 학습 계단의 자리다.
      el('button', { class: 'primary', text: '재도전', onclick: () => ctx.go('select', { stage: params.stage }) }),
    ] : [
      el('button', { class: 'primary', text: '도장으로', onclick: () => ctx.go('dojo') }),
    ]),
  });
}
