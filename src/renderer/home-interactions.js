'use strict';

// Presentation only: native clicks, keyboard activation and navigation stay in app.js.
(() => {
  const home = document.getElementById('home-view');
  if (!home) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const reveals = new Set();
  let wasVisible = false;

  function cancelReveals() {
    for (const animation of reveals) animation.cancel();
    reveals.clear();
  }

  function syncVisibility() {
    const visible = !home.hidden && !document.hidden;
    if (!visible || reducedMotion.matches) cancelReveals();
    // Returning from another page uses one short content entrance, without a
    // second staggered reveal extending the navigation animation.
    const entering = home.querySelector('.study-layout').getAnimations().some((animation) => animation.id === 'view-content-enter');
    if (visible && !wasVisible && !reducedMotion.matches && !entering) {
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

  new MutationObserver(syncVisibility).observe(home, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', syncVisibility);
  reducedMotion.addEventListener('change', syncVisibility);
  syncVisibility();
})();
