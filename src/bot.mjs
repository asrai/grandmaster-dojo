// 사람 속도 봇 v2 (REQ-605) — 손 대신 같은 입력 경로를 두드려 1사이클을 자동 완주한다.
// 화면·시계·난수가 주입이라 브라우저와 헤드리스가 지연 모델·입력기·대련 루프를 공유한다
// 계측 배선도 `ui/wiring.mjs` 한 벌이고 각자 갖는 것은 렌더·구동뿐이다 — 브라우저는 폴링,
// 헤드리스는 프레임이라 페이스가 정확히 같지는 않다.
// 여기서 나오는 수치는 페이스 회귀 참고치이고 kill 판정 표본이 아니다.

import { BALANCE, STYLES } from './balance.mjs';
import {
  canEquipRank, canLearn, discipleAccuracy, discipleMinRank, discipleStyleRank, discipleStyles,
  discipleTrainMsPerRank, selectDiscipleStyle, styleById,
} from './core.mjs';
import { createMatch, createVirtualTimer, pumpToEnd } from './ui/match.mjs';
import { createSequenceInput } from './ui/sequence-input.mjs';
import { SCREEN } from './ui/theme.mjs';
import {
  ART_ID, DUEL_STAGES, advanceDiscipleTraining, beginMission, canDiscipleTrain, canDispatch,
  canTransmitNow, challengerOfStage, createSession, currentMission, designateDiscipleTraining,
  enterPhase, equip, equippedStyles, learnStyle, logEvent, logSessionMeta, rankOfStyle,
  enterTransmit, setBotRunning, settleResult, simulateTraining, trainVisitDone,
} from './ui/session.mjs';
import {
  composeHooks, dispatchWiring, duelWiring, logDispatchResult, logDuelStart, trainWiring,
} from './ui/wiring.mjs';

const DIRS = ['U', 'D', 'L', 'R'];
/** 상대가 아예 없는 창 (수련) — 빈틈도 감춤도 아니라 완파가 성립할 자리 자체가 없다. */
const NO_FOE = { style: null, open: false, pool: [] };
const between = (random, [min, max]) => min + random() * (max - min);

/** 재현 가능한 난수 (LCG) — 봇 회귀가 시드마다 같은 사이클을 다시 그리게 한다. */
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 사람 손의 지연 모델 (REQ-605 시드) — 반응 · 키 간격 · 놓침 · 헛손질. */
export function createPace(random = Math.random, seed = BALANCE.bot) {
  return {
    reactionMs: () => between(random, seed.reactionMs),
    keyMs: () => between(random, seed.keyMs),
    navMs: () => between(random, seed.navMs),
    misses: () => random() < seed.missRate,
    misHits: () => random() < seed.misHitRate,
  };
}

/**
 * 이 창에 낼 초식 — 화면이 상시 병기하는 「이기는 색」을 그대로 따르는 선택이다 (REQ-206).
 * 사람의 손을 흉내내는 자리라 선택 이유는 버린다 — 그것을 읽는 것은 관전 화면뿐이다 (REQ-852).
 */
const chooseStyle = (input, foe, rankOf) =>
  selectDiscipleStyle({ styles: input.candidates, foeStyle: foe.style, foeOpen: foe.open, rankOf })?.style ?? null;

/**
 * 그 초에 이 초식으로 완파가 성립할 수 있는가 — 세 국면이 갈린다: 빈틈은 어떤 완주든 완파,
 * 공개된 상대는 파해 1:1, 감춘 상대는 그 도전자의 초식 목록 안에 파해 대상이 있으면 가능성이다.
 * 감춘 초를 「모르니 못 민다」로 접으면 계단이 운에만 맡겨져 사이클이 멈춘다 (#243).
 */
const canCrush = (style, foe) => (foe.open
  || (foe.style ? style.counters === foe.style.id : foe.pool.includes(style.counters)));

