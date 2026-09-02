// 한 수의 타임라인 엔진 (REQ-201·204) — 사부 대련과 파견이 같은 부품을 쓴다.
// 차이는 「창을 무엇이 닫는가」뿐이라, 발동 주체는 `fire()` 를 부르는 호출부가 정한다.

import { BALANCE } from '../balance.mjs';
import { foeRankOf, foeStyleById, judge, powerOf, resolveMatch, responseWindowMs } from '../core.mjs';

export const PHASE = { TELEGRAPH: 'telegraph', WINDOW: 'window', RESOLVE: 'resolve', DONE: 'done' };

/** 브라우저 프레임 시계 — 기본 구동원이자 이 모듈이 전역에 닿는 유일한 지점이다. */
const FRAME_TIMER = {
  now: () => performance.now(),
  schedule: (fn) => requestAnimationFrame(fn),
  cancel: (id) => cancelAnimationFrame(id),
};

/**
 * 가상 프레임 시계 — 실시간을 기다리지 않으므로 `tick()` 한 번이 한 프레임이다.
 * 하네스·봇이 대련 루프의 사본이 아니라 `createMatch` 그 자체를 돌리게 하는 부품이다.
 */
export function createVirtualTimer({ stepMs = 16 } = {}) {
  let t = 0;
  let nextId = 1;
  const queued = new Map();
  return {
    now: () => t,
    schedule(fn) { const id = nextId; nextId += 1; queued.set(id, fn); return id; },
    cancel(id) { queued.delete(id); },
    tick() {
      // 프레임 본문이 다음 프레임을 다시 예약하므로 실행 전에 큐를 비운다.
      const due = [...queued.values()];
      queued.clear();
      t += stepMs;
      for (const fn of due) fn();
      return due.length;
    },
  };
}

/** 가상 시계를 대련이 끝날 때까지 돌린다. */
export function pumpToEnd(match, timer, { maxTicks = 20000 } = {}) {
  let ticks = 0;
  match.start();
  while (match.phase !== PHASE.DONE && ticks < maxTicks) {
    timer.tick();
    ticks += 1;
  }
  if (match.phase !== PHASE.DONE) throw new Error(`대련이 ${maxTicks} 프레임 안에 끝나지 않았다`);
  return { view: match.view(), ticks, elapsedMs: timer.now() };
}

/**
 * @param {object} p
 * @param {object} p.challenger  도전자 행 (예고 순환의 출처)
 * @param {number} [p.foeRank]   그 대면의 도전자 성 — 재대련 강화가 실린 값이 여기로 온다 (REQ-734)
 * @param {number} p.selfHpMax
 * @param {(style: object) => number} p.rankOf 그 수에 낸 초식의 성 — 대련 중에도 오를 수 있다 (REQ-721)
 * @param {() => number} p.openLen 상대 빈틈 수의 창 기준 길이 — 장착이 바뀌면 따라 바뀐다
 * @param {() => boolean} p.accessibility 접근성 창 확대 여부
 * @param {object} p.hooks onTelegraph · onWindow · onTick · onTimeout · onVerdict · onEnd
 * @param {object} [p.timer] 프레임 구동원 (now/schedule/cancel) — 헤드리스는 가상 시계를 준다
 */
