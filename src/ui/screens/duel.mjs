// 사부 대련 (REQ-201·206~211·708·731~736) — 유저가 시퀀스를 치는 유일한 실전 화면과 그 예고.
// 화면은 상단 띠 50 / 아레나 440 / 입력부 362 의 3단 고정이고, 나머지 4화면이 그 좌표를
// 상속하므로 아레나는 `arena.mjs` 가, 하단부는 `pad.mjs` 가 각자 소유한다 (REQ-820·850).

import { BALANCE, STYLES } from '../../balance.mjs';
import { clear, composeScreen, el, topBand } from '../dom.mjs';
import { attrLabel, winAttrOf } from '../theme.mjs';
import { attrMark, attrTone } from '../components/attr-mark.mjs';
import { hanja } from '../components/hanja.mjs';
import { SFX } from '../audio.mjs';
import { finisherOf, foeStyleById, styleById } from '../../core.mjs';
import { SPOT, createArena } from '../arena.mjs';
import { stageBand } from '../band.mjs';
import { PHASE, createMatch } from '../match.mjs';
import { createSequenceInput } from '../sequence-input.mjs';
import {
  ART_NAME, canEquip, challengerOfStage, duelAttemptOf, equip, equippedStyles,
  isFirstEncounterOf, logEvent, rankOfStyle, rematchBonusOf,
} from '../session.mjs';
import { createVerdictOverlay } from '../verdict-overlay.mjs';
import { composeHooks, duelWiring, logDuelStart } from '../wiring.mjs';

/**
 * 절초 공개 (REQ-732 개정 · REQ-883·894) — 역파 벌칙을 가진 유일한 초식이라 그것만 예외로
 * 답을 가르치되, 공개 수위를 대면 이력이 가른다. 첫 대면이 존재만 아는 것은 싸워 본 적 없는
 * 상대의 초식을 아는 것이 성립하지 않기 때문이고, 그렇다고 전면 비공개로 두지 않는 것은
 * 그러면 첫 대면이 반드시 역파를 맞고 시작해 「갑자기 어려워졌다」로 읽히기 때문이다.
 */
function finisherNotice(session, finisher, firstEncounter) {
  if (firstEncounter) {
    return el('div', { class: 'card' }, [
      el('p', {}, [el('b', { text: '이 상대는 절초를 쓴다고 한다' })]),
      el('p', { class: 'dim', text: '이름도 파해도 알려진 바 없다 — 한 번 이겨 두면 다음 대면에 드러난다.' }),
    ]);
  }
  const answer = styleById(finisher.counters);
  const equipped = session.slots.includes(answer.id);
  return el('div', { class: 'card' }, [
    el('p', {}, [
      el('b', { text: `절초 ${finisher.name}` }),
      hanja(finisher.hanja),
      el('span', { class: 'dim', text: ` · ${attrLabel(finisher.attr)} · ${finisher.len}수` }),
    ]),
    el('p', {}, [
      el('span', { class: 'dim', text: '파해 — ' }),
      el('b', { text: answer.name }),
      el('span', { class: 'tag', text: equipped ? '장착됨' : '미장착' }),
    ]),
    el('p', { class: 'dim', text: '그 초식을 내지 않으면 역파는 일어나지 않는다. 예고된 초에 파해를 내면 완파다.' }),
  ]);
}

/**
 * 예고 순서대로의 도전자 초식 — 어떤 색이 몇 번 오는지가 슬롯 판단의 입력이다. 첫 대면의
 * 절초만 「미상」으로 접는다 (REQ-883) — 같은 화면에서 소문 고지와 이름이 함께 뜨면 소문 층이
 * 무효가 되고, 나머지 초식까지 접으면 첫 대면에 슬롯 판단의 입력 자체가 사라진다.
 */
