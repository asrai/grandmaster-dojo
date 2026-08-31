// 한 수의 타임라인 엔진 (REQ-201·204) — 사부 대련과 파견이 같은 부품을 쓴다.
// 차이는 「창을 무엇이 닫는가」뿐이라, 발동 주체는 `fire()` 를 부르는 호출부가 정한다.

import { BALANCE } from '../balance.mjs';
import { foeStyleById, judge, resolveMatch, responseWindowMs } from '../core.mjs';

export const PHASE = { TELEGRAPH: 'telegraph', WINDOW: 'window', RESOLVE: 'resolve', DONE: 'done' };

/**
 * @param {object} p
 * @param {object} p.challenger  도전자 행 (예고 순환·내공 시드의 출처)
 * @param {number} p.selfHpMax
 * @param {() => number} p.rankOf 그 수 시점의 내 성 — 대련 중에도 오를 수 있다
 * @param {() => number} p.openLen 상대 빈틈 수의 창 기준 길이 — 장착이 바뀌면 따라 바뀐다
 * @param {() => boolean} p.accessibility 접근성 창 확대 여부
 * @param {object} p.hooks onTelegraph · onWindow · onTick · onTimeout · onVerdict · onEnd
 */
export function createMatch({ challenger, selfHpMax, rankOf, openLen, accessibility, hooks = {} }) {
  const foePower = BALANCE.challengerPower[challenger.group];
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

  const clock = () => performance.now();
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
      selfRank: rankOf(),
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
    raf = requestAnimationFrame(frame);
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
        cancelAnimationFrame(raf);
        hooks.onEnd?.({ ...view(), outcome: s.outcome });
      } else {
        enterTelegraph();
      }
    }
  }

  return {
    view,
    start() {
      enterTelegraph();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
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
