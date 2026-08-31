// 사부 대련 (REQ-201·206~211) — 유저가 시퀀스를 치는 유일한 실전 화면.

import { BALANCE } from '../../balance.mjs';
import { isEffectiveSuccess } from '../../core.mjs';
import { attrMark, clear, el, hpBar } from '../dom.mjs';
import { ATTR_VIEW, GRADE_VIEW, attrLabel, gradeLabel, winAttrOf } from '../theme.mjs';
import { SFX } from '../audio.mjs';
import { createMatch } from '../match.mjs';
import { createSequenceInput } from '../sequence-input.mjs';
import {
  DUEL_STAGES, artRank, challengerOfStage, equippedStyles, logEvent, masteryOf,
  recordEffectiveSuccess,
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
  const pool = equippedStyles(session);
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
      el('span', { class: 'dim', text: `유운검법 ${artRank(session)}성` }),
    ]),
    selfHpEl,
    banner,
  ]));

  const toast = (text, cls = '') => {
    banner.className = `toast show ${cls}`.trim();
    banner.textContent = text;
  };

  const input = createSequenceInput({
    pool,
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
    openLen: Math.max(...pool.map((s) => s.seq.length)),
    hooks: {
      onTelegraph(view) {
        clear(telegraphEl).appendChild(telegraphView(view));
        clear(verdictEl);
        windowFill.style.width = '100%';
        renderHp(view);
        ctx.pad.detach();
      },
      onWindow() {
        input.arm();
        ctx.pad.attach({
          input,
          masteryOf: (style) => masteryOf(session, style.id),
          onFire: (fired) => { SFX.fire(); match.fire(fired); },
        });
      },
      onTick(view) {
        windowFill.style.width = `${view.ratio * 100}%`;
        ctx.pad.render();
      },
      onTimeout() {
        logEvent(session, 'timeout', {
          styleTop: input.top()?.id ?? null,
          buffer_len: input.buffer.length,
        });
      },
      onVerdict(view) {
        const { verdict, fire } = view;
        // `opening` 이 스키마의 `state` 자리 — grade 만으로는 빈틈 발생률을 역산할 수 없다.
        logEvent(session, 'verdict', {
          grade: verdict.grade,
          dmg_out: verdict.dmgOut,
          dmg_in: verdict.dmgIn,
          state: verdict.opening,
          who: 'user',
        });
        ctx.pad.detach();
        renderHp(view);
        const gv = GRADE_VIEW[verdict.grade];
        clear(verdictEl).appendChild(el('div', {
          class: 'grade', style: `color:${gv.color}`,
          text: `${gv.mark} ${gradeLabel(verdict.grade)}`,
        }));
        (verdict.grade === 'crush' ? SFX.crush : verdict.dmgIn > 0 ? SFX.hit : SFX.fire)();

        if (fire && isEffectiveSuccess(verdict.grade)) {
          const changes = recordEffectiveSuccess(session, fire.style.id, 'duel');
          if (changes.rank) {
            SFX.rank();
            toast(changes.rank.to >= BALANCE.rankMax
              ? '유운검법 — 완벽히 깨달음'
              : `유운검법 ${changes.rank.to}성`, 'rank');
          } else if (changes.unlock) {
            toast('새 초식을 배울 수 있다 — 도장에서');
          }
          ctx.refreshTop();
        }
      },
      onEnd(view) {
        ctx.pad.detach();
        ctx.go('result', { kind: 'duel', win: view.outcome.win, stage: params.stage, view });
      },
    },
  });

  match.start();
  return () => { match.stop(); ctx.pad.detach(); };
}

/** 최고 차수는 그 자리에 머문다 — 재진입이 막히면 남은 성 성장 경로가 통째로 닫힌다. */
export const nextStage = (stage) => Math.min(stage + 1, DUEL_STAGES.length);
