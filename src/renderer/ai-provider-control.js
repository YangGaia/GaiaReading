(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.GaiaAiProviderControl = api; api.init(root.document); }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  let current = null;

  // Both AI pickers use the visible scroll area for their floating menus.
  function placeMenu(wrapper, list) {
    const win = wrapper.ownerDocument.defaultView;
    const box = wrapper.getBoundingClientRect();
    const scroller = wrapper.closest('.ai-center-scroll');
    const clip = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: win.innerHeight };
    const below = Math.max(0, Math.min(win.innerHeight, clip.bottom) - box.bottom - 12);
    const above = Math.max(0, box.top - Math.max(0, clip.top) - 12);
    const upward = below < 172 && above > below;
    wrapper.classList.toggle('opens-up', upward);
    list.style.maxHeight = Math.max(38, Math.min(216, upward ? above : below)) + 'px';
  }

  function bindMenuDismissal(wrapper, list, close) {
    const doc = wrapper.ownerDocument;
    doc.addEventListener('pointerdown', event => { if (!list.hidden && !wrapper.contains(event.target)) close(false); });
    doc.addEventListener('focusin', event => { if (!list.hidden && !wrapper.contains(event.target)) close(false); });
    doc.addEventListener('scroll', event => { if (!list.hidden && !list.contains(event.target)) close(false); }, true);
    doc.defaultView.addEventListener('resize', () => { if (!list.hidden) close(false); });
  }

  function create(select) {
    if (!select || !select.options.length) return null;
    const doc = select.ownerDocument;
    const win = doc.defaultView;
    const id = select.id;
    const wrapper = doc.createElement('div');
    wrapper.className = 'ai-provider-control';
    const button = doc.createElement('button');
    button.id = id + '-trigger';
    button.type = 'button';
    button.className = 'ai-provider-trigger ai-config-control';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-controls', id + '-options');
    button.setAttribute('aria-expanded', 'false');
    const label = doc.createElement('span');
    label.id = id + '-value';
    label.className = 'ai-provider-value';
    const arrow = doc.createElement('span');
    arrow.className = 'ai-provider-chevron';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(label, arrow);
    const list = doc.createElement('div');
    list.id = id + '-options';
    list.className = 'ai-provider-options';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrapper.append(button, list);
    const sourceLabel = select.labels && select.labels[0];
    let options = [], rows = [], active = -1, prefix = '', typedAt = 0;

    function enabled(index) { return index >= 0 && index < options.length && !options[index].disabled && !options[index].hidden; }
    function selectedIndex() { return options.findIndex(option => option.value === select.value); }
    function close(restoreFocus = false) {
      list.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.removeAttribute('aria-activedescendant');
      prefix = '';
      if (restoreFocus && !button.disabled) button.focus();
    }
    function highlight(index) {
      if (!enabled(index)) return;
      active = index;
      rows.forEach((row, i) => row.classList.toggle('is-active', i === active));
      button.setAttribute('aria-activedescendant', rows[active].id);
      rows[active].scrollIntoView({ block: 'nearest' });
    }
    function edge(last) {
      for (let index = last ? options.length - 1 : 0; index >= 0 && index < options.length; index += last ? -1 : 1) {
        if (enabled(index)) return index;
      }
      return -1;
    }
    function open(index = selectedIndex()) {
      if (select.disabled || edge(false) < 0) return;
      button.disabled = false;
      list.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      placeMenu(wrapper, list);
      highlight(enabled(index) ? index : edge(false));
      button.focus();
    }
    function commit(index) {
      if (!enabled(index) || select.disabled) return;
      const value = options[index].value;
      const changed = select.value !== value;
      select.value = value;
      if (changed) select.dispatchEvent(new win.Event('change', { bubbles: true }));
      sync();
      close(true);
    }
    function sync() {
      close(false);
      options = Array.from(select.options);
      button.disabled = select.disabled;
      const selected = options.find(option => option.value === select.value);
      label.textContent = selected ? selected.label || selected.textContent : '';
      rows = options.map((option, index) => {
        const row = doc.createElement('div');
        row.id = id + '-option-' + index;
        row.className = 'ai-provider-option';
        row.textContent = option.label || option.textContent;
        row.hidden = !!option.hidden;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(option.value === select.value));
        row.setAttribute('aria-disabled', String(!!option.disabled));
        row.addEventListener('pointermove', () => highlight(index));
        row.addEventListener('click', () => commit(index));
        return row;
      });
      list.replaceChildren(...rows);
    }
    function move(direction) {
      if (list.hidden) { open(); return; }
      for (let index = active + direction; index >= 0 && index < options.length; index += direction) {
        if (enabled(index)) { highlight(index); return; }
      }
    }
    button.addEventListener('click', () => list.hidden ? open() : close(true));
    button.addEventListener('keydown', event => {
      if (select.disabled) return;
      if (event.key === 'Tab') { close(false); return; }
      if (event.key === 'Escape') {
        if (list.hidden) return;
        close(true);
      } else if (event.key === 'ArrowDown') move(1);
      else if (event.key === 'ArrowUp') move(-1);
      else if (event.key === 'Home' || event.key === 'End') {
        const index = edge(event.key === 'End');
        if (list.hidden) open(index); else highlight(index);
      } else if (event.key === 'Enter' || event.key === ' ') {
        if (list.hidden) open(); else commit(active);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = Date.now();
        prefix = now - typedAt < 700 ? prefix + event.key.toLocaleLowerCase() : event.key.toLocaleLowerCase();
        typedAt = now;
        if (list.hidden) open();
        const found = options.findIndex((option, index) => enabled(index) && (option.label || option.textContent).trim().toLocaleLowerCase().startsWith(prefix));
        if (found >= 0) highlight(found);
      } else return;
      event.preventDefault();
      event.stopPropagation();
    });
    list.addEventListener('pointerdown', event => event.preventDefault());
    bindMenuDismissal(wrapper, list, close);
    select.addEventListener('change', sync);
    select.addEventListener('input', sync);
    sync();
    select.after(wrapper);
    if (sourceLabel) {
      if (!sourceLabel.id) sourceLabel.id = id + '-label';
      sourceLabel.htmlFor = button.id;
      button.setAttribute('aria-labelledby', sourceLabel.id + ' ' + label.id);
      list.setAttribute('aria-labelledby', sourceLabel.id);
    } else button.setAttribute('aria-labelledby', label.id);
    if (win.MutationObserver) {
      new win.MutationObserver(sync).observe(select, { attributes: true, attributeFilter: ['disabled'], childList: true, subtree: true, characterData: true });
    }
    // Keep the native fallback visible until the replacement is fully wired.
    select.hidden = true;
    return { sync, close, button, list, label };
  }

  function init(doc) {
    if (!current && doc) current = create(doc.getElementById('ai-provider'));
    return current;
  }
  return { create, init, placeMenu, bindMenuDismissal, sync: () => current && current.sync() };
});