/**
 * 키우는 손의 우선순위 — 「이기는 색」이 같은 후보가 둘이면 **덜 여문** 초식을 낸다. 적립은 실제로
 * 낸 초식에만 오므로, 동률을 슬롯 순으로 깨면 같은 속성의 앞 슬롯 하나가 창을 독점하고 뒤 초식은
 * 영영 굶는다 (실측: 유운보·파운현월이 둘 다 쾌라 A-4 에서 유운보가 8성에 고착, 시드 99 등 6건 미완주).
 * `selectDiscipleStyle` 은 큰 값을 먼저 고르므로 성을 뒤집어 넘기는 것이 그 표현이다.
 */
const growthOrder = (session) => (style) => -rankOfStyle(session, style.id);

/** 계단 하나를 앞둔 성인가 — 결정타(11) 와 완파(12) 는 적립이 아니라 사건으로만 열린다 (REQ-704). */
const atLadderStep = (rank) =>
  rank === BALANCE.rankLadder.finishRank - 1 || rank === BALANCE.rankLadder.crushRank - 1;

/**
 * 계단을 미는 손 (REQ-704) — 11·12성은 적립이 아니라 결정타·완파로만 열리므로, 사람은 그
 * 계단에 선 초식을 골라 낸다. 봇이 이 선택을 하지 않으면 사이클이 그 계단에서 영영 멈춘다.
 * 미는 조건이 「그 초에 완파가 성립한다」인 것은 두 계단 모두에 맞다 — 완파는 12성의 정의이고,
 * 결정타는 상대를 쓰러뜨린 초라 그 창의 최대 피해가 곧 최선이다. 조건 없이 밀면 계단에 선
 * 초식 하나가 매 창을 독점해 나머지 초식의 적립이 굶는다.
 */
export function preferLadderPush(session) {
  return (input, foe) => {
    const pushable = input.candidates
      .map((style) => ({ style, rank: rankOfStyle(session, style.id) }))
      .filter(({ style, rank }) => atLadderStep(rank) && canCrush(style, foe))
      .sort((a, b) => a.rank - b.rank);
    return pushable[0]?.style ?? null;
  };
}

/** 어떤 후보의 다음 키도 아닌 방향 — 눌러도 후보가 0이라 `ignore` 로만 남는다. */
function strayDir(input, random) {
  const valid = new Set(input.candidates.map((s) => s.seq[input.buffer.length]).filter(Boolean));
  const stray = DIRS.filter((d) => !valid.has(d));
  return stray.length ? stray[Math.floor(random() * stray.length)] : null;
}

/**
 * 한 창을 두드리는 손. 브라우저 봇과 헤드리스 사이클이 이 부품 하나를 공유한다.
 * @param {object} p
 * @param {object} p.pace
 * @param {() => number} p.now
 * @param {(dir: string) => void} p.press 사람 입력과 같은 경로
 * @param {() => void} p.reset
 * @param {(input: object, foe: object) => ?object} [p.prefer] 그 창에서 강제할 초식
 *   (없으면 「이기는 색」 선택) — 제자 손처럼 계단을 밀 이유가 없는 호출부는 주지 않는다
 * @param {(style: object) => number} [p.rankOf] 동률 후보 사이의 우선순위 (큰 값이 먼저)
 *
 * 원터치 성이라도 탭하지 않는다 — 원터치 창은 kill (b) 분모에서 빠지므로,
 * 탭하는 봇은 자기가 재려던 완주율 표본을 스스로 지운다 (REQ-703·793).
 */
