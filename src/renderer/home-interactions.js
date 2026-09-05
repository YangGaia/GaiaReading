'use strict';

// Presentation only: native clicks, keyboard activation and navigation stay in app.js.
(() => {
  const home = document.getElementById('home-view');
  if (!home) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const buttons = [...home.querySelectorAll('.action-button')];
  const reveals = new Set();
  let pendingLight = null;
  let frame = 0;
  let wasVisible = false;

  function clearLight() {
    cancelAnimationFrame(frame);
    frame = 0;
    pendingLight = null;
    for (const button of buttons) {
      button.style.removeProperty('--hover-x');
      button.style.removeProperty('--hover-y');
    }
  }

  function queueLight(event) {
    if (reducedMotion.matches || event.pointerType === 'touch' || event.buttons) return;
    pendingLight = { button: event.currentTarget, x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pendingLight || home.hidden || document.hidden) return;
      const { button, x, y } = pendingLight;
      const rect = button.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const percent = (value) => Math.max(0, Math.min(100, value)).toFixed(2) + '%';
      button.style.setProperty('--hover-x', percent((x - rect.left) / rect.width * 100));
      button.style.setProperty('--hover-y', percent((y - rect.top) / rect.height * 100));
      pendingLight = null;
    });
  }

  function cancelReveals() {
    for (const animation of reveals) animation.cancel();
    reveals.clear();
  }

  function syncVisibility() {
    const visible = !home.hidden && !document.hidden;
    if (!visible || reducedMotion.matches) { cancelReveals(); clearLight(); }
    if (visible && !wasVisible && !reducedMotion.matches) {
      // Only opacity changes; text and artwork are always drawn at their final size.
      ['#home-title', '.copy-rule', '.primary-action', '.secondary-actions'].forEach((selector, index) => {
        const target = home.querySelector(selector);
        if (!target) return;
        const animation = target.animate([{ opacity: .6 }, { opacity: 1 }], {
          duration: 340, delay: index * 45, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards',
        });
        animation.id = 'home-entry-' + index;
        reveals.add(animation);
        animation.onfinish = () => { reveals.delete(animation); animation.cancel(); };
      });
    }
    wasVisible = visible;
  }

  for (const button of buttons) {
    button.addEventListener('pointermove', queueLight);
    button.addEventListener('pointerleave', clearLight);
    button.addEventListener('pointercancel', clearLight);
    button.addEventListener('blur', clearLight);
  }
  new MutationObserver(syncVisibility).observe(home, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', syncVisibility);
  reducedMotion.addEventListener('change', syncVisibility);
  syncVisibility();
})();
