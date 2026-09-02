// 사부 대련 (REQ-201·206~211·708·731~736) — 유저가 시퀀스를 치는 유일한 실전 화면과 그 예고.

import { BALANCE, STYLES } from '../../balance.mjs';
import { attrMark, clear, composeScreen, el, hpBar, topBand } from '../dom.mjs';
import { ATTR_VIEW, attrLabel, winAttrOf } from '../theme.mjs';
import { SFX } from '../audio.mjs';
import { finisherOf, foeStyleById, styleById } from '../../core.mjs';
import { PHASE, createMatch } from '../match.mjs';
import { createSequenceInput } from '../sequence-input.mjs';
import {
  ART_NAME, canEquip, challengerOfStage, duelAttemptOf, equip, equippedStyles,
  logEvent, rankOfStyle, rematchBonusOf,
} from '../session.mjs';
import { createVerdictOverlay } from '../verdict-overlay.mjs';
import { composeHooks, duelWiring, logDuelStart } from '../wiring.mjs';

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

/**
 * 절초 파해 공개 (REQ-732) — 역파 벌칙을 가진 유일한 초식이라 그것만 예외로 답을 가르친다.
 * 감쇠는 맞았을 때의 성장 보상이고 1차 해법은 회피이므로, 여기서 파해를 숨기면 첫 A-4 의
 * 연속 피격이 「갑자기 어려워졌다」로 읽혀 kill (b) 를 오염시킨다.
 */
function finisherNotice(session, finisher) {
  const answer = styleById(finisher.counters);
  const equipped = session.slots.includes(answer.id);
  return el('div', { class: 'card' }, [
    el('p', {}, [
      el('b', { text: `절초 ${finisher.name} ${finisher.hanja}` }),
      el('span', { class: 'dim', text: ` · ${attrLabel(finisher.attr)} · ${finisher.len}수` }),
    ]),
    el('p', {}, [
      el('span', { class: 'dim', text: '파해 — ' }),
      el('b', { text: answer.name }),
      el('span', { class: 'tag', text: equipped ? '장착됨' : '미장착' }),
    ]),
    el('p', { class: 'dim', text: '그 초식을 내지 않으면 역파는 일어나지 않는다. 예고된 수에 파해를 내면 완파다.' }),
  ]);
}

/** 예고 순서대로의 도전자 초식 — 어떤 색이 몇 번 오는지가 슬롯 판단의 입력이다. */
const foeLineup = (challenger) => el('div', { class: 'icons' }, challenger.styles.map((id) => {
  const foe = foeStyleById(id);
  return el('div', { class: 'cand', style: `--attr:${ATTR_VIEW[foe.attr].color}` }, [
    attrMark(foe.attr),
    el('span', { class: 'cand-name', text: foe.name }),
    el('span', { class: 'tag', text: `${attrLabel(foe.attr)} · ${foe.len}수` }),
    el('span', { class: 'tag', text: `이기는 색 ${attrLabel(winAttrOf(foe.attr))}` }),
  ]);
}));

/**
 * 도전자 예고 화면 (REQ-504·732·736) — 판단의 순간과 조작의 장소를 붙인다. 슬롯 교체를 도장으로
 * 돌려보내면 A-4 의 슬롯 압박이 판단이 아니라 왕복 잡무가 된다 (도장 동선은 그대로 남는다).
 */
export function renderDuelPreview(ctx) {
  const { session, root, params } = ctx;
  const challenger = challengerOfStage(params.stage);
  const finisher = finisherOf(challenger);
  const attempt = duelAttemptOf(session, challenger.id);
  const bonus = rematchBonusOf(session, challenger.id);

  // 슬롯을 먼저 고르고 후보를 고른다 — 두 번의 탭이 곧 「무엇을 빼고 무엇을 넣는가」다.
  let picked = session.slots.findIndex((id) => id === null);
  if (picked < 0) picked = 0;

  const slotsEl = el('div', { class: 'icons' });
  const benchEl = el('div', { class: 'icons' });

  function renderSlots() {
    clear(slotsEl);
    clear(benchEl);
    session.slots.forEach((styleId, i) => {
      const style = styleId ? styleById(styleId) : null;
      const node = el('button', {
        class: `cand${i === picked ? ' picked' : ''}`,
        style: `--attr:${style ? ATTR_VIEW[style.attr].color : 'var(--line)'}`,
        onclick: () => { picked = i; renderSlots(); },
      }, [
        style ? attrMark(style.attr) : null,
        el('span', { class: 'cand-name', text: style ? style.name : '빈 슬롯' }),
        el('span', { class: 'tag', text: `슬롯 ${i + 1}` }),
      ]);
      slotsEl.appendChild(node);
    });
    const benched = STYLES.filter((s) => session.progress.styles[s.id].learned
      && !session.slots.includes(s.id) && canEquip(session, s.id));
    if (!benched.length) {
      benchEl.appendChild(el('span', { class: 'dim', text: '교체할 초식이 없다 — 장착 성에 닿은 초식이 전부 슬롯에 있다.' }));
      return;
    }
    for (const style of benched) {
      benchEl.appendChild(el('button', {
        class: 'cand', style: `--attr:${ATTR_VIEW[style.attr].color}`,
        onclick: () => {
          equip(session, style.id, picked, { challenger: challenger.id });
          renderSlots();
        },
      }, [
        attrMark(style.attr),
        el('span', { class: 'cand-name', text: style.name }),
        el('span', { class: 'tag', text: `${rankOfStyle(session, style.id)}성` }),
      ]));
    }
  }
  renderSlots();

  composeScreen(ctx, {
    top: topBand(session, ART_NAME),
    body: el('section', { class: 'card' }, [
    el('h2', { text: `도전자 예고 — ${challenger.name} ${challenger.stage}차` }),
    el('p', { class: 'dim', text: attempt > 1
      ? `${attempt}번째 대면 — 상대가 성 +${bonus} 만큼 여물었고 재대련 승리에 재화는 없다.`
      : `${challenger.hanja} · 처음 만나는 상대다.` }),
    foeLineup(challenger),
    finisher ? finisherNotice(session, finisher) : null,
    el('h2', { text: '실전 슬롯' }),
    el('p', { class: 'dim', text: '슬롯을 고르고 아래 초식을 누르면 그 자리에서 바뀐다.' }),
    slotsEl,
    benchEl,
    el('div', { class: 'actions' }, [
      el('button', { class: 'primary', text: '대련 시작', onclick: () => ctx.go('duel', { stage: params.stage }) }),
      el('button', { class: 'small ghost', text: '도장으로', onclick: () => ctx.go('dojo') }),
    ]),
  ]) });
}

