// 사부 대련 (REQ-201·206~211) — 유저가 시퀀스를 치는 유일한 실전 화면.

import { BALANCE } from '../../balance.mjs';
import { attrMark, clear, el, hpBar } from '../dom.mjs';
import { ATTR_VIEW, GRADE_VIEW, attrLabel, gradeLabel, winAttrOf } from '../theme.mjs';
import { SFX } from '../audio.mjs';
import { PHASE, createMatch } from '../match.mjs';
import { createSequenceInput } from '../sequence-input.mjs';
import {
  ART_NAME, artRank, challengerOfStage, equippedStyles, logEvent, logTimeout,
  masteryOf, recordDuelVerdict,
} from '../session.mjs';

function telegraphView(view) {
  if (view.foeOpen) return el('div', { class: 'telegraph open', text: '빈틈! — 아무 초식이나 완주하면 완파' });
  const foe = view.telegraphed;
  const win = winAttrOf(foe.attr);
  return el('div', { class: 'telegraph', style: `--attr:${ATTR_VIEW[foe.attr].color}` }, [
    el('div', { class: 'tg-foe' }, [
      attrMark(foe.attr, { size: 'big' }),
      el('b', { text: foe.name }),
      el('span', { class: 'hanja', text: foe.hanja }),
      el('span', { class: 'dim', text: `${attrLabel(foe.attr)} · ${foe.len}수` }),
    ]),
    el('div', { class: 'tg-win', style: `--attr:${ATTR_VIEW[win].color}` }, [
      el('span', { class: 'dim', text: '이기는 색' }),
      attrMark(win, { size: 'big' }),
      el('b', { text: attrLabel(win) }),
    ]),
  ]);
}

export function startDuel(ctx) {
  const { session, root, params } = ctx;
  const challenger = challengerOfStage(params.stage);
  clear(root);

  const foeHpEl = el('div', {});
  const selfHpEl = el('div', {});
  const telegraphEl = el('div', { class: 'tg-slot' });
  const verdictEl = el('div', { class: 'verdict' });
  const windowFill = el('i', {});
  const banner = el('div', { class: 'toast' });

  root.append(el('section', { class: 'card arena' }, [
    el('div', { class: 'head' }, [
      el('b', { text: `${challenger.name} ${challenger.stage}차` }),
      el('span', { class: 'hanja', text: challenger.hanja }),
      el('button', { class: 'small ghost', text: '도장으로', onclick: () => ctx.go('dojo') }),
    ]),
    foeHpEl,
    telegraphEl,
    verdictEl,
    el('div', { class: 'window' }, [windowFill]),
    el('div', { class: 'head' }, [
      el('b', { text: '사부' }),
      el('span', { class: 'dim', text: `${ART_NAME} ${artRank(session)}성` }),
    ]),
    selfHpEl,
    banner,
  ]));

  const toast = (text, cls = '') => {
    banner.className = `toast show ${cls}`.trim();
    banner.textContent = text;
  };

  const input = createSequenceInput({
    pool: equippedStyles(session),
    masteryOf: (style) => masteryOf(session, style.id),
    hintDelayMs: BALANCE.hintDelayMs.duel,
    now: () => performance.now(),
    remainingRatio: () => match.windowRatio,
    log: (event, fields) => logEvent(session, event, fields),
  });

  const renderHp = (view) => {
    clear(foeHpEl).appendChild(hpBar(view.foeHp, view.foeHpMax));
    clear(selfHpEl).appendChild(hpBar(view.selfHp, view.selfHpMax));
  };

  const match = createMatch({
    challenger,
    selfHpMax: BALANCE.hp.user,
    rankOf: () => artRank(session),
    openLen: () => Math.max(...equippedStyles(session).map((s) => s.seq.length)),
    accessibility: () => session.accessibility,
    hooks: {
      onTelegraph(view) {
        clear(telegraphEl).appendChild(telegraphView(view));
        clear(verdictEl);
        windowFill.style.width = '100%';
        renderHp(view);
        // 예고 구간에 직전 수의 버퍼·후보가 남으면 이미 낸 초식이 아직 걸린 것처럼 읽힌다.
        input.arm(equippedStyles(session));
        ctx.pad.render();
      },
      onWindow() {
        // 대련 중 자동 장착된 초식이 그 창부터 후보에 든다 — 슬롯 로그와 화면이 갈리지 않는다.
        input.arm(equippedStyles(session));
        ctx.pad.render();
      },
      onTick(view) {
        windowFill.style.width = `${view.ratio * 100}%`;
        ctx.pad.render();
      },
      onTimeout() { logTimeout(session, input); },
      onVerdict(view) {
        const { verdict } = view;
        ctx.pad.render();
        const changes = recordDuelVerdict(session, view);
        renderHp(view);
        const gv = GRADE_VIEW[verdict.grade];
        clear(verdictEl).appendChild(el('div', {
          class: 'grade', style: `color:${gv.color}`,
          text: `${gv.mark} ${gradeLabel(verdict.grade)}`,
        }));
        (verdict.grade === 'crush' ? SFX.crush : verdict.dmgIn > 0 ? SFX.hit : SFX.fire)();

        if (!changes) return;
        if (changes.rank) {
          SFX.rank();
          toast(changes.rank.to >= BALANCE.rankMax
            ? `${ART_NAME} — 완벽히 깨달음`
            : `${ART_NAME} ${changes.rank.to}성`, 'rank');
        } else if (changes.unlock) {
          toast('새 초식을 배울 수 있다 — 도장에서');
        }
        ctx.refreshTop();
      },
      onEnd(view) {
        ctx.pad.detach();
        ctx.go('result', { kind: 'duel', win: view.outcome.win, stage: params.stage, view });
      },
    },
  });

  ctx.pad.attach({
    input,
    masteryOf: (style) => masteryOf(session, style.id),
    accepting: () => match.phase === PHASE.WINDOW,
    // 봇이 「이기는 색」을 화면과 같은 근거로 고를 수 있게 그 수의 예고를 함께 건넨다 (REQ-605).
    foeStyle: () => match.view().telegraphed,
    onFire: (fired) => { SFX.fire(); match.fire(fired); },
  });
  match.start();
  return () => { match.stop(); ctx.pad.detach(); };
}

