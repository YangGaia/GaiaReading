'use strict';

// Scale layout lengths so text and vectors are painted at their final size.
(() => {
  const home = document.getElementById('home-view');
  const surface = home?.querySelector('.home-surface');
  if (!surface) return;

  function sync() {
    if (home.hidden || !home.clientWidth || !home.clientHeight) return;
    // Keep fractional CSS pixels under Electron zoom / display scaling.
    const viewport = home.getBoundingClientRect();
    const scale = Math.min(viewport.width / 1100, viewport.height / 760);
    const pixelRatio = window.devicePixelRatio || 1;
    const pixelAligned = (value) => Math.round(value * pixelRatio) / pixelRatio;
    const values = {
      '--home-unit': `${scale}px`,
      '--home-left': `${pixelAligned((viewport.width - 1100 * scale) / 2)}px`,
      '--home-top': `${pixelAligned((viewport.height - 760 * scale) / 2)}px`,
    };
    for (const [name, value] of Object.entries(values)) {
      if (home.style.getPropertyValue(name) !== value) home.style.setProperty(name, value);
    }
  }

  new ResizeObserver(sync).observe(home);
  new MutationObserver(sync).observe(home, { attributes: true, attributeFilter: ['hidden'] });
  sync();
})();