export function startDuel(ctx) {
  const { session, root, params } = ctx;
  const challenger = challengerOfStage(params.stage);
  const { foeRank } = logDuelStart(session, challenger);

  const verdict = createVerdictOverlay();
  const foeHpEl = el('div', {});
  const selfHpEl = el('div', {});
  const telegraphEl = el('div', { class: 'tg-slot' });
  const windowFill = el('i', {});
  const banner = el('div', { class: 'toast' });

  composeScreen(ctx, {
    top: topBand(session, ART_NAME),
    body: el('section', { class: 'card arena' }, [
      el('div', { class: 'head' }, [
        el('b', { text: `${challenger.name} ${challenger.stage}차` }),
        el('span', { class: 'hanja', text: challenger.hanja }),
        el('button', { class: 'small ghost', text: '도장으로', onclick: () => ctx.go('dojo') }),
      ]),
      foeHpEl,
      telegraphEl,
      el('div', { class: 'arena-gap' }),
      el('div', { class: 'window' }, [windowFill]),
      el('div', { class: 'head' }, [
        el('b', { text: '사부' }),
        el('span', { class: 'dim', text: ART_NAME }),
      ]),
      selfHpEl,
      banner,
      // 시각 오버레이는 아레나 좌표계 안에 살고 이 화면과 함께 사라진다 (REQ-806).
      verdict.node,
    ]),
    bottom: ctx.pad.node,
  });

  // 결과 화면이 「어느 초식이 끝냈는가」를 말하려면 그 수의 발동을 여기서 붙잡아 두어야 한다 (REQ-708).
  let lastFire = null;
  const finisher = () => lastFire?.style.id ?? null;

  const toast = (text, cls = '') => {
    banner.className = `toast show ${cls}`.trim();
    banner.textContent = text;
  };

  const input = createSequenceInput({
    pool: equippedStyles(session),
    rankOf: (style) => rankOfStyle(session, style.id),
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
    foeRank,
    selfHpMax: BALANCE.hp.user,
    rankOf: (style) => rankOfStyle(session, style.id),
    openLen: () => Math.max(...equippedStyles(session).map((s) => s.seq.length)),
    accessibility: () => session.accessibility,
    hooks: composeHooks(duelWiring(session, { input }), {
      onTelegraph(view) {
        clear(telegraphEl).appendChild(telegraphView(view));
        verdict.hide();
        windowFill.style.width = '100%';
        renderHp(view);
        ctx.pad.render();
      },
      onWindow() {
        ctx.pad.render();
      },
      onTick(view) {
        windowFill.style.width = `${view.ratio * 100}%`;
        ctx.pad.render();
      },
      onVerdict(view, changes) {
        const { verdict: resolved } = view;
        lastFire = view.fire ?? null;
        ctx.pad.render();
        renderHp(view);
        verdict.showGrade(resolved.grade);
        (resolved.grade === 'crush' ? SFX.crush : resolved.dmgIn > 0 ? SFX.hit : SFX.fire)();

        if (!changes) return;
        if (changes.rank) {
          SFX.rank();
          const name = styleById(changes.rank.style).name;
          toast(changes.rank.to >= BALANCE.rankMax
            ? `${name} — 완벽히 깨달음`
            : `${name} ${changes.rank.to}성`, 'rank');
        } else if (changes.wall) {
          toast(`${styleById(changes.wall.style).name} — 수련으로는 여기까지, 실전으로 민다`);
        } else if (changes.unlock) {
          toast('새 초식을 배울 수 있다 — 도장에서');
        }
        ctx.refreshTop();
      },
      onEnd(view) {
        ctx.go('result', {
          kind: 'duel', win: view.outcome.win, stage: params.stage, view, finisher: finisher(),
        });
      },
    }),
  });

  ctx.pad.attach({
    input,
    rankOf: (style) => rankOfStyle(session, style.id),
    accepting: () => match.phase === PHASE.WINDOW,
    // 봇이 「이기는 색」을 화면과 같은 근거로 고를 수 있게 그 수의 예고를 함께 건넨다 (REQ-605).
    foeStyle: () => match.view().telegraphed,
    onFire: (fired) => { SFX.fire(); match.fire(fired); },
  });
  match.start();
  return () => { match.stop(); verdict.hide(); };
}
