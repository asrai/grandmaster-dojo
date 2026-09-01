// 사람 속도 봇 v2 (REQ-605) — 손 대신 같은 입력 경로를 두드려 1사이클을 자동 완주한다.
// 화면·시계·난수가 주입이라 브라우저와 헤드리스가 지연 모델·입력기·대련 루프를 공유한다
// 계측 배선도 `ui/wiring.mjs` 한 벌이고 각자 갖는 것은 렌더·구동뿐이다 — 브라우저는 폴링,
// 헤드리스는 프레임이라 페이스가 정확히 같지는 않다.
// 여기서 나오는 수치는 페이스 회귀 참고치이고 kill 판정 표본이 아니다.

import { BALANCE, STYLES } from './balance.mjs';
import {
  canLearn, discipleRankOf, discipleStyles, selectDiscipleStyle, styleById,
} from './core.mjs';
import { createMatch, createVirtualTimer, pumpToEnd } from './ui/match.mjs';
import { createSequenceInput } from './ui/sequence-input.mjs';
import {
  ART_ID, DISPATCH_CHALLENGER, artRank, canTransmitNow, challengerOfStage, createSession,
  equippedStyles, learnStyle, logEvent, logSessionMeta, masteryOf, runTransmit,
  settleDispatch, settleDuel, simulateTraining,
} from './ui/session.mjs';
import {
  composeHooks, dispatchWiring, duelWiring, logDispatchStart, trainWiring,
} from './ui/wiring.mjs';

const DIRS = ['U', 'D', 'L', 'R'];
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

/** 이 창에 낼 초식 — 화면이 상시 병기하는 「이기는 색」을 그대로 따르는 선택이다 (REQ-206). */
const chooseStyle = (input, foeStyle) =>
  selectDiscipleStyle({ styles: input.candidates, foeStyle, rankOf: () => 0 });

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
 *
 * 숙련 100% 라도 원터치를 쓰지 않는다 — 원터치 창은 kill (b) 분모에서 빠지므로,
 * 탭하는 봇은 자기가 재려던 완주율 표본을 스스로 지운다 (REQ-302·603).
 */
