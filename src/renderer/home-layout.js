'use strict';

// Reserve space for the live, draggable pet without changing its saved position.
(() => {
  const home = document.getElementById('home-view');
  if (!home) return;
  let pet;
  const sizes = new ResizeObserver(sync);
  const changes = new MutationObserver(sync);
  const set = (name, value) => {
    if (home.style.getPropertyValue(name) !== value) home.style.setProperty(name, value);
  };
  function sync() {
    if (home.hidden) return;
    const current = document.getElementById('gaia-pet');
    if (current && current !== pet) {
      if (pet) sizes.unobserve(pet);
      pet = current;
      sizes.observe(pet);
      changes.observe(pet, { attributes: true, attributeFilter: ['hidden'] });
    }
    const rect = pet && !pet.hidden ? pet.getBoundingClientRect() : null;
    set('--home-pet-space', rect ? `${Math.ceil(rect.width) + 24}px` : '0px');
    set('--home-pet-height', rect ? `${Math.ceil(rect.height) + 24}px` : '0px');
  }
  sizes.observe(home);
  changes.observe(home, { attributes: true, attributeFilter: ['hidden'] });
  changes.observe(document.body, { childList: true });
  sync();
})();
