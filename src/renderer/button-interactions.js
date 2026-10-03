'use strict';

// Delegation also covers menus and tool buttons created after startup.
// This only paints a light source; native pointer and keyboard actions stay intact.
(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  // Match the controls excluded from glass-buttons.css, including their children.
  const originalControls = '#reader-content, #bgm-capsule, #pdf-zoom-controls, #drawer-reading, #btn-home-settings, #btn-settings, #btn-settings-reader, .drawer-switch, .tool-close, [role="switch"], .highlight-dot, .gaia-pet-console, #bookmarks-panel button:not(.collection-tabs button), #annotations-panel button:not(.collection-tabs button), #ai-appearance-popover, #note-editor-overlay, #selection-toolbar, #stats-view button:not(#stats-goal-options *), #ai-view button:not(.ai-config-actions *), [hidden], [inert]';
  let activeButton = null;
  let pendingLight = null;
  let frame = 0;

  function clearLight() {
    cancelAnimationFrame(frame);
    frame = 0;
    pendingLight = null;
    if (activeButton) {
      activeButton.style.removeProperty('--hover-x');
      activeButton.style.removeProperty('--hover-y');
      activeButton = null;
    }
  }

  function queueLight(event) {
    if (reducedMotion.matches || document.hidden || event.pointerType === 'touch' || event.buttons) {
      clearLight();
      return;
    }
    const button = event.target.closest?.('button');
    if (!button || button.disabled || button.closest(originalControls)) {
      clearLight();
      return;
    }
    if (button !== activeButton) clearLight();
    activeButton = button;
    pendingLight = { button, x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const pending = pendingLight;
      pendingLight = null;
      if (!pending) return;
      const { button: target, x, y } = pending;
      if (!target.isConnected || target.disabled || document.hidden || reducedMotion.matches || target.closest(originalControls)) {
        clearLight();
        return;
      }
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) { clearLight(); return; }
      const percent = (value) => Math.max(0, Math.min(100, value)).toFixed(2) + '%';
      target.style.setProperty('--hover-x', percent((x - rect.left) / rect.width * 100));
      target.style.setProperty('--hover-y', percent((y - rect.top) / rect.height * 100));
    });
  }

  document.addEventListener('pointermove', queueLight, { passive: true });
  document.addEventListener('pointerout', (event) => {
    if (activeButton && !activeButton.contains(event.relatedTarget)) clearLight();
  }, { passive: true });
  document.addEventListener('pointercancel', clearLight, { passive: true });
  document.addEventListener('focusout', clearLight);
  document.addEventListener('visibilitychange', clearLight);
  window.addEventListener('blur', clearLight);
  reducedMotion.addEventListener('change', clearLight);
})();