const foeLineup = (challenger, firstEncounter) => el('div', { class: 'icons' }, challenger.styles.map((id) => {
  const foe = foeStyleById(id);
  if (firstEncounter && foe.finisher) {
    return el('div', { class: 'cand', style: '--attr:var(--line)' }, [
      el('span', { class: 'cand-name', text: '미상' }),
      el('span', { class: 'tag', text: '절초' }),
    ]);
  }
  return el('div', { class: 'cand', style: `--attr:${attrTone(foe.attr)}` }, [
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
  // 대면 이력을 한 자리에서 읽는다 — 안내 문구와 절초 공개가 각자 파생하면 한쪽만 바뀌어도 화면이 모순된다.
  const firstEncounter = isFirstEncounterOf(session, challenger.id);

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
        style: `--attr:${style ? attrTone(style.attr) : 'var(--line)'}`,
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
        class: 'cand', style: `--attr:${attrTone(style.attr)}`,
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
    top: topBand(session, ART_NAME, { onLeave: () => ctx.go('dojo') }),
    body: el('section', { class: 'card' }, [
    el('h2', { text: `도전자 예고 — ${challenger.name} ${challenger.stage}차` }),
    firstEncounter
      ? el('p', { class: 'dim' }, [hanja(challenger.hanja), el('span', { text: ' · 아직 이겨 본 적 없는 상대다.' })])
      : el('p', { class: 'dim', text: `${attempt}번째 대면 — 상대가 성 +${bonus} 만큼 여물었고 재대련 승리에 재화는 없다.` }),
    foeLineup(challenger, firstEncounter),
    finisher ? finisherNotice(session, finisher, firstEncounter) : null,
    el('h2', { text: '실전 슬롯' }),
    el('p', { class: 'dim', text: '슬롯을 고르고 아래 초식을 누르면 그 자리에서 바뀐다.' }),
    slotsEl,
    benchEl,
    el('div', { class: 'actions' }, [
      el('button', { class: 'primary', text: '대련 시작', onclick: () => ctx.go('duel', { stage: params.stage }) }),
    ]),
  ]) });
}

export function startDuel(ctx) {
  const { session, params } = ctx;
  const challenger = challengerOfStage(params.stage);
  const { foeRank } = logDuelStart(session, challenger);

  // 확정 연출이 한 프레임도 안 보이는 초를 위해 판정이 죽간의 금테를 기다린다 (REQ-826).
  const verdict = createVerdictOverlay({ heldSince: () => ctx.pad.onlyShownAt() });
  // 대각 대치 — 도전자가 원경에, 사부가 근경에 선다. 이 배치를 S4 는 사람만, S6 은 자세까지
  // 바꿔 그대로 물려받는다 (REQ-821·850·875).
  const arena = createArena({
    figures: [
      { spot: SPOT.FAR, id: 'sil_challenger', pose: 'stance' },
      { spot: SPOT.NEAR, id: 'sil_master', pose: 'stance' },
    ],
    bout: { [SPOT.FAR]: '적', [SPOT.NEAR]: '사부' },
  });
  const banner = el('div', { class: 'toast' });
  let exchanges = 0;
  // 대련 중 상황은 「누구와 몇 초째인가」뿐이라 띠가 그 둘만 진다 — 재화·접근성 토글은
  // 대련 밖(도장·예고)의 자리다 (REQ-820·893·897).
  const band = stageBand({
    onLeave: () => ctx.go('dojo'),
    name: challenger.name,
    hanja: challenger.hanja,
    seal: `${challenger.stage}차`,
    // 끝난 초의 수를 세므로 진행 중인 초는 그보다 하나 크다.
    count: { value: () => exchanges + 1, unit: '초째' },
  });

  arena.node.append(
    banner,
    // 시각 오버레이는 아레나 좌표계 안에 살고 이 화면과 함께 사라진다 (REQ-806).
    verdict.node,
  );

  composeScreen(ctx, {
    top: band,
    body: arena.node,
    bottom: ctx.pad.node,
    // 아레나는 풀블리드 레이어라 여백이 붙으면 3단 고정이 어긋난다 (REQ-802·820).
    padded: false,
  });

  // 결과 화면이 「어느 초식이 끝냈는가」를 말하려면 그 초의 발동을 여기서 붙잡아 두어야 한다 (REQ-708).
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
    arena.setVital(SPOT.FAR, view.foeHp, view.foeHpMax);
    arena.setVital(SPOT.NEAR, view.selfHp, view.selfHpMax);
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
        arena.showTelegraph(view, '빈틈! — 아무 초식이나 완주하면 완파');
        verdict.hide();
        // 성장 고지는 그 초 한정이다 — 남기면 다음 초의 판정 위에 계속 떠 있는다.
        banner.className = 'toast';
        arena.setWindow(1);
        renderHp(view);
        ctx.pad.render();
        exchanges = view.exchange;
        ctx.refreshTop();
      },
      onWindow() {
        ctx.pad.render();
      },
      onTick(view) {
        arena.setWindow(view.ratio);
        ctx.pad.render();
      },
      onVerdict(view, changes) {
        const { verdict: resolved } = view;
        lastFire = view.fire ?? null;
        renderHp(view);
        // 소리는 흔들림·글자와 한 덩어리로 읽혀야 해서 판정이 실제로 뜨는 순간에 맡긴다 —
        // 확정 연출을 기다리는 초에는 그만큼 함께 늦는다 (REQ-826).
        // 죽간이 다시 그려지기 전에 예약한다 — 대기 시간은 지금 화면에 뜬 금테를 기준으로 잰다.
        verdict.showGrade(resolved.grade, {
          onShow: () => (resolved.grade === 'crush' ? SFX.crush
            : resolved.dmgIn > 0 ? SFX.hit : SFX.fire)(),
        });
        ctx.pad.render();

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
    // 봇이 「이기는 색」을 화면과 같은 근거로 고를 수 있게 그 초의 예고를 함께 건넨다 (REQ-605).
    foeStyle: () => match.view().telegraphed,
    onFire: (fired) => { SFX.fire(); match.fire(fired); },
  });
  match.start();
  return () => { match.stop(); verdict.hide(); };
}