export function createHand({
  pace, now, press, reset, random = Math.random, prefer = () => null, rankOf = () => 0,
}) {
  let keys = [];
  let at = 0;
  let readyAt = 0;
  let strayed = false;

  return {
    /**
     * 창이 열릴 때 한 번 — 낼 초식과 이번에 놓칠 키를 그 자리에서 정한다.
     * @param {?{style: ?object, open: boolean, pool: string[]}} [foe] 그 초의 상대 —
     *   `style` 은 **공개된** 것만이라 감춘 초에는 null 이고, 그때 판단의 재료가 `pool` 이다.
     */
    arm(input, foe = null) {
      const facing = foe ?? NO_FOE;
      const style = prefer(input, facing) ?? chooseStyle(input, facing, rankOf);
      keys = [];
      at = 0;
      strayed = false;
      // 놓친 키 하나가 그 창을 미완주로 닫는다 — 그 미완주가 kill (b) 분모의 `timeout` 이 되는 것은 대련 창뿐이다.
      for (const dir of style ? style.seq : []) {
        if (pace.misses()) break;
        keys.push(dir);
      }
      readyAt = now() + pace.reactionMs();
    },

    /** 프레임마다 — 사람 간격이 지났으면 키를 하나 두드린다. */
    tick(input) {
      if (now() < readyAt) return;
      if (strayed) {
        strayed = false;
        // 헛손질 뒤에는 버퍼를 비우고 처음부터 — 리셋 버튼이 있는 이유가 이 자리다 (REQ-104).
        if (input.buffer.length) {
          reset();
          at = 0;
          readyAt = now() + pace.keyMs();
          return;
        }
      }
      if (at >= keys.length) return;
      const stray = pace.misHits() ? strayDir(input, random) : null;
      if (stray) {
        press(stray);
        strayed = true;
      } else {
        press(keys[at]);
        at += 1;
      }
      readyAt = now() + pace.keyMs();
    },
  };
}

/**
 * 제자의 손 (REQ-402~404) — 파견 화면과 헤드리스 사이클이 같은 자동 선택·같은 실행 시점을 쓴다.
 * @param {(fired: object) => void} p.fire
 * @param {() => number} [p.random] 읽기 성패의 난수 주입 — 하네스는 시드로 고정한다 (#243 결정 8)
 * @param {() => number} [p.accuracy] 그 초에 상대를 읽어낼 확률 — 기본값은 제자 성이 정한다
 */
export function createDiscipleHand({
  session, styles, fire, random = Math.random,
  accuracy = () => discipleAccuracy(discipleMinRank(session.disciple, ART_ID)),
}) {
  let done = false;
  return {
    arm() { done = false; },
    /**
     * 창의 60% 시점에 반드시 실행하므로 선기 잔여는 상수다. 지시가 있으면 그 초만 대체한다.
     * @returns {?{style: object, reason: ?string, byUser: boolean}} 아직 실행 시점이 아니면 null
     *   — 지시받은 초에는 제자가 판단하지 않았으므로 `reason` 이 없다 (REQ-852).
     */
    tick(view, instructed = null) {
      if (done || view.ratio > 1 - BALANCE.discipleFireRatio) return null;
      done = true;
      // 화면이 아니라 상대를 읽는 자리라 공개 여부와 무관한 값을 본다 — 읽기 성패는 성이 가른다 (#243).
      const judged = instructed ? null : selectDiscipleStyle({
        styles,
        foeStyle: view.foeStyle,
        foeOpen: view.foeOpen,
        rankOf: (s) => discipleStyleRank(session.disciple, ART_ID, s.id),
        accuracy: accuracy(),
        random,
      });
      const style = instructed ?? judged?.style ?? null;
      if (!style) throw new Error('제자가 낼 초식이 없다 — 전수된 무공이 비었다');
      logEvent(session, 'select', { styleId: style.id, byUser: Boolean(instructed) });
      fire({ style, oneTap: false, r: 1 - BALANCE.discipleFireRatio });
      return { style, reason: judged?.reason ?? null, byUser: Boolean(instructed) };
    },
  };
}

/**
 * 슬롯 교체 한 수 (REQ-714) — 자동 자리 양보가 폐지돼 슬롯 3·초식 4 는 진짜 선택이 됐고,
 * 사람 대신 두드리는 손도 그 선택을 해야 한다. 가장 덜 여문 초식에 자리를 주는 것이 그 규칙이다.
 */
