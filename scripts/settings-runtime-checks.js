'use strict';

// Real Electron UI checks; the caller supplies temporary books and userData.
const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async ({ win, report, check, capture, book }) => {
  const evaluate = async (fn, ...args) => {
    const result = await win.webContents.executeJavaScript(`(async () => {
      try { return { value: await (${fn.toString()})(...${JSON.stringify(args)}) }; }
      catch (error) { return { error: error.stack || String(error) }; }
    })()`);
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (fn, ...args) => {
    for (let i = 0; i < 100; i += 1) { if (await evaluate(fn, ...args)) return; await wait(30); }
    throw new Error(`UI state did not settle: ${fn}`);
  };
  const click = async (selector) => {
    const point = await evaluate(async (selector) => {
      const el = document.querySelector(selector);
      el.scrollIntoView({ block: 'nearest' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = el.getBoundingClientRect();
      const x = Math.round((rect.left + rect.right) / 2);
      const y = Math.round((rect.top + rect.bottom) / 2);
      const hit = document.elementFromPoint(x, y);
      if (hit !== el && !el.contains(hit)) throw new Error(`${selector} is covered by ${hit && hit.id}`);
      return { x, y };
    }, selector);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    await wait(45);
  };
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(50);
  };
  await evaluate(() => {
    __gaiaDebug.closeSettings();
    __gaiaDebug.showView('home');
    window.__settingsPaint = (selector) => {
      const root = document.querySelector(selector);
      const props = ['color', 'backgroundColor', 'backgroundImage', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'colorScheme'];
      // Music pulses are time dependent: sample them at the same time in each palette.
      const loops = root.getAnimations({ subtree: true }).filter((animation) => animation.effect.getComputedTiming().iterations === Infinity).map((animation) => [animation, animation.currentTime, animation.playState]);
      for (const [animation] of loops) { animation.pause(); animation.currentTime = 0; }
      try {
        return JSON.stringify([root, ...root.querySelectorAll('*')].map((el) => {
          const style = getComputedStyle(el);
          return props.map((prop) => style[prop]);
        }));
      } finally {
        for (const [animation, time, state] of loops) { animation.currentTime = time; if (state === 'running') animation.play(); }
      }
    };
    window.__checkSettingsLayout = async () => {
      const drawer = document.getElementById('settings-drawer');
      const scroller = drawer.querySelector('.drawer-scroll');
      const head = drawer.querySelector('.drawer-head');
      if (drawer.scrollWidth > drawer.clientWidth || scroller.scrollWidth > scroller.clientWidth) throw new Error('Settings horizontally overflows');
      const headTop = head.getBoundingClientRect().top;
      const controls = [...drawer.querySelectorAll('button, select, input')].filter((el) => !el.disabled && el.getClientRects().length);
      for (const control of controls) {
        control.scrollIntoView({ block: 'nearest' });
        const r = control.getBoundingClientRect();
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight || (hit !== control && !control.contains(hit))) throw new Error(`Unreachable settings control: ${control.id || control.textContent}; rect=${JSON.stringify(r.toJSON())}; viewport=${innerWidth}x${innerHeight}; hit=${hit && (hit.id || hit.className)}`);
        if (getComputedStyle(control).transform !== 'none' || parseFloat(getComputedStyle(control).fontSize) < 12) throw new Error('Settings controls must remain sharp and readable');
      }
      if (head.getBoundingClientRect().top !== headTop) throw new Error('Settings heading moved while scrolling');
      scroller.scrollTop = 0;
      return { width: innerWidth, height: innerHeight, drawerWidth: drawer.getBoundingClientRect().width, controls: controls.length };
    };
    window.__checkSettingsContrast = () => {
      const rgba = (value) => { const parts = value.match(/[\d.]+/g).map(Number); if (parts.length === 3) parts.push(1); return parts; };
      const luminance = (rgb) => rgb.slice(0, 3).map((channel) => { const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
      const ratios = [];
      for (const el of document.querySelectorAll('#settings-drawer h2, #settings-drawer h3, #settings-drawer .drawer-label, #settings-drawer .drawer-hint, #settings-drawer .drawer-about, #settings-drawer small, #settings-drawer strong, #settings-drawer button:not(.drawer-switch), #settings-drawer select, #settings-drawer input')) {
        if (!el.getClientRects().length || el.disabled) continue;
        let background = [255, 255, 255];
        const ancestors = []; for (let node = el; node; node = node.parentElement) ancestors.unshift(node);
        for (const node of ancestors) { const color = rgba(getComputedStyle(node).backgroundColor); background = color.slice(0, 3).map((c, i) => c * color[3] + background[i] * (1 - color[3])); }
        const a = luminance(rgba(getComputedStyle(el).color));
        const b = luminance(background);
        const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        if (ratio < 4.5) throw new Error(`Settings text contrast ${ratio}: ${el.id || el.textContent}`);
        ratios.push(ratio);
      }
      return { textSamples: ratios.length, minimumContrast: Math.min(...ratios) };
    };
  });
  for (const [width, height] of [[800, 600], [1100, 760], [1600, 1000]]) {
    win.setContentSize(width, height);
    await wait(230);
    await click('#btn-home-settings');
    await until(() => __gaiaDebug.isSettingsOpen());
    await wait(250);
    check(`home settings has no reading controls ${width}`, await evaluate(() => document.getElementById('drawer-reading').hidden && document.getElementById('drawer-funcs').hidden));
    await capture(win, `settings-home-${width}x${height}`);
    const layout = await evaluate(() => __checkSettingsLayout());
    check(`settings keeps its own 350px width at ${width}`, layout.drawerWidth === 350);
    report.checks.push({ settingsHome: layout });
    report.checks.push({ settingsContrast: await evaluate(() => __checkSettingsContrast()) });
    check(`settings music retains graphite material and clears the panel ${width}`, await evaluate(() => {
      const music = document.getElementById('bgm-capsule');
      const drawer = document.getElementById('settings-drawer');
      const rect = music.getBoundingClientRect();
      const style = getComputedStyle(music);
      return rect.right <= drawer.getBoundingClientRect().left - 16 && style.backdropFilter === 'none' && style.backgroundColor === 'rgba(28, 34, 43, 0.94)' && Number(style.zIndex) > Number(getComputedStyle(document.getElementById('settings-overlay')).zIndex);
    }));
    await capture(win, `settings-home-${width}x${height}`);
    await click('#btn-settings-close');
  }
  check('settings uses the installed Noto font', await evaluate(async () => {
    await document.fonts.load('14px "Gaia Home Noto"', '设置');
    return document.fonts.check('14px "Gaia Home Noto"', '设置') && getComputedStyle(document.getElementById('settings-drawer')).fontFamily.includes('Gaia Home Noto');
  }));
  win.setContentSize(1100, 760);
  await wait(230);
  await click('#btn-home-settings');
  await until(() => document.activeElement.id === 'btn-settings-close');
  win.webContents.focus();
  await key('Tab', ['shift']);
  await until(() => document.activeElement.id === 'btn-open-ai-center');
  await key('Tab');
  await until(() => document.activeElement.id === 'btn-settings-close');
  check('settings keyboard focus loops and stays visibly outlined', await evaluate(() => getComputedStyle(document.activeElement).outlineStyle === 'solid' && parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2));
  await key('Escape');
  await until(() => !__gaiaDebug.isSettingsOpen() && document.activeElement.id === 'btn-home-settings');
  check('Escape closes settings and restores its launcher focus', true);
  await click('#btn-home-settings');
  await wait(250);
  const petOn = await evaluate(() => window.GaiaPet.getState().on);
  await click('#btn-pet-toggle');
  await until((before) => window.GaiaPet.getState().on !== before, petOn);
  check('pet switch updates its accessible state', await evaluate(() => document.getElementById('btn-pet-toggle').getAttribute('aria-checked') === String(window.GaiaPet.getState().on)));
  await click('#btn-pet-toggle');
  await until((before) => window.GaiaPet.getState().on === before, petOn);
  await evaluate(() => {
    const select = document.getElementById('search-engine');
    select.value = 'custom'; select.dispatchEvent(new Event('change', { bubbles: true }));
    const input = document.getElementById('search-custom-template');
    input.value = 'https://example.com/search?q={query}'; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(async () => (await window.api.stateGet('prefs')).customSearchTemplate === 'https://example.com/search?q={query}');
  check('custom search control remains visible and saves its value', await evaluate(() => !document.getElementById('search-custom-row').hidden && !document.getElementById('search-custom-status').classList.contains('error')));
  report.checks.push({ settingsCustomSearch: await evaluate(() => __checkSettingsLayout()) });
  await capture(win, 'settings-custom-search-1100x760');
  await evaluate(() => { const select = document.getElementById('search-engine'); select.value = 'google'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('#btn-pet-console');
  await until(() => !__gaiaDebug.isSettingsOpen() && !document.querySelector('.gaia-pet-console').hidden);
  check('pet console entry still opens the existing console', true);
  await evaluate(() => window.GaiaPet.closeConsole());
  await click('#btn-home-settings');
  await wait(250);
  await click('#btn-open-ai-center');
  await until(() => __gaiaDebug.getView() === 'ai' && !__gaiaDebug.isSettingsOpen());
  await click('#btn-ai-back');
  await until(() => __gaiaDebug.getView() === 'home');
  check('AI settings entry opens AI center and returns home', true);

  await evaluate(async (book) => { await __gaiaDebug.openBook(book); }, book);
  await until(() => __gaiaDebug.getPaginatorTotal() > 0);
  const paints = new Map();
  const readerPaints = [];
  for (const theme of ['light', 'dark', 'eye']) {
    await evaluate(() => __gaiaDebug.showView('reader'));
    await wait(320);
    await click('#btn-settings-reader');
    await wait(250);
    await evaluate(() => { document.querySelector('.drawer-scroll').scrollTop = 0; });
    await click(`[data-reader-theme="${theme}"]`);
    await until((theme) => __gaiaDebug.getTheme() === theme, theme);
    await until(async (theme) => (await window.api.stateGet('prefs')).theme === theme, theme);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
    await wait(200);
    check(`theme is isolated to reader ${theme}`, await evaluate((theme) => {
      const reader = document.getElementById('reader-view');
      return !document.body.classList.contains('dark') && !document.body.classList.contains('eye') && reader.classList.contains('dark') === (theme === 'dark') && reader.classList.contains('eye') === (theme === 'eye') && document.querySelectorAll('[data-reader-theme][aria-pressed="true"]').length === 1;
    }, theme));
    const panelPaint = await evaluate(() => __settingsPaint('#settings-drawer .drawer-head'));
    if (!paints.has('settings')) paints.set('settings', panelPaint);
    assert.equal(panelPaint, paints.get('settings'), `Settings remains graphite in ${theme}`);
    readerPaints.push(await evaluate(() => getComputedStyle(document.querySelector('#reader-view .topbar')).backgroundColor));
    const bodyPaint = await evaluate(() => {
      const doc = document.querySelector('#reader-content iframe').contentDocument;
      return doc.defaultView.getComputedStyle(doc.body).backgroundColor;
    });
    check(`TXT book pages use ${theme} colors`, bodyPaint === ({ light: 'rgb(255, 253, 247)', dark: 'rgb(0, 0, 0)', eye: 'rgb(245, 236, 217)' })[theme]);
    report.checks.push({ settingsReader: theme, ...await evaluate(() => __checkSettingsLayout()) });
    report.checks.push({ settingsContrast: await evaluate(() => __checkSettingsContrast()) });
    await capture(win, `settings-reader-${theme}-1100x760`);
    await click('#btn-settings-close');
    for (const view of ['home', 'library', 'stats', 'ai']) {
      await evaluate((view) => __gaiaDebug.showView(view), view);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
      await evaluate(async () => {
        // Compare settled paint, never an intermediate FLIP/hover transition.
        for (let i = 0; i < 2; i += 1) {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await Promise.allSettled(document.getAnimations().filter((animation) => animation.effect && animation.effect.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished));
        }
      });
      const paint = await evaluate((view) => __settingsPaint(`#${view}-view`), view);
      if (!paints.has(view)) paints.set(view, paint);
      assert.equal(paint, paints.get(view), `${view} must keep every element's colors under ${theme}`);
      check(`${view} keeps its fixed design under ${theme}`, true);
      await evaluate(() => __gaiaDebug.openSettings());
      check(`reading controls stay hidden in ${view} with book loaded ${theme}`, await evaluate(() => document.getElementById('drawer-reading').hidden && document.getElementById('drawer-funcs').hidden));
      await evaluate(() => __gaiaDebug.closeSettings());
    }
    for (const selector of ['#book-import-overlay', '#note-editor-overlay', '#context-menu']) {
      const paint = await evaluate((selector) => __settingsPaint(selector), selector);
      if (!paints.has(selector)) paints.set(selector, paint);
      assert.equal(paint, paints.get(selector), `Shared overlay colors must remain fixed: ${selector}`);
    }
  }
  check('reader toolbar retains three distinct reading palettes', new Set(readerPaints).size === 3);
  await evaluate(() => { __gaiaDebug.showView('reader'); __gaiaDebug.openSettings(); });
  await wait(260);
  for (const [selector, setting] of [['#btn-font-plus', 'fontSize'], ['#btn-font-minus', 'fontSize'], ['#btn-line-height', 'lineHeight'], ['#btn-margin', 'marginPct'], ['#btn-text-contrast', 'readerTextContrast'], ['#btn-spread', 'spread']]) {
    const before = await evaluate((setting) => __gaiaDebug.getCurrentSettings()[setting], setting);
    await click(selector);
    await until((setting, before) => __gaiaDebug.getCurrentSettings()[setting] !== before, setting, before);
    check(`reading setting still works: ${setting} ${selector}`, true);
  }
  await click('#btn-edge-toc');
  const edgeEnabled = await evaluate(() => document.getElementById('btn-edge-toc').getAttribute('aria-pressed') === 'true');
  await until(async (enabled) => (await window.api.stateGet('prefs')).edgeTocEnabled === enabled, edgeEnabled);
  check('edge TOC toggle still saves its preference', true);
  const page = await evaluate(() => __gaiaDebug.getPaginatorPage());
  await evaluate(() => document.querySelector('[data-reader-theme="eye"]').focus());
  await key('Right');
  check('settings arrow keys do not turn the book page', await evaluate(() => __gaiaDebug.getPaginatorPage()) === page);
  await evaluate(() => document.querySelector('#bgm-capsule .bgm-btn').focus());
  await key('Right');
  check('music focus beside settings does not leak reader shortcuts', await evaluate(() => __gaiaDebug.getPaginatorPage()) === page);
  await key('Escape');
  await until(() => !__gaiaDebug.isSettingsOpen());
  for (const [width, height] of [[800, 600], [1600, 1000]]) {
    win.setContentSize(width, height);
    await wait(250);
    await evaluate(() => __gaiaDebug.openSettings());
    await wait(250);
    report.checks.push({ settingsReader: 'eye', ...await evaluate(() => __checkSettingsLayout()) });
    await capture(win, `settings-reader-eye-${width}x${height}`);
    await evaluate(() => __gaiaDebug.closeSettings());
  }
  await evaluate(async (book) => { await __gaiaDebug.backToLibrary(); await __gaiaDebug.openBook(book); }, book);
  check('reopening a book restores eye preference and selection', await evaluate(() => __gaiaDebug.isReaderEye() && __gaiaDebug.getTheme() === 'eye' && document.querySelector('[data-reader-theme="eye"]').getAttribute('aria-pressed') === 'true'));

  for (const format of ['epub', 'pdf']) {
    await evaluate(async (fixture) => { await __gaiaDebug.backToLibrary(); await __gaiaDebug.openBook(fixture); }, { path: path.resolve(__dirname, `../tests/fixtures/sample.${format}`), format, title: `settings-${format}` });
    await wait(400);
    for (const theme of ['dark', 'eye', 'light']) {
      await evaluate(async (theme) => { await __gaiaDebug.setTheme(theme); }, theme);
      await wait(200);
      check(`${format} reading colors still render in ${theme}`, await evaluate((format, theme) => {
        if (document.body.classList.contains('dark') || document.body.classList.contains('eye')) return false;
        if (format === 'pdf') return document.getElementById('reader-content').classList.contains('pdf-dark') === (theme === 'dark') && !!document.querySelector('#reader-content canvas');
        const style = document.querySelector('#reader-content iframe').contentDocument.getElementById('gaia-reader-style');
        return !!style && (theme === 'light' || style.textContent.includes(theme === 'dark' ? 'background: #000' : 'background: #f5ecd9'));
      }, format, theme));
    }
  }
  win.setContentSize(1100, 760);
  await evaluate(async () => { await __gaiaDebug.backToLibrary(); __gaiaDebug.showView('home'); });
};
