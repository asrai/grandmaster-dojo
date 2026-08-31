// 도장 (REQ-303·305·306·308) — 배우기 · 수련 · 장착 · 전수 · 대련/파견 진입.

import { BALANCE, STYLES } from '../../balance.mjs';
import { artById, canLearn, discipleRankOf, discipleStyles } from '../../core.mjs';
import { arrowRow, attrMark, clear, el } from '../dom.mjs';
import { ATTR_VIEW } from '../theme.mjs';
import {
  ART_ID, ART_NAME, DISPATCH_CHALLENGER, artRank, canEquip, canTransmitNow,
  challengerOfStage, equip, learnStyle, masteryOf, unequip,
} from '../session.mjs';

const rankLabel = (rank) => (rank >= BALANCE.rankMax ? `${rank}성 · 완벽히 깨달음` : `${rank}성`);

function styleRow(ctx, style) {
  const { session } = ctx;
  const learned = session.progress.styles[style.id].learned;
  const mastery = masteryOf(session, style.id);
  const slotIdx = session.slots.indexOf(style.id);
  const actions = [];

  if (!learned) {
    actions.push(el('button', {
      class: 'small',
      disabled: !canLearn(session.progress, style.id),
      text: '배우기',
      onclick: () => { learnStyle(session, style.id); ctx.go('dojo'); },
    }));
  } else {
    actions.push(el('button', {
      class: 'small', text: '수련',
      onclick: () => ctx.go('train', { styleId: style.id }),
    }));
    if (slotIdx >= 0) {
      actions.push(el('button', {
        class: 'small ghost', text: '해제',
        onclick: () => { unequip(session, slotIdx); ctx.go('dojo'); },
      }));
    } else {
      actions.push(el('button', {
        class: 'small ghost',
        disabled: !canEquip(session, style.id) || !session.slots.includes(null),
        text: '장착',
        onclick: () => { equip(session, style.id); ctx.go('dojo'); },
      }));
    }
  }

  return el('div', { class: `row${learned ? '' : ' locked'}`, style: `--attr:${ATTR_VIEW[style.attr].color}` }, [
    el('div', { class: 'row-head' }, [
      attrMark(style.attr),
      el('b', { text: style.name }),
      el('span', { class: 'hanja', text: style.hanja }),
      slotIdx >= 0 ? el('span', { class: 'tag', text: `슬롯 ${slotIdx + 1}` }) : null,
    ]),
    arrowRow(style.seq, 0, learned ? style.seq.length : 0),
    el('div', { class: 'meter' }, [el('i', { style: `width:${mastery}%` })]),
    el('div', { class: 'row-foot' }, [
      el('span', { class: 'dim', text: learned ? `숙련 ${mastery}%` : '미해금' }),
      el('span', { class: 'dim', text: style.gugyeol }),
    ]),
    el('div', { class: 'row-actions' }, actions),
  ]);
}

function discipleCard(session) {
  const rank = discipleRankOf(session.disciple, ART_ID);
  const styles = discipleStyles(session.disciple, ART_ID);
  return el('section', { class: 'card' }, [
    el('h2', { text: '제자' }),
    rank === null
      ? el('p', { class: 'dim', text: '아직 전수한 무공이 없다 — 무공을 12성으로 깨달으면 전수할 수 있다.' })
      : el('div', {}, [
        el('p', {}, [el('b', { text: ART_NAME }), el('span', { class: 'badge', text: `${rank}성` })]),
        el('div', { class: 'icons' }, styles.map((s) => el('span', {
          class: 'cand mini', style: `--attr:${ATTR_VIEW[s.attr].color}`,
        }, [attrMark(s.attr), el('span', { class: 'cand-name', text: s.name })]))),
      ]),
  ]);
}

export function renderDojo(ctx) {
  const { session, root } = ctx;
  ctx.pad.detach();
  clear(root);

  const stage = challengerOfStage(session.stage);
  const rank = artRank(session);

  root.append(
    el('section', { class: 'card' }, [
      el('h2', { text: `${ART_NAME} ${artById(ART_ID).hanja}` }),
      el('p', {}, [
        el('span', { class: `badge${rank >= BALANCE.rankMax ? ' max' : ''}`, text: rankLabel(rank) }),
        el('span', { class: 'dim', text: ` 성 포인트 ${session.progress.arts[ART_ID].rankPts}` }),
      ]),
      el('div', { class: 'rows' }, STYLES.map((s) => styleRow(ctx, s))),
    ]),
    discipleCard(session),
    el('section', { class: 'card actions' }, [
      el('button', {
        class: 'primary',
        text: `사부 대련 — ${stage.name} ${stage.stage}차`,
        disabled: !session.slots.some(Boolean),
        onclick: () => ctx.go('duel', { stage: session.stage }),
      }),
      el('button', {
        class: 'primary',
        text: `전수 — 제자에게 ${ART_NAME}을`,
        disabled: !canTransmitNow(session),
        onclick: () => ctx.go('transmit'),
      }),
      el('button', {
        class: 'primary',
        text: `파견 — ${DISPATCH_CHALLENGER.name}`,
        disabled: !session.transmitted,
        onclick: () => ctx.go('preview'),
      }),
      session.slots.some(Boolean) ? null : el('p', {
        class: 'dim', text: '초식을 수련해 숙련 30% 를 넘기면 실전 슬롯에 자동으로 장착된다.',
      }),
    ]),
  );
}