function nextSwap(session) {
  const rank = (styleId) => rankOfStyle(session, styleId);
  const benched = STYLES.filter((s) => session.progress.styles[s.id].learned
    && !session.slots.includes(s.id) && canEquipRank(rank(s.id)));
  if (!benched.length) return null;
  const target = benched.reduce((a, b) => (rank(a.id) <= rank(b.id) ? a : b));
  const slotIdx = session.slots
    .map((id, i) => ({ id, i }))
    .filter(({ id }) => id)
    .reduce((a, b) => (rank(a.id) >= rank(b.id) ? a : b));
  if (rank(target.id) >= rank(slotIdx.id)) return null;
  return { kind: 'swap', styleId: target.id, slotIdx: slotIdx.i, params: {} };
}

/**
 * 계단이 요구하는 무대 (REQ-731·734) — 파해 완파는 그 대상을 예고하는 도전자에게서만 나므로
 * (파운현월은 A-4 뿐), 최고 차수만 반복하는 손은 나머지 초식의 계단을 영영 열지 못한다.
 * 결정타도 같은 자리를 쓴다 — 그 초식이 최대 피해를 내는 무대가 쓰러뜨리기도 가장 쉽다.
 * 해금한 차수 중 가장 낮은 무대를 고르는 것이 재대련 강화를 가장 적게 물고 가는 경로다.
 */
export function nextDuelStage(session) {
  const reachable = DUEL_STAGES.filter((c) => c.stage <= session.stage);
  const stageFor = (style) => reachable.find((c) => c.styles.includes(style.counters)) ?? null;
  const pushing = session.slots.filter(Boolean).map(styleById)
    .map((style) => ({ style, rank: rankOfStyle(session, style.id) }))
    .filter(({ style, rank }) => atLadderStep(rank) && stageFor(style))
    .sort((a, b) => a.rank - b.rank);
  return pushing.length ? stageFor(pushing[0].style).stage : session.stage;
}

/** 지금 걸 만한 제자 초식 — 잠금을 쥐는 것이 최소 성이라 뒤처진 것부터 건다 (REQ-743·751). */
export function nextDiscipleTrainee(session) {
  return discipleStyles(session.disciple, ART_ID)
    .filter((s) => canDiscipleTrain(session, s.id))
    .map((s) => ({ id: s.id, rank: discipleStyleRank(session.disciple, ART_ID, s.id) }))
    .sort((a, b) => a.rank - b.rank)[0] ?? null;
}

/** 도장에서의 다음 한 수 — 브라우저 봇과 헤드리스 사이클이 같은 판단을 쓴다. */
export function nextDojoAction(session) {
  if (canTransmitNow(session)) return { kind: 'transmit', params: {} };
  if (session.transmitted) {
    if (canDispatch(session)) return { kind: 'preview', params: {} };
    // 잠긴 차수에서 사람이 두는 한 수는 「뒤처진 초식을 걸어 둔다」다 — 자격 없이 예고로 가면
    // 그 화면에서 되돌아 나오는 것 말고 할 수 있는 일이 없다.
    const trainee = nextDiscipleTrainee(session);
    if (trainee) return { kind: 'trainDisciple', styleId: trainee.id, params: {} };
    return { kind: 'preview', params: {} };
  }
  // 장착 성에 못 미치는 초식은 실전에 나갈 수 없으므로 수련이 유일한 경로다 (REQ-713).
  const unequippable = STYLES.find((s) => session.progress.styles[s.id].learned
    && !canEquipRank(rankOfStyle(session, s.id)));
  if (unequippable) return { kind: 'train', params: { styleId: unequippable.id } };
  const learnable = STYLES.find((s) => canLearn(session.progress, s.id));
  if (learnable) return { kind: 'learn', styleId: learnable.id, params: {} };
  const swap = nextSwap(session);
  if (swap) return swap;
  // 선택 화면을 건너뛰면 봇이 도는 경로가 사람의 경로와 갈려, 재대련 계측이 화면에서만 나온다 (REQ-736).
  return { kind: 'select', params: { stage: nextDuelStage(session) } };
}

