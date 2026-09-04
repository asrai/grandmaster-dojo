// 한 초의 타임라인 엔진 (REQ-201·204) — 사부 대련과 파견이 같은 부품을 쓴다.
// 차이는 「창을 무엇이 닫는가」뿐이라, 발동 주체는 `fire()` 를 부르는 호출부가 정한다.
// `blindExchange` 아래에서는 `fire()` 가 확정만 걸고 발동은 창 만료가 진다 (#243).

import { BALANCE } from '../balance.mjs';
import { foeRankOf, foeStyleById, judge, powerOf, resolveMatch, responseWindowMs } from '../core.mjs';

/** `TELEGRAPH` 는 예고 모드(`blindExchange` OFF)에서만 서는 페이즈다 (#243). */
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
 * @param {(style: object) => number} p.rankOf 그 초에 낸 초식의 성 — 대련 중에도 오를 수 있다 (REQ-721)
 * @param {() => number} p.openLen 상대 빈틈 초의 창 기준 길이 — 장착이 바뀌면 따라 바뀐다
 * @param {() => boolean} p.accessibility 접근성 창 확대 여부
 * @param {object} p.hooks onExchange · onWindow · onTick · onTimeout · onVerdict · onEnd
 * @param {object} [p.timer] 프레임 구동원 (now/schedule/cancel) — 헤드리스는 가상 시계를 준다
 * @param {() => number} [p.random] 상대 초식 추첨의 난수 — 하네스가 시드로 고정해 판정 단정을
 *   결정적으로 유지하고, 브라우저만 실제 난수를 준다 (#243 결정 5)
 * @param {boolean} [p.blind] 상대를 감추는가 — 기본값은 원장이되 `timer`·`random` 과 같은 규약으로
 *   주입을 열어 둔 것은, 예고 모드 갈래가 하네스에 닿지 못하면 토글 복원을 지키는 것이 사람의
 *   1회성 실행뿐이 되기 때문이다 (#243 결정 9)
 */
export function createMatch({
  challenger, selfHpMax, rankOf, openLen, accessibility, hooks = {}, timer = FRAME_TIMER,
  foeRank = foeRankOf(challenger.id), random = Math.random, blind = BALANCE.blindExchange,
}) {
  const foePower = powerOf(foeRank);
  const foeHpMax = BALANCE.hp[challenger.id];
  const s = {
    phase: blind ? PHASE.WINDOW : PHASE.TELEGRAPH,
    phaseStart: 0,
    exchange: 0,
    selfHp: selfHpMax,
    foeHp: foeHpMax,
    foeOpen: false,
    selfOpen: false,
    // 판정이 정하는 빈틈은 다음 초의 것이라, 이번 초 귀속값과 한 칸을 쓰면 판정 view 가 두 초를 섞는다 (#252).
    openNext: { foe: false, self: false },
    foeStyle: null,
    revealed: false,
    windowMs: 0,
    verdict: null,
    outcome: { over: false, win: null, by: null },
  };
  let raf = 0;
  let pending = null;

  const clock = () => timer.now();
  const elapsed = () => clock() - s.phaseStart;
  /** 아직 손을 받는 창인가 — 프레임이 밀려 도착해도 마감이 입력보다 먼저라야 판정이 흔들리지 않는다. */
  const isOpen = () => s.phase === PHASE.WINDOW && elapsed() < s.windowMs;

  const view = () => ({
    phase: s.phase,
    exchange: s.exchange,
    selfHp: Math.max(0, s.selfHp),
    foeHp: Math.max(0, s.foeHp),
    selfHpMax,
    foeHpMax,
    // 화면이 읽는 유일한 상대 초식 — 감춰진 동안 null 이라 렌더가 그 사실을 우회할 수 없다 (#243 결정 2).
    telegraphed: s.revealed ? s.foeStyle : null,
    // 상대를 읽는 쪽(제자의 손)만 보는 자리 — 화면이 이 값을 그리면 숨김이 통째로 무너진다 (#243).
    foeStyle: s.foeStyle,
    // 이 두 값은 언제나 **이번 초**를 말한다 — 판정이 정한 다음 초 빈틈은 `openNext` 가 따로 진다 (#252).
    foeOpen: s.foeOpen,
    selfOpen: s.selfOpen,
    windowMs: s.windowMs,
    verdict: s.verdict,
    challenger,
    // 결정타 판정은 그 초의 성 계단 자격이라 판정과 같은 프레임에 필요하다 (REQ-704·708).
    outcome: s.outcome,
    ratio: s.phase === PHASE.WINDOW && s.windowMs ? Math.max(0, 1 - elapsed() / s.windowMs) : 0,
  });

  /** 그 초의 상대 초식 — 감추는 초는 순번을 읽히지 않도록 추첨한다 (#243 결정 5). */
  function drawFoeStyle() {
    const ids = challenger.styles;
    return foeStyleById(blind ? ids[Math.floor(random() * ids.length)] : ids[s.exchange % ids.length]);
  }

  /** 한 초의 시작 — 예고 모드는 여기서 상대를 보여 주고, 감추는 모드는 곧바로 창을 연다. */
  function enterExchange() {
    // 직전 판정이 예약한 빈틈이 이 초에 귀속되는 유일한 지점 — 소비하지 않으면 예약이 계속 흐른다.
    s.foeOpen = s.openNext.foe;
    s.selfOpen = s.openNext.self;
    s.openNext = { foe: false, self: false };
    // 빈틈 초에도 상대의 순번은 전진한다 — 상대가 그 초를 잃는 것으로 본다.
    s.foeStyle = s.foeOpen ? null : drawFoeStyle();
    s.revealed = !blind;
    s.phaseStart = clock();
    // 직전 초의 창 길이를 그대로 흘리면 이 훅의 `ratio` 가 남의 초를 말한다.
    s.windowMs = 0;
    pending = null;
    // 감추는 초에는 예고 페이즈가 없어 초의 시작이 곧 창이다 — 직전 `RESOLVE` 를 흘리면 훅이 끝난 판정을 본다.
    s.phase = blind ? PHASE.WINDOW : PHASE.TELEGRAPH;
    hooks.onExchange?.(view());
    if (blind) enterWindow();
  }

  function enterWindow() {
    // 상대가 초식을 내지 않는 초의 기준 길이 — 예고 모드에서만 창에 실린다 (#243).
    const len = s.foeStyle ? s.foeStyle.len : openLen();
    s.windowMs = responseWindowMs(len, { selfOpen: s.selfOpen, accessibility: accessibility(), blind });
    s.phase = PHASE.WINDOW;
    s.phaseStart = clock();
    hooks.onWindow?.(view());
  }

  function settle(fire) {
    const verdict = judge({
      selfStyle: fire ? fire.style : null,
      foeStyle: s.foeStyle,
      // 미완주에는 낸 초식이 없어 성의 근거가 없다 — 받는 피해는 상대 D 로만 나므로 최저 성으로 접는다.
      selfRank: fire ? rankOf(fire.style) : 1,
      foeRank,
      foePower,
      // 감추는 초는 발동이 늘 창 만료라 확정 시점의 잔여가 판정에 들어갈 자리가 없다 (#243).
      r: blind || !fire ? 0 : fire.r,
      foeOpen: s.foeOpen,
    });
    s.foeHp -= verdict.dmgOut;
    s.selfHp -= verdict.dmgIn;
    s.exchange += 1;
    s.verdict = verdict;
    s.openNext = { foe: verdict.opening === 'foe', self: verdict.opening === 'self' };
    s.phase = PHASE.RESOLVE;
    // 양쪽이 함께 드러나는 지점 — 판정과 공개가 갈리면 화면이 이유 없는 결과를 그린다 (#243 결정 2).
    s.revealed = true;
    s.phaseStart = clock();
    s.outcome = resolveMatch({ selfHp: s.selfHp, foeHp: s.foeHp, exchanges: s.exchange });
    hooks.onVerdict?.({ ...view(), fire, verdict });
  }

  function frame() {
    raf = timer.schedule(frame);
    if (s.phase === PHASE.TELEGRAPH) {
      if (elapsed() >= BALANCE.telegraphMode.telegraphMs) enterWindow();
      return;
    }
    if (s.phase === PHASE.WINDOW) {
      // 만료 뒤에 도착한 프레임에서 `onTick` 을 돌리면 제자의 손이 그 자리에서 뒤늦게 확정하고,
      // 그 확정이 미완주를 정상 발동으로 뒤집는다 — 마감이 어떤 입력보다 먼저다 (#243).
      if (!isOpen()) {
        const fire = pending;
        pending = null;
        if (!fire) hooks.onTimeout?.(view());
        settle(fire);
        return;
      }
      hooks.onTick?.(view());
      if (pending && !blind) {
        const fire = pending;
        pending = null;
        settle(fire);
      }
      return;
    }
    if (s.phase === PHASE.RESOLVE && elapsed() >= BALANCE.resolveMs) {
      if (s.outcome.over) {
        s.phase = PHASE.DONE;
        timer.cancel(raf);
        hooks.onEnd?.(view());
      } else {
        enterExchange();
      }
    }
  }

  return {
    view,
    start() {
      enterExchange();
      raf = timer.schedule(frame);
    },
    stop() {
      timer.cancel(raf);
      s.phase = PHASE.DONE;
    },
    /** 낼 초식을 거는 유일한 경로 — 예고 모드는 다음 프레임에, 감추는 모드는 창 만료에 판정된다. */
    fire(fired) {
      if (!isOpen() || pending) return false;
      pending = fired;
      return true;
    },
    get phase() { return s.phase; },
    /** 손을 받는 구간인가 — 페이즈만 보면 밀린 프레임에서 마감 뒤 입력이 통과한다 (#243). */
    get open() { return isOpen(); },
    /** 확정이 걸린 뒤로는 손을 받지 않는다 — 가위바위보는 낸 것을 무르지 못한다 (#243 결정 1). */
    get locked() { return pending !== null; },
    get windowRatio() { return view().ratio; },
  };
}
