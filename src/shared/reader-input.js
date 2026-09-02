'use strict';

/**
 * 阅读输入处理（纯逻辑，无 DOM 依赖，可单测）：
 * - normalizeWheelDelta：把各种 deltaMode 归一到像素位移
 * - createWheelGate：滚轮翻页门控（累计阈值 + 冷却），决定向上/向下翻页
 * - PDF 缩放与页内滚动判断
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaReaderInput = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function normalizeWheelDelta(ev) {
    const deltaY = ev && typeof ev.deltaY === 'number' ? ev.deltaY : 0;
    const mode = ev && ev.deltaMode;
    if (mode === 1) return deltaY * 16;  // DOM_DELTA_LINE
    if (mode === 2) return deltaY * 100; // DOM_DELTA_PAGE
    return deltaY;                        // DOM_DELTA_PIXEL
  }

  function createWheelGate(opts) {
    const threshold = (opts && typeof opts.threshold === 'number') ? opts.threshold : 60;
    const cooldown = (opts && typeof opts.cooldown === 'number') ? opts.cooldown : 250;
    let accum = 0;
    let last = null;

    function reset() {
      accum = 0;
      last = null;
    }

    function feed(delta, now) {
      if (!delta || !Number.isFinite(delta)) return null;
      // 方向反转时清零，避免一次手势反复横跳
      if (accum !== 0 && Math.sign(accum) !== Math.sign(delta)) accum = 0;
      accum += delta;
      if (Math.abs(accum) >= threshold) {
        if (last === null || now - last >= cooldown) {
          last = now;
          const dir = accum > 0 ? 'next' : 'prev';
          accum = 0;
          return dir;
        }
      }
      return null;
    }

    return { feed, reset };
  }

  function clampPdfZoom(value) {
    const zoom = Number(value);
    if (!Number.isFinite(zoom)) return 1;
    return Math.round(Math.min(2, Math.max(0.6, zoom)) * 100) / 100;
  }

  function nextPdfZoom(current, wheelDelta, step) {
    const delta = Number(wheelDelta);
    const amount = Number(step);
    if (!Number.isFinite(delta) || delta === 0) return clampPdfZoom(current);
    const increment = Number.isFinite(amount) && amount > 0
      ? amount
      : Math.min(0.2, Math.max(0.02, Math.abs(delta) / 1200));
    return clampPdfZoom((Number(current) || 1) + (delta < 0 ? increment : -increment));
  }

  function shouldScrollPdfPage(viewport, wheelDelta) {
    const delta = Number(wheelDelta);
    if (!Number.isFinite(delta) || delta === 0) return false;
    const input = viewport && typeof viewport === 'object' ? viewport : {};
    const scrollTop = Math.max(0, Number(input.scrollTop) || 0);
    const scrollHeight = Math.max(0, Number(input.scrollHeight) || 0);
    const clientHeight = Math.max(0, Number(input.clientHeight) || 0);
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const edge = 1;
    if (maxScroll <= edge) return false;
    return delta < 0 ? scrollTop > edge : scrollTop < maxScroll - edge;
  }

  return { normalizeWheelDelta, createWheelGate, clampPdfZoom, nextPdfZoom, shouldScrollPdfPage };
});
