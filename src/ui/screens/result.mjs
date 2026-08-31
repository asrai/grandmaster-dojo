// 결과 화면 (REQ-209·406) — 패배는 무손실이고, 재도전은 같은 차수를 HP 만 되돌려 다시 연다.

import { BALANCE } from '../../balance.mjs';
import { clear, el } from '../dom.mjs';
import { addCoins, advanceStage, isLastStage, logEvent } from '../session.mjs';

function settleDuel(session, params) {
  const lines = [];
  if (params.win) {
    addCoins(session, BALANCE.reward.duelWin, 'duel_win');
    lines.push(`재화 +${BALANCE.reward.duelWin} 元`);
    const unlocked = advanceStage(session, params.stage);
    if (unlocked) lines.push(`${unlocked.name} ${unlocked.stage}차 해금`);
    else if (isLastStage(params.stage)) lines.push('사부 대련 전 차수 격파 — 남은 것은 전수와 파견이다');
  } else {
    lines.push('잃은 것은 없다 — 숙련·성·재화는 그대로다');
  }
  return lines;
}

function settleDispatch(session, params) {
  const lines = [];
  if (params.win) {
    addCoins(session, BALANCE.reward.dispatchWin, 'dispatch_win');
    lines.push(`재화 +${BALANCE.reward.dispatchWin} 元`);
  } else {
    lines.push('도전자는 도주했다 — 잃은 것은 없다');
  }
  lines.push(params.rankTo > params.rankFrom
    ? `제자 성 ${params.rankFrom} → ${params.rankTo}`
    : `제자 성 ${params.rankTo} (변화 없음)`);
  logEvent(session, 'cycle', { phase: 'cycle_done' });
  return lines;
}

export function renderResult(ctx) {
  const { session, root, params } = ctx;
  const duel = params.kind === 'duel';
  const lines = duel ? settleDuel(session, params) : settleDispatch(session, params);
  ctx.refreshTop();
  ctx.pad.detach();
  clear(root);

  const { view } = params;
  root.append(el('section', { class: 'card result' }, [
    el('h2', { class: params.win ? 'win' : 'lose', text: params.win ? '승리' : '패배' }),
    el('p', { class: 'dim', text: `${view.exchange}수 · 남은 HP ${view.selfHp} 대 ${view.foeHp}`
      + `${view.outcome.by === 'exchanges' ? ' (수 상한 · 잔여 HP 비교)' : ''}` }),
    el('ul', {}, lines.map((t) => el('li', { text: t }))),
    el('div', { class: 'actions' }, [
      duel && !params.win ? el('button', {
        class: 'primary', text: '재도전',
        onclick: () => ctx.go('duel', { stage: params.stage }),
      }) : null,
      el('button', { class: 'primary', text: '도장으로', onclick: () => ctx.go('dojo') }),
    ]),
  ]));
}