/** kill (d) 종점 감시 — 커서로 훑어 매 폴링마다 버퍼 전량을 다시 읽지 않는다. */
function createCycleDoneProbe(session, from = 0) {
  let at = from;
  let done = false;
  return () => {
    if (done) return true;
    const entries = session.log.entries;
    while (at < entries.length) {
      const entry = entries[at];
      at += 1;
      if (entry.event === 'cycle' && entry.phase === 'cycle_done') {
        done = true;
        return true;
      }
    }
    return false;
  };
}

/**
 * 브라우저 봇 v2 (REQ-605). 화면 전환은 상태기계에 맡기고 입력은 사람과 같은 경로로만 낸다.
 * @param {object} p
 * @param {object} p.session
 * @param {{phase: Function, params: Function, go: Function, refresh: Function}} p.screen
 * @param {() => (?{input: object, foe: object})} p.peek 지금 두드릴 수 있는 창 (없으면 null)
 * @param {(dir: string) => void} p.press
 * @param {() => void} p.reset
 * @param {{now: Function, schedule: Function, cancel: Function}} p.clock
 */
export function createBot({
  session, screen, peek, press, reset, clock,
  device = 'keyboard', random = Math.random, onDone = () => {},
}) {
  const pace = createPace(random);
  const hand = createHand({
    pace, now: clock.now, press, reset, random,
    prefer: preferLadderPush(session), rankOf: growthOrder(session),
  });
  let cycleDone = () => false;
  let timer = 0;
  let running = false;
  let inWindow = false;
  let readyAt = 0;
  let simulated = false;

  function navigate() {
    const phase = screen.phase();
    if (phase === 'train') {
      if (trainVisitDone(session)) screen.go('dojo');
      return;
    }
    if (phase === 'select') { screen.go('duel', screen.params()); return; }
    if (phase === 'preview') { screen.go('dispatch'); return; }
    // 봇에는 바닥 버튼을 누를 손이 없어, 실행 입구가 사람 경로와 둘로 갈리는 대가를 알고 헤드리스
    // 사이클과 같은 자리에서 직접 부른다 — 안 부르면 도장을 무한 왕복하고 사이클이 끝나지 않는다 (#172).
    if (phase === 'transmit') { enterTransmit(session); screen.go('dojo'); return; }
    if (phase === 'result') { screen.go('dojo'); return; }
    if (phase !== 'dojo') return;
    // 방치 축은 버튼 한 번으로만 체감되므로 사이클당 한 번 눌러 본다 (REQ-604).
    if (!simulated) {
      simulated = true;
      simulateTraining(session);
      screen.refresh();
      return;
    }
    const next = nextDojoAction(session);
    if (next.kind === 'learn') {
      learnStyle(session, next.styleId);
      screen.go('dojo');
      return;
    }
    if (next.kind === 'swap') {
      equip(session, next.styleId, next.slotIdx);
      screen.go('dojo');
      return;
    }
    if (next.kind === 'trainDisciple') {
      designateDiscipleTraining(session, next.styleId);
      // 방치 압축 버튼이 걸어 둔 시계를 앞당기는 그 자리다 — 봇도 사람과 같은 손잡이를 쓴다.
      simulateTraining(session);
      screen.go('dojo');
      return;
    }
    screen.go(next.kind, next.params);
  }

  function step() {
    if (!running) return;
    timer = clock.schedule(step, BALANCE.bot.pollMs);
    if (cycleDone()) {
      stop();
      onDone();
      return;
    }
    const window = peek();
    if (window) {
      if (!inWindow) {
        inWindow = true;
        hand.arm(window.input, window.foe);
      }
      hand.tick(window.input);
      return;
    }
    if (inWindow) {
      inWindow = false;
      readyAt = clock.now() + pace.navMs();
      return;
    }
    if (clock.now() < readyAt) return;
    navigate();
    readyAt = clock.now() + pace.navMs();
  }

  function stop() {
    if (!running) return;
    running = false;
    setBotRunning(session, false);
    clock.cancel(timer);
    // 손이 돌아온 것도 모집단 변화다 — 자발 종료든 사람이 멈추든 이 한 자리에서 되돌린다.
    logSessionMeta(session, { testerRole: 'self', device });
  }

  return {
    start() {
      if (running) return;
      running = true;
      // 봇 페이스 표본에 주입이 섞이면 그 회차가 무엇을 잰 것인지 로그로 가를 수 없다 (REQ-783).
      setBotRunning(session, true);
      // 커서를 지금 버퍼 끝에 두지 않으면 지난 사이클의 `cycle_done` 을 이번 실행의 종점으로 읽는다.
      cycleDone = createCycleDoneProbe(session, session.log.entries.length);
      simulated = false;
      logSessionMeta(session, { testerRole: 'bot', device });
      step();
    },
    stop,
    get running() { return running; },
  };
}

