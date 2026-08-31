// 후보 필터 시퀀스 입력기 (REQ-101~112). 4방향은 전부 `press()` 한 경로로 들어오고,
// DOM 을 모르므로 화면 없이도 페이스를 재현할 수 있다.

import { BALANCE } from '../balance.mjs';

/**
 * @param {object} p
 * @param {object[]} p.pool 이 창에서 낼 수 있는 초식 (실전 = 장착분, 수련 = 그 초식 하나)
 * @param {(style: object) => number} p.masteryOf 숙련 % — 후보 정렬과 원터치 자격의 입력
 * @param {number} p.hintDelayMs 잔여 화살표 점등 지연 (실전 0.5s · 수련 0)
 * @param {() => number} p.now 단조 클럭
 * @param {() => number} p.remainingRatio 발동 시점의 창 잔여 비율 `r`
 * @param {(event: string, fields: object) => void} p.log 통합 로그 싱크
 */
export function createSequenceInput({
  pool, masteryOf, hintDelayMs, now, remainingRatio = () => 0, log,
}) {
  let buffer = [];
  let ignores = 0;
  let hintFrom = now();

  const keyOf = (dirs) => dirs.join('');
  const matching = (dirs) => pool
    .filter((s) => keyOf(s.seq).startsWith(keyOf(dirs)))
    // 결정적 순서: 숙련 높은 순 → 동률이면 슬롯 순 (REQ-102).
    .sort((a, b) => masteryOf(b) - masteryOf(a) || pool.indexOf(a) - pool.indexOf(b));

  let candidates = matching(buffer);
  const top = () => candidates[0] ?? null;

  function fire(style, oneTap) {
    const r = Math.max(0, Math.min(1, remainingRatio()));
    log('fire', { styleId: style.id, len: style.seq.length, oneTap, r });
    return { style, oneTap, r };
  }

  return {
    get buffer() { return buffer.slice(); },
    get candidates() { return candidates.slice(); },
    get ignores() { return ignores; },
    top,

    /** 응수 창이 열릴 때마다 버퍼·무시 누적·힌트 시계를 함께 되돌린다 (REQ-104). */
    arm() {
      buffer = [];
      ignores = 0;
      hintFrom = now();
      candidates = matching(buffer);
    },

    /** 점등된 화살표 수 — 숙련 100% 는 원터치 권한이 있으므로 지연 없이 전부 보인다 (REQ-108). */
    revealed(style = top()) {
      if (!style) return 0;
      if (masteryOf(style) >= BALANCE.masteryFullPct) return style.seq.length;
      const lit = now() - hintFrom >= hintDelayMs ? buffer.length + 1 : buffer.length;
      return Math.min(lit, style.seq.length);
    },

    /** @returns {{accepted: boolean, fired: ?object}} */
    press(dir, device) {
      const next = [...buffer, dir];
      const nextCandidates = matching(next);
      if (!nextCandidates.length) {
        // 오입력은 진행을 되돌리지 않는다 — 손이 굳기 전 단계의 리셋은 완주율 표본을 훼손한다.
        ignores += 1;
        log('key', { dir, accepted: false, candidates_n: candidates.length, top_attr: top()?.attr ?? null, device });
        log('ignore', { dir });
        return { accepted: false, fired: null };
      }

      const narrowed = nextCandidates.length < candidates.length;
      buffer = next;
      candidates = nextCandidates;
      hintFrom = now();
      log('key', { dir, accepted: true, candidates_n: candidates.length, top_attr: top().attr, device });
      if (narrowed) log('narrow', { styleId: top().id });

      const only = candidates.length === 1 ? candidates[0] : null;
      const fired = only && keyOf(only.seq) === keyOf(buffer) ? fire(only, false) : null;
      return { accepted: true, fired };
    },

    reset() {
      buffer = [];
      ignores = 0;
      hintFrom = now();
      candidates = matching(buffer);
      log('reset', {});
    },

    /** 원터치 (REQ-109) — 숙련 100% 초식만, 잔여 시퀀스를 생략하고 그 자리에서 발동한다. */
    tap(style) {
      if (masteryOf(style) < BALANCE.masteryFullPct) return null;
      if (!candidates.includes(style)) return null;
      return fire(style, true);
    },
  };
}
