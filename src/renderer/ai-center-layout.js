/* Reserve space for the existing companion without changing its coordinates,
 * scale, dragging, or saved preferences. Only the AI page receives this value. */
(function () {
  'use strict';
  const root = document.getElementById('ai-view');
  if (!root) return;
  const attach = () => {
    const pet = document.getElementById('gaia-pet');
    if (!pet) return false;
    const sync = () => root.style.setProperty('--ai-companion-width', (pet.hidden ? 0 : pet.offsetWidth) + 'px');
    new ResizeObserver(sync).observe(pet);
    new MutationObserver(sync).observe(pet, { attributes: true, attributeFilter: ['hidden'] });
    sync();
    return true;
  };
  if (!attach()) {
    const pending = new MutationObserver(() => { if (attach()) pending.disconnect(); });
    pending.observe(document.body, { childList: true });
  }
})();