// ------------------------------------------------------- 헤드리스 1사이클 (REQ-601·605)

/** 가상 시계를 ms 만큼 밀어 연출·대기 시간도 페이스에 포함시킨다. */
function advance(timer, ms) {
  const until = timer.now() + ms;
  while (timer.now() < until) timer.tick();
}

function headlessTrain({ session, styleId, pace, timer, random, maxWindows = 200 }) {
  const style = styleById(styleId);
  const now = () => timer.now();
  let startedAt = 0;
  let windowMs = 1;
  let fired = null;

  const input = createSequenceInput({
    pool: [style],
    rankOf: (s) => rankOfStyle(session, s.id),
    hintDelayMs: BALANCE.hintDelayMs.train,
    now,
    remainingRatio: () => Math.max(0, 1 - (now() - startedAt) / windowMs),
    log: (event, fields) => logEvent(session, event, fields),
    screen: SCREEN.train.id,
  });
  const hand = createHand({
    pace,
    now,
    random,
    press: (dir) => { const result = input.press(dir, 'keyboard'); if (result.fired) fired = result.fired; },
    reset: () => input.reset(),
  });
  const wiring = trainWiring(session, { styleId, input });

  for (let i = 0; i < maxWindows; i += 1) {
    if (trainVisitDone(session)) return;
    windowMs = wiring.onArm();
    startedAt = now();
    fired = null;
    hand.arm(input, null);
    while (!fired && now() - startedAt < windowMs) {
      timer.tick();
      hand.tick(input);
    }
    if (fired) wiring.onFire();
    advance(timer, BALANCE.resolveMs);
  }
  throw new Error(`수련이 ${maxWindows} 창 안에 졸업하지 못했다: ${styleId}`);
}

function headlessDuel({ session, stage, pace, timer, random }) {
  const challenger = challengerOfStage(stage);
  const { foeRank } = logDuelStart(session, challenger);
  const now = () => timer.now();
  let ended = null;
  let match = null;

  const input = createSequenceInput({
    pool: equippedStyles(session),
    rankOf: (s) => rankOfStyle(session, s.id),
    hintDelayMs: BALANCE.hintDelayMs.duel,
    now,
    remainingRatio: () => match.windowRatio,
    log: (event, fields) => logEvent(session, event, fields),
    screen: SCREEN.duel.id,
    exchangeNo: () => (match ? match.view().exchange + 1 : 1),
  });
  const hand = createHand({
    pace,
    now,
    random,
    prefer: preferLadderPush(session),
    rankOf: growthOrder(session),
    press: (dir) => { const result = input.press(dir, 'keyboard'); if (result.fired) match.fire(result.fired); },
    reset: () => input.reset(),
  });

  match = createMatch({
    challenger,
    foeRank,
    selfHpMax: BALANCE.hp.user,
    rankOf: (style) => rankOfStyle(session, style.id),
    openLen: () => Math.max(...equippedStyles(session).map((s) => s.seq.length)),
    accessibility: () => session.accessibility,
    timer,
    random,
    hooks: composeHooks(duelWiring(session, { input }), {
      onWindow(view) {
        hand.arm(input, { style: view.telegraphed, open: view.foeOpen, pool: challenger.styles });
      },
      onTick() { hand.tick(input); },
      onEnd(view) { ended = view; },
    }),
  });

  pumpToEnd(match, timer);
  return ended;
}

