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
import { PHASE, createMatch } from '../match.mjs';
import { createSequenceInput } from '../sequence-input.mjs';
import {
  ART_NAME, canEquip, challengerOfStage, duelAttemptOf, equip, equippedStyles,
  isFirstEncounterOf, logEvent, rankOfStyle, rematchBonusOf,
} from '../session.mjs';
import { createVerdictOverlay } from '../verdict-overlay.mjs';
import { composeHooks, duelWiring, logDuelStart } from '../wiring.mjs';

/**
 * 상대 예고 (REQ-822) — 아레나 최상단 가로 스트립이다. 중앙은 판정 오버레이의 자리라 예고가
 * 점유하지 않고, 「이기는 색」이 그 옆에 붙어 슬롯 판단이 한 눈에 닫힌다 (REQ-206).
 */
function telegraphView(view) {
  if (view.foeOpen) return el('div', { class: 'tele open', text: '빈틈! — 아무 초식이나 완주하면 완파' });
  const foe = view.telegraphed;
  const win = winAttrOf(foe.attr);
  return el('div', { class: 'tele', style: `--attr:${attrTone(foe.attr)}` }, [
    el('div', { class: 'tele-attr' }, [
      attrMark(foe.attr, { size: 'big' }),
      el('span', { class: 'an', text: attrLabel(foe.attr) }),
    ]),
    el('div', { class: 'tele-id' }, [
      el('b', { class: 'kr', text: foe.name }),
      el('span', { class: 'sub' }, [hanja(foe.hanja), el('span', { class: 'dim', text: `${foe.len}수 초식` })]),
    ]),
    el('div', { class: 'tele-win', style: `--attr:${attrTone(win)}` }, [
      el('span', { class: 'cap', text: '이기는 색' }),
      el('span', { class: 'val' }, [attrMark(win), el('b', { text: attrLabel(win) })]),
    ]),
  ]);
}

/**
 * 기력 (REQ-850) — 누가 누구인지를 색 그라디언트에만 맡기지 않고 라벨로 못박는다 (REQ-856).
 * @param {string} label 낭독·시각 공용 이름
 * @param {string} side `foe`(좌상) · `self`(우하) — 실루엣이 선 자리와 같은 축이다
 */
function vital(label, side) {
  const fill = el('i', { class: 'fill' });
  const node = el('div', { class: `vital ${side}` }, [
    el('span', { class: 'lbl', text: label }),
    el('span', { class: 'track' }, [fill]),
  ]);
  return {
    node,
    set(hp, max) { fill.style.width = `${Math.max(0, Math.min(1, hp / max)) * 100}%`; },
  };
}

/**
 * 도전자 표찰 (REQ-820·893·897) — 대련 중 상황은 「누구와 몇 초째인가」뿐이라 띠가 그 둘만
 * 진다. 재화·접근성 토글은 대련 밖(도장·예고)의 자리다.
 * @param {object} challenger
 * @param {() => number} exchangeOf 끝난 초의 수 — 표시는 진행 중인 초라 그보다 하나 크다
 * @param {Function} onLeave 물러나기 — 띠를 쓰는 화면의 좌측 첫 자리다 (REQ-897)
 */
function foeBand(challenger, exchangeOf, onLeave) {
  const countEl = el('b', { class: 'exch-n' });
  const node = el('header', { class: 'foe-band' }, [
    el('button', { class: 'leave', text: '←', 'aria-label': '물러나기', onclick: onLeave }),
    el('div', { class: 'foe-name' }, [el('b', { text: challenger.name }), hanja(challenger.hanja)]),
    el('span', { class: 'seal', text: `${challenger.stage}차` }),
    el('span', { class: 'exch' }, [countEl, el('span', { class: 'exch-u', text: '초째' })]),
  ]);
  const paint = () => { countEl.textContent = String(exchangeOf() + 1); };
  paint();
  return { node, paint };
}

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
  });
  const teleEl = el('div', { class: 'tele-slot' });
  const gaugeFill = el('i', {});
  const foeVital = vital('적', 'foe');
  const selfVital = vital('사부', 'self');
  const banner = el('div', { class: 'toast' });
  let exchanges = 0;
  const band = foeBand(challenger, () => exchanges, () => ctx.go('dojo'));

  arena.node.append(
    foeVital.node,
    selfVital.node,
    teleEl,
    banner,
    // 시각 오버레이는 아레나 좌표계 안에 살고 이 화면과 함께 사라진다 (REQ-806).
    verdict.node,
    // 시간 압박은 아레나에 속한 정보라 실루엣을 보는 동안 주변시로 읽힌다 — 숫자 초는 없다 (REQ-823).
    el('div', { class: 'gauge' }, [gaugeFill]),
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
    foeVital.set(view.foeHp, view.foeHpMax);
    selfVital.set(view.selfHp, view.selfHpMax);
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
        clear(teleEl).appendChild(telegraphView(view));
        verdict.hide();
        gaugeFill.style.width = '100%';
        renderHp(view);
        ctx.pad.render();
        exchanges = view.exchange;
        ctx.refreshTop();
      },
      onWindow() {
        ctx.pad.render();
      },
      onTick(view) {
        gaugeFill.style.width = `${view.ratio * 100}%`;
        ctx.pad.render();
      },
      onVerdict(view, changes) {
        const { verdict: resolved } = view;
        lastFire = view.fire ?? null;
        ctx.pad.render();
        renderHp(view);
        // 소리는 흔들림·글자와 한 덩어리로 읽혀야 해서 판정이 실제로 뜨는 순간에 맡긴다 —
        // 확정 연출을 기다리는 초에는 그만큼 함께 늦는다 (REQ-826).
        verdict.showGrade(resolved.grade, {
          onShow: () => (resolved.grade === 'crush' ? SFX.crush
            : resolved.dmgIn > 0 ? SFX.hit : SFX.fire)(),
        });

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
