'use strict';

/**
 * 阅读目录面板状态机（纯逻辑，无 DOM 依赖，可单测）。
 * manual：由按钮打开，点击目录项或外部区域后关闭。
 * hover：由阅读区左缘触发，点击目录项后保持，离开目录后关闭。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaTocPanel = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MODES = Object.freeze({ CLOSED: 'closed', MANUAL: 'manual', HOVER: 'hover' });

  function normalize(mode) {
    return mode === MODES.MANUAL || mode === MODES.HOVER ? mode : MODES.CLOSED;
  }

  function toggleManual(mode) {
    return normalize(mode) === MODES.MANUAL ? MODES.CLOSED : MODES.MANUAL;
  }

  function enterEdge(mode, blocked) {
    const current = normalize(mode);
    if (blocked) return current;
    return current === MODES.CLOSED ? MODES.HOVER : current;
  }

  function leaveHover(mode) {
    return normalize(mode) === MODES.HOVER ? MODES.CLOSED : normalize(mode);
  }

  function activateItem(mode) {
    return normalize(mode) === MODES.MANUAL ? MODES.CLOSED : normalize(mode);
  }

  function dismissManual(mode) {
    return normalize(mode) === MODES.MANUAL ? MODES.CLOSED : normalize(mode);
  }

  return { MODES, normalize, toggleManual, enterEdge, leaveHover, activateItem, dismissManual };
});