function headlessDispatch({ session, timer, random = Math.random }) {
  const mission = currentMission(session, { random });
  const styles = discipleStyles(session.disciple, ART_ID);
  let ended = null;
  let match = null;

  const disciple = createDiscipleHand({ session, styles, random, fire: (fired) => match.fire(fired) });
  match = createMatch({
    challenger: mission.challenger,
    foeRank: mission.foeRank,
    selfHpMax: BALANCE.hp.disciple,
    rankOf: (style) => discipleStyleRank(session.disciple, ART_ID, style.id),
    openLen: () => Math.max(...styles.map((s) => s.seq.length)),
    accessibility: () => session.accessibility,
    timer,
    random,
    // 파견 무지시 — 배선에 지시 콜백을 주지 않는 것이 REQ-605 의 관전 조건이다.
    hooks: composeHooks(dispatchWiring(session, { disciple }), {
      onEnd(view) {
        ended = view;
        logDispatchResult(session, { mission, win: view.outcome.win });
      },
    }),
  });

  pumpToEnd(match, timer);
  return ended;
}

/**
 * B-2 이후 임무 + 제자 수련 (REQ-742·751~753) — 판정 범위 밖이라 셀프 관측용이다 (REQ-792).
 * 1사이클과 분리된 별개 구동인 것이 그 경계다: `cycle_done` 은 B-1 에서 이미 닫혔고 여기서
 * 나오는 항목은 판독기의 첫 사이클 밖이다. 실시간 방치를 기다리지 않고 주입 시계를 앞당겨 돈다.
 * @param {object} p.timer `runHeadlessCycle` 이 돌려준 가상 시계
 * @param {number} [p.stages] 이어서 돌 임무 수
 * @returns {{stage: string, challenger: string, foeSet: string[], foeRank: number, win: boolean}[]}
 */
export function runHeadlessMissions({
  session, timer, stages = 1, random = Math.random, maxTrainSteps = 80,
}) {
  const results = [];
  for (let i = 0; i < stages; i += 1) {
    enterPhase(session, 'dojo');
    // 뒤처진 초식부터 건다 — 잠금을 쥐는 것이 최소 성이라 그 초식이 곧 다음 임무의 열쇠다 (REQ-743).
    for (let step = 0; step < maxTrainSteps && !canDispatch(session); step += 1) {
      const behind = nextDiscipleTrainee(session);
      if (!behind) break;
      designateDiscipleTraining(session, behind.id);
      advanceDiscipleTraining(session, discipleTrainMsPerRank());
    }
    if (!canDispatch(session)) break;
    enterPhase(session, 'preview');
    const mission = beginMission(session, { random });
    enterPhase(session, 'dispatch');
    const view = headlessDispatch({ session, timer, random });
    enterPhase(session, 'result');
    settleResult(session, { kind: 'dispatch', win: view.outcome.win });
    results.push({
      stage: mission.label,
      challenger: mission.challenger.id,
      foeSet: mission.foeSet,
      foeRank: mission.foeRank,
      win: view.outcome.win,
    });
  }
  return results;
}

/**
 * 헤드리스 1사이클 (REQ-601·605) — 브라우저 없이 같은 봇·같은 입력기·같은 대련 루프로
 * 통합 로그 전 종류를 실제로 방출한다. 가상 시계라 실브라우저 실측을 대체하지 않는다.
 * @returns {{session: object, elapsedMs: number, screens: number, timer: object}}
 */
