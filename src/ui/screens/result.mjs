// 결과 화면 (REQ-209·406·708) — 패배는 무손실이고, 재도전은 같은 차수를 HP 만 되돌려 다시 연다.

import { styleById } from '../../core.mjs';
import { clear, el } from '../dom.mjs';
import { settleDispatch, settleDuel } from '../session.mjs';

function duelLines(session, params) {
  if (!params.win) return ['잃은 것은 없다 — 성·재화는 그대로다'];
  const { reward, unlocked, cleared, rematch } = settleDuel(session, params);
  // 재대련 무보상은 규칙이라 이유를 함께 말한다 — 「+0 元」만 뜨면 결함으로 읽힌다 (REQ-734).
  const lines = [rematch ? '재대련 승리 — 재화는 없다 (성과 계단만 남는다)' : `재화 +${reward} 元`];
  // 어느 초식이 끝냈는지가 11·12성 계단의 유일한 인과라, 결과 화면이 그것을 말하지 않으면 규칙이 안 보인다.
  if (params.finisher) lines.unshift(`결정타 — ${styleById(params.finisher).name}`);
  if (unlocked) lines.push(`${unlocked.name} ${unlocked.stage}차 해금`);
  // 전 차수 격파 고지는 그 차수를 처음 넘은 순간의 것이다 — 재대련마다 다시 뜨면 문구가 소음이 된다.
  else if (cleared && !rematch) lines.push('사부 대련 전 차수 격파 — 남은 것은 전수와 파견이다');
  return lines;
}

function dispatchLines(session, params) {
  const { reward } = settleDispatch(session, params);
  const lines = [params.win ? `재화 +${reward} 元` : '도전자는 도주했다 — 잃은 것은 없다'];
  return lines;
}

export function renderResult(ctx) {
  const { session, root, params } = ctx;
  const duel = params.kind === 'duel';
  const lines = duel ? duelLines(session, params) : dispatchLines(session, params);
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