export function createHand({ pace, now, press, reset, random = Math.random }) {
  let keys = [];
  let at = 0;
  let readyAt = 0;
  let strayed = false;

  return {
    /** 창이 열릴 때 한 번 — 낼 초식과 이번에 놓칠 키를 그 자리에서 정한다. */
    arm(input, foeStyle) {
      const style = chooseStyle(input, foeStyle);
      keys = [];
      at = 0;
      strayed = false;
      // 놓친 키 하나가 그 창을 미완주로 닫는다 — kill (b) 분모의 `timeout` 이 여기서 난다.
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
 */
export function createDiscipleHand({ session, styles, fire }) {
  let done = false;
  return {
    arm() { done = false; },
    /** 창의 60% 시점에 반드시 실행하므로 선기 잔여는 상수다. 지시가 있으면 그 수만 대체한다. */
    tick(view, instructed = null) {
      if (done || view.ratio > 1 - BALANCE.discipleFireRatio) return null;
      done = true;
      const style = instructed ?? selectDiscipleStyle({
        styles,
        foeStyle: view.telegraphed,
        rankOf: () => discipleRankOf(session.disciple, ART_ID),
      });
      if (!style) throw new Error('제자가 낼 초식이 없다 — 전수된 무공이 비었다');
      logEvent(session, 'select', { styleId: style.id, byUser: Boolean(instructed) });
      fire({ style, oneTap: false, r: 1 - BALANCE.discipleFireRatio });
      return style;
    },
  };
}

/** 도장에서의 다음 한 수 — 브라우저 봇과 헤드리스 사이클이 같은 판단을 쓴다. */
export function nextDojoAction(session) {
  if (canTransmitNow(session)) return { kind: 'transmit', params: {} };
  if (session.transmitted) return { kind: 'preview', params: {} };
  const untrained = STYLES.find((s) => session.progress.styles[s.id].learned
    && session.progress.styles[s.id].trainHits < BALANCE.trainGraduateHits);
  if (untrained) return { kind: 'train', params: { styleId: untrained.id } };
  const learnable = STYLES.find((s) => canLearn(session.progress, s.id));
  if (learnable) return { kind: 'learn', styleId: learnable.id, params: {} };
  return { kind: 'duel', params: { stage: session.stage } };
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
 * @param {() => (?{input: object, foeStyle: ?object})} p.peek 지금 두드릴 수 있는 창 (없으면 null)
 * @param {(dir: string) => void} p.press
 * @param {() => void} p.reset
 * @param {{now: Function, schedule: Function, cancel: Function}} p.clock
 */
export function createBot({
  session, screen, peek, press, reset, clock,
  device = 'keyboard', random = Math.random, onDone = () => {},
}) {
  const pace = createPace(random);
  const hand = createHand({ pace, now: clock.now, press, reset, random });
  let cycleDone = () => false;
  let timer = 0;
  let running = false;
  let inWindow = false;
  let readyAt = 0;
  let simulated = false;

  function navigate() {
    const phase = screen.phase();
    if (phase === 'train') {
      const style = session.progress.styles[screen.params().styleId];
      if (style.trainHits >= BALANCE.trainGraduateHits) screen.go('dojo');
      return;
    }
    if (phase === 'preview') { screen.go('dispatch'); return; }
    if (phase === 'transmit' || phase === 'result') { screen.go('dojo'); return; }
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
        hand.arm(window.input, window.foeStyle);
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
    clock.cancel(timer);
    // 손이 돌아온 것도 모집단 변화다 — 자발 종료든 사람이 멈추든 이 한 자리에서 되돌린다.
    logSessionMeta(session, { testerRole: 'self', device });
  }

  return {
    start() {
      if (running) return;
      running = true;
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
    masteryOf: (s) => masteryOf(session, s.id),
    hintDelayMs: BALANCE.hintDelayMs.train,
    now,
    remainingRatio: () => Math.max(0, 1 - (now() - startedAt) / windowMs),
    log: (event, fields) => logEvent(session, event, fields),
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
    if (session.progress.styles[styleId].trainHits >= BALANCE.trainGraduateHits) return;
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
  const now = () => timer.now();
  let ended = null;
  let match = null;

  const input = createSequenceInput({
    pool: equippedStyles(session),
    masteryOf: (s) => masteryOf(session, s.id),
    hintDelayMs: BALANCE.hintDelayMs.duel,
    now,
    remainingRatio: () => match.windowRatio,
    log: (event, fields) => logEvent(session, event, fields),
  });
  const hand = createHand({
    pace,
    now,
    random,
    press: (dir) => { const result = input.press(dir, 'keyboard'); if (result.fired) match.fire(result.fired); },
    reset: () => input.reset(),
  });

  match = createMatch({
    challenger,
    selfHpMax: BALANCE.hp.user,
    rankOf: () => artRank(session),
    openLen: () => Math.max(...equippedStyles(session).map((s) => s.seq.length)),
    accessibility: () => session.accessibility,
    timer,
    hooks: composeHooks(duelWiring(session, { input }), {
      onWindow(view) { hand.arm(input, view.telegraphed); },
      onTick() { hand.tick(input); },
      onEnd(view) { ended = view; },
    }),
  });

  pumpToEnd(match, timer);
  return ended;
}

function headlessDispatch({ session, timer }) {
  const challenger = DISPATCH_CHALLENGER;
  const styles = discipleStyles(session.disciple, ART_ID);
  let ended = null;
  let match = null;

  const disciple = createDiscipleHand({ session, styles, fire: (fired) => match.fire(fired) });
  match = createMatch({
    challenger,
    selfHpMax: BALANCE.hp.disciple,
    rankOf: () => discipleRankOf(session.disciple, ART_ID),
    openLen: () => Math.max(...styles.map((s) => s.seq.length)),
    accessibility: () => session.accessibility,
    timer,
    // 파견 무지시 — 배선에 지시 콜백을 주지 않는 것이 REQ-605 의 관전 조건이다.
    hooks: composeHooks(dispatchWiring(session, { disciple }), {
      onEnd(view) { ended = view; },
    }),
  });

  logDispatchStart(session, challenger);
  pumpToEnd(match, timer);
  return ended;
}

/**
 * 헤드리스 1사이클 (REQ-601·605) — 브라우저 없이 같은 봇·같은 입력기·같은 대련 루프로
 * 통합 로그 17종을 실제로 방출한다. 가상 시계라 실브라우저 실측을 대체하지 않는다.
 * @returns {{session: object, elapsedMs: number, screens: number}}
 */
export function runHeadlessCycle({
  session: given = null, random = Math.random, stepMs = 16, maxScreens = 600, device = 'keyboard',
} = {}) {
  const timer = createVirtualTimer({ stepMs });
  // `t_ms` 가 벽시계면 헤드리스 로그의 kill (a)·(d) 가 통째로 0 이 된다.
  const session = given ?? createSession({ now: () => timer.now() });
  const pace = createPace(random);
  let phase = 'dojo';
  let params = {};
  let simulated = false;
  let screens = 0;

  logSessionMeta(session, { testerRole: 'bot', device });
  const go = (next, nextParams = {}) => { phase = next; params = nextParams; };

  while (screens < maxScreens) {
    screens += 1;
    logEvent(session, 'cycle', { phase });
    advance(timer, pace.navMs());

    if (phase === 'dojo') {
      if (!simulated) { simulated = true; simulateTraining(session); }
      const next = nextDojoAction(session);
      if (next.kind === 'learn') learnStyle(session, next.styleId);
      else go(next.kind, next.params);
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
      runTransmit(session);
      go('dojo');
      continue;
    }
    if (phase === 'preview') {
      go('dispatch');
      continue;
    }
    if (phase === 'dispatch') {
      const view = headlessDispatch({ session, timer });
      go('result', { kind: 'dispatch', win: view.outcome.win });
      continue;
    }
    if (phase === 'result') {
      if (params.kind === 'duel') {
        settleDuel(session, { win: params.win, stage: params.stage });
        go('dojo');
        continue;
      }
      settleDispatch(session, { win: params.win });
      return { session, elapsedMs: timer.now(), screens };
    }
    throw new Error(`알 수 없는 화면: ${phase}`);
  }
  throw new Error(`1사이클이 ${maxScreens} 화면 안에 끝나지 않았다`);
}