export function runHeadlessCycle({
  // 11·12성이 결정타·완파라는 사건으로만 열려 화면 수의 꼬리가 길고, 그 사건이 떨어질 초식은
  // 확률적이라 시드마다 흔들린다 — 손 정확도 50% 시나리오 12시드 실측 상계 150화면의 8배를
  // 상한으로 둬, 밸런스 값 한 칸이 그 꼬리를 늘려도 상한이 먼저 울지 않게 한다 (REQ-704).
  session: given = null, random = Math.random, stepMs = 16, maxScreens = 1200, device = 'keyboard',
  paceSeed = BALANCE.bot,
} = {}) {
  const timer = createVirtualTimer({ stepMs });
  // `t_ms` 가 벽시계면 헤드리스 로그의 kill (a)·(d) 가 통째로 0 이 된다.
  const session = given ?? createSession({ now: () => timer.now() });
  // 사이클 시뮬은 손 정확도를 흔들어 유효 성공률 시나리오를 만든다 — 시드 교체가 그 유일한 축이다.
  const pace = createPace(random, paceSeed);
  let phase = 'dojo';
  let params = {};
  let simulated = false;
  let screens = 0;

  setBotRunning(session, true);
  logSessionMeta(session, { testerRole: 'bot', device });
  const go = (next, nextParams = {}) => { phase = next; params = nextParams; };

  // 상한 초과·내부 throw 로 나가도 구동 표식을 되돌린다 — 남으면 그 세션은 치트가 영구 잠긴다.
  try {
    return runScreens();
  } finally {
    setBotRunning(session, false);
  }

  function runScreens() {
  while (screens < maxScreens) {
    screens += 1;
    enterPhase(session, phase);
    advance(timer, pace.navMs());

    if (phase === 'dojo') {
      if (!simulated) { simulated = true; simulateTraining(session); }
      const next = nextDojoAction(session);
      if (next.kind === 'learn') learnStyle(session, next.styleId);
      else if (next.kind === 'swap') equip(session, next.styleId, next.slotIdx);
      else if (next.kind === 'trainDisciple') {
        designateDiscipleTraining(session, next.styleId);
        simulateTraining(session);
      } else go(next.kind, next.params);
      continue;
    }
    if (phase === 'train') {
      headlessTrain({ session, styleId: params.styleId, pace, timer, random });
      go('dojo');
      continue;
    }
    if (phase === 'duel') {
      const view = headlessDuel({ session, stage: params.stage, pace, timer, random });
      go('result', { kind: 'duel', win: view.outcome.win, stage: params.stage });
      continue;
    }
    if (phase === 'transmit') {
      enterTransmit(session);
      go('dojo');
      continue;
    }
    if (phase === 'select') {
      go('duel', params);
      continue;
    }
    if (phase === 'preview') {
      beginMission(session, { random });
      go('dispatch');
      continue;
    }
    if (phase === 'dispatch') {
      const view = headlessDispatch({ session, timer, random });
      go('result', { kind: 'dispatch', win: view.outcome.win });
      continue;
    }
    if (phase === 'result') {
      // 화면과 같은 문을 지난다 — 정산의 입구가 둘이면 그중 하나만 고쳐도 결과가 갈린다 (#70).
      settleResult(session, params);
      if (params.kind === 'duel') {
        go('dojo');
        continue;
      }
      // 시계를 함께 돌려준다 — B-2 이후 임무·제자 수련의 셀프 관측이 같은 가상 시계 위에서 이어진다.
      return { session, elapsedMs: timer.now(), screens, timer };
    }
    throw new Error(`알 수 없는 화면: ${phase}`);
  }
  throw new Error(`1사이클이 ${maxScreens} 화면 안에 끝나지 않았다`);
  }
}