export function createMatch({
  challenger, selfHpMax, rankOf, openLen, accessibility, hooks = {}, timer = FRAME_TIMER,
  foeRank = foeRankOf(challenger.id),
}) {
  const foePower = powerOf(foeRank);
  const foeHpMax = BALANCE.hp[challenger.id];
  const s = {
    phase: PHASE.TELEGRAPH,
    phaseStart: 0,
    exchange: 0,
    selfHp: selfHpMax,
    foeHp: foeHpMax,
    foeOpen: false,
    selfOpen: false,
    telegraphed: null,
    windowMs: 0,
    verdict: null,
    outcome: { over: false, win: null, by: null },
  };
  let raf = 0;
  let pending = null;

  const clock = () => timer.now();
  const elapsed = () => clock() - s.phaseStart;

  const view = () => ({
    phase: s.phase,
    exchange: s.exchange,
    selfHp: Math.max(0, s.selfHp),
    foeHp: Math.max(0, s.foeHp),
    selfHpMax,
    foeHpMax,
    telegraphed: s.telegraphed,
    foeOpen: s.foeOpen,
    selfOpen: s.selfOpen,
    windowMs: s.windowMs,
    verdict: s.verdict,
    challenger,
    // 결정타 판정은 그 수의 성 계단 자격이라 판정과 같은 프레임에 필요하다 (REQ-704·708).
    outcome: s.outcome,
    ratio: s.phase === PHASE.WINDOW && s.windowMs ? Math.max(0, 1 - elapsed() / s.windowMs) : 0,
  });

  function enterTelegraph() {
    // 빈틈 수에도 예고 순번은 전진한다 — 상대가 그 수를 잃는 것으로 본다.
    s.telegraphed = s.foeOpen ? null : foeStyleById(challenger.styles[s.exchange % challenger.styles.length]);
    s.phase = PHASE.TELEGRAPH;
    s.phaseStart = clock();
    pending = null;
    hooks.onTelegraph?.(view());
  }

  function enterWindow() {
    // 상대 빈틈에는 예고가 없어 어떤 초식을 낼지 모르므로 가장 긴 시퀀스 기준으로 연다.
    const len = s.telegraphed ? s.telegraphed.len : openLen();
    s.windowMs = responseWindowMs(len, { selfOpen: s.selfOpen, accessibility: accessibility() });
    s.phase = PHASE.WINDOW;
    s.phaseStart = clock();
    hooks.onWindow?.(view());
  }

  function settle(fire) {
    const verdict = judge({
      selfStyle: fire ? fire.style : null,
      foeStyle: s.telegraphed,
      // 미완주에는 낸 초식이 없어 성의 근거가 없다 — 받는 피해는 상대 D 로만 나므로 최저 성으로 접는다.
      selfRank: fire ? rankOf(fire.style) : 1,
      foeRank,
      foePower,
      r: fire ? fire.r : 0,
      foeOpen: s.foeOpen,
    });
    s.foeHp -= verdict.dmgOut;
    s.selfHp -= verdict.dmgIn;
    s.exchange += 1;
    s.verdict = verdict;
    s.foeOpen = verdict.opening === 'foe';
    s.selfOpen = verdict.opening === 'self';
    s.phase = PHASE.RESOLVE;
    s.phaseStart = clock();
    s.outcome = resolveMatch({ selfHp: s.selfHp, foeHp: s.foeHp, exchanges: s.exchange });
    hooks.onVerdict?.({ ...view(), fire, verdict });
  }

  function frame() {
    raf = timer.schedule(frame);
    if (s.phase === PHASE.TELEGRAPH) {
      if (elapsed() >= BALANCE.telegraphMs) enterWindow();
      return;
    }
    if (s.phase === PHASE.WINDOW) {
      hooks.onTick?.(view());
      if (pending) {
        const fire = pending;
        pending = null;
        settle(fire);
      } else if (elapsed() >= s.windowMs) {
        hooks.onTimeout?.(view());
        settle(null);
      }
      return;
    }
    if (s.phase === PHASE.RESOLVE && elapsed() >= BALANCE.resolveMs) {
      if (s.outcome.over) {
        s.phase = PHASE.DONE;
        timer.cancel(raf);
        hooks.onEnd?.(view());
      } else {
        enterTelegraph();
      }
    }
  }

  return {
    view,
    start() {
      enterTelegraph();
      raf = timer.schedule(frame);
    },
    stop() {
      timer.cancel(raf);
      s.phase = PHASE.DONE;
    },
    /** 창을 닫는 유일한 경로 — 발동은 다음 프레임에 판정된다. */
    fire(fired) {
      if (s.phase !== PHASE.WINDOW || pending) return false;
      pending = fired;
      return true;
    },
    get phase() { return s.phase; },
    get windowRatio() { return view().ratio; },
  };
}
