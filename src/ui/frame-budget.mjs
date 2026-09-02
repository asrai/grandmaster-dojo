// 프레임 예산 계측 (REQ-914·915) — 프레임 간격을 장면별로 모아 p95 와 유실 프레임을 낸다.
// 문서를 모르므로 화면 없이도 산식을 검사할 수 있고, 그것이 이 모듈이 `app.mjs` 의 rAF 루프와
// 갈라져 있는 이유다: 루프는 브라우저가 돌리고, 무엇을 어떻게 세는지는 여기가 진다.

/** 유실 프레임의 경계 — 60fps 한 프레임(16.7ms)의 1.5배를 넘으면 그 사이 한 장을 흘린 것이다. */
const DROP_MS = 25;

/**
 * @param {object} [p]
 * @param {number} [p.minSamples] p95 를 말할 수 있는 최소 표본 — 이보다 적으면 순위 통계가
 *   한두 프레임의 튐을 그대로 대표값으로 내놓는다
 */
export function createFrameBudget({ minSamples = 20 } = {}) {
  /** 장면 → 그 장면에서 잰 프레임 간격(ms). 장면은 프레임마다 갈리므로 표본도 함께 갈린다. */
  const scenes = new Map();

  const bucket = (scene) => {
    let list = scenes.get(scene);
    if (!list) { list = []; scenes.set(scene, list); }
    return list;
  };

  return {
    /**
     * 프레임 하나를 그 장면의 표본으로 넣는다.
     * @param {string} scene `FRAME_SCENES` 의 값
     * @param {number} deltaMs 직전 프레임과의 간격
     */
    sample(scene, deltaMs) {
      // 배경 탭 복귀·첫 프레임은 간격이 초 단위로 튄다 — 렌더 비용이 아니라 정지 시간이다.
      if (!(deltaMs > 0) || deltaMs > 1000) return;
      bucket(scene).push(deltaMs);
    },

    /** 표본이 쌓인 장면 — 재지 않은 장면을 0 으로 보고하면 「빠르다」는 거짓 신호가 된다. */
    scenes: () => [...scenes.keys()].filter((scene) => scenes.get(scene).length >= minSamples),

    /**
     * 그 장면의 p95 프레임 시간 — 판정 프레임의 최악값이 juice 강도의 근거다 (REQ-915).
     * @returns {?number} 표본이 모자라면 null
     */
    p95(scene) {
      const list = scenes.get(scene) ?? [];
      if (list.length < minSamples) return null;
      const sorted = [...list].sort((a, b) => a - b);
      // 순위는 0-기반 인덱스로 접는다 — 표본 20개의 95 백분위가 20번째(범위 밖)가 되지 않게.
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
    },

    /** 그 장면에서 흘린 프레임 수 — p95 만으로는 「가끔 크게 끊긴다」가 평균에 묻힌다. */
    dropped: (scene) => (scenes.get(scene) ?? []).filter((ms) => ms > DROP_MS).length,

    /**
     * 최근 프레임률 — 패럴랙스 활성 임계의 입력이다 (REQ-914). 누적 전체가 아니라 **최근**을
     * 보는 것이 계약이다: 세션 초반의 로딩 프레임이 남은 시간 내내 임계를 끌어내리면 안 된다.
     * @param {string} scene
     * @param {number} [sampleWindow] 볼 프레임 수
     * @returns {?number} 표본이 모자라면 null
     */
    fps(scene, sampleWindow = 60) {
      const list = scenes.get(scene) ?? [];
      if (list.length < minSamples) return null;
      const recent = list.slice(-sampleWindow);
      const mean = recent.reduce((sum, ms) => sum + ms, 0) / recent.length;
      return mean > 0 ? 1000 / mean : null;
    },

    /** 화면을 떠날 때 원장을 비운다 — 화면별 표본이 다음 화면으로 섞이면 축이 무너진다. */
    reset() { scenes.clear(); },
  };
}
