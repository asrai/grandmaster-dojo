// 후보 필터 시퀀스 입력기 (REQ-101~112·712·713). 4방향은 전부 `press()` 한 경로로 들어오고,
// DOM 을 모르므로 화면 없이도 페이스를 재현할 수 있다.

import { isOneTapRank } from '../core.mjs';

/**
 * @param {object} p
 * @param {object[]} p.pool 이 창에서 낼 수 있는 초식 (실전 = 장착분, 수련 = 그 초식 하나)
 * @param {(style: object) => number} p.rankOf 그 초식의 성 — 후보 정렬과 원터치 자격의 입력 (REQ-712·713)
 * @param {number} p.hintDelayMs 잔여 화살표 점등 지연 (실전 0.5s · 수련 0)
 * @param {() => number} p.now 단조 클럭
 * @param {() => number} p.remainingRatio 발동 시점의 창 잔여 비율 `r`
 * @param {(event: string, fields: object) => void} p.log 통합 로그 싱크
 * @param {string} p.screen 이 입력기가 선 화면의 좌표 (`theme.mjs` 의 `SCREEN`) — 되돌리기 분리
 *   배치의 효과가 화면별로만 판독되므로, 좌표 없는 입력기는 그 표본을 익명으로 흘린다 (REQ-829)
 * @param {() => number} [p.exchangeNo] 되돌린 시점의 초 번호 — 초 축이 없는 화면은 0 이다
 */
export function createSequenceInput({
  pool: initialPool, rankOf, hintDelayMs, now, remainingRatio = () => 0, log,
  screen, exchangeNo = () => 0,
}) {
  // 좌표를 빠뜨린 입력기는 `undo_used` 를 익명으로 흘리고, 그 결손은 로그를 읽을 때에야 드러난다.
  if (!screen) throw new Error('입력기에 화면 좌표가 없다');
  let pool = initialPool;
  let buffer = [];
  let ignores = 0;
  let undos = 0;
  let locked = false;
  let hintFrom = now();

  const keyOf = (dirs) => dirs.join('');
  const matching = (dirs) => pool
    .filter((s) => keyOf(s.seq).startsWith(keyOf(dirs)))
    // 결정적 순서: 성 높은 순 → 동률이면 슬롯 순 (REQ-102).
    .sort((a, b) => rankOf(b) - rankOf(a) || pool.indexOf(a) - pool.indexOf(b));

  let candidates = matching(buffer);
  const top = () => candidates[0] ?? null;

  function fire(style, oneTap) {
    // 발동 뒤에도 창은 한 프레임 더 열려 있다 — 그 사이의 키가 후보 0 이라 `ignore_rate` 를 오염시킨다.
    locked = true;
    const r = Math.max(0, Math.min(1, remainingRatio()));
    log('fire', { styleId: style.id, len: style.seq.length, oneTap, r });
    return { style, oneTap, r };
  }

  return {
    get buffer() { return buffer.slice(); },
    get candidates() { return candidates.slice(); },
    get ignores() { return ignores; },
    top,

    /**
     * 응수 창이 열릴 때마다 버퍼·무시 누적·힌트 시계를 함께 되돌린다 (REQ-104).
     * @param {object[]} [nextPool] 그 창의 장착 초식 — 대련 중 자동 장착이 바로 후보에 반영된다.
     */
    arm(nextPool) {
      if (nextPool) pool = nextPool;
      buffer = [];
      ignores = 0;
      locked = false;
      hintFrom = now();
      candidates = matching(buffer);
    },

    /** 점등된 화살표 수 — 원터치 성은 이미 손이 아는 초식이라 지연 없이 전부 보인다 (REQ-712). */
    revealed(style = top()) {
      if (!style) return 0;
      if (isOneTapRank(rankOf(style))) return style.seq.length;
      const lit = now() - hintFrom >= hintDelayMs ? buffer.length + 1 : buffer.length;
      return Math.min(lit, style.seq.length);
    },

    /** @returns {{accepted: boolean, fired: ?object}} */
    press(dir, device) {
      if (locked) return { accepted: false, fired: null };
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
      if (locked) return;
      buffer = [];
      ignores = 0;
      hintFrom = now();
      candidates = matching(buffer);
      undos += 1;
      log('reset', {});
      // 되돌리기를 십자 밖 별개 그룹으로 뺀 것의 효과는 화면·초별 누적으로만 읽힌다 (REQ-829).
      log('undo_used', { screen, count: undos, exchange_no: exchangeNo() });
    },

    /** 원터치 (REQ-713) — 7성 초식만, 잔여 시퀀스를 생략하고 그 자리에서 발동한다. */
    tap(style) {
      if (locked) return null;
      if (!isOneTapRank(rankOf(style))) return null;
      if (!candidates.includes(style)) return null;
      return fire(style, true);
    },
  };
}
