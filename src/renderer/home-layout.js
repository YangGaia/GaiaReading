'use strict';

// Fit the entire approved composition; no element uses a separate breakpoint.
(() => {
  const home = document.getElementById('home-view');
  const surface = home?.querySelector('.home-surface');
  if (!surface) return;

  function sync() {
    if (home.hidden || !home.clientWidth || !home.clientHeight) return;
    // Keep fractional CSS pixels under Electron zoom / display scaling.
    const viewport = home.getBoundingClientRect();
    const scale = Math.min(viewport.width / surface.offsetWidth, viewport.height / surface.offsetHeight);
    const value = String(scale);
    if (home.style.getPropertyValue('--home-scale') === value) return;
    home.style.setProperty('--home-scale', value);
    // The live pet is a body-level overlay and uses this same coordinate frame.
    window.dispatchEvent(new Event('gaia:home-layout'));
  }

  new ResizeObserver(sync).observe(home);
  new MutationObserver(sync).observe(home, { attributes: true, attributeFilter: ['hidden'] });
  sync();
})();
