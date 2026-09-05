'use strict';

// Runs against the real renderer with non-reading-smoke's disposable userData.
module.exports = async ({ win, report, check, capture }) => {
  const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const settle = () => evaluate(() => __uiSmoke.wait(350));
  const resize = async (width, height, zoom = 1) => {
    win.setContentSize(width, height);
    win.webContents.setZoomFactor(zoom);
    await settle();
  };
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    // Chromium's native button activation consumes the Enter character event.
    if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await settle();
  };
  const minimum = win.getMinimumSize();
  win.setMinimumSize(420, 400);
  await evaluate(async () => {
    window.__statsSaved = __gaiaDebug.getReadingStats();
    __gaiaDebug.openReadingStats('library');
    await document.getElementById('stats-alice').decode();
    await document.fonts.ready;
  });
  try {
    check('journal fonts load locally and the dial has 60 vector ticks with 12 major marks', await evaluate(async () => {
      const faces = await document.fonts.load('300 16px "Gaia Home Noto"', '阅读');
      const display = await document.fonts.load('500 24px "Gaia Wordmark"');
      return faces.length > 0 && display.length > 0 && faces.every((face) => face.status === 'loaded') &&
        document.querySelectorAll('#stats-clock-ticks line').length === 60 && document.querySelectorAll('#stats-clock-ticks .major').length === 12;
    }));
    for (const [width, height, zoom] of [[800, 600, 1], [1100, 760, 1], [1600, 1000, 1], [1920, 1080, 1], [2560, 1080, 1], [1440, 600, 1], [800, 1000, 1], [560, 760, 1], [420, 700, 1], [800, 600, 1.25]]) {
      await resize(width, height, zoom);
      report.checks.push(await evaluate(() => __uiSmoke.layout('stats')));
      report.checks.push(await evaluate(() => __uiSmoke.controls('stats')));
      report.checks.push(await evaluate(() => __uiSmoke.contrast('stats')));
      check(`journal clock and composition fit ${width}x${height} @${zoom}`, await evaluate(() => {
        const root = document.getElementById('stats-view');
        const scroller = root.querySelector('.stats-scroll');
        scroller.scrollTop = 0;
        const rect = (selector) => root.querySelector(selector).getBoundingClientRect();
        const dial = rect('.stats-clock');
        const copy = rect('.stats-hero');
        const alice = rect('.stats-alice');
        const caption = rect('.stats-companion-copy');
        const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const actual = [dial, copy, alice, caption];
        const fontsFit = [...root.querySelectorAll('.stats-today, .stats-goal-options button, .stats-date')].every((el) => el.scrollWidth <= el.clientWidth + 1);
        const nativePaint = ['.stats-scroll', '.stats-overview', '.stats-clock', '.stats-clock-svg'].every((selector) => {
          const style = getComputedStyle(root.querySelector(selector));
          return style.transform === 'none' && style.filter === 'none';
        });
        const capsule = document.getElementById('bgm-capsule');
        const musicWidth = capsule.getBoundingClientRect().width;
        const overviewFits = innerWidth < 800 || innerHeight < 600 || rect('.stats-activity').bottom <= innerHeight;
        return Math.abs(dial.width - dial.height) < .2 && dial.width >= 170 &&
          actual.every((r) => r.left >= 0 && r.right <= innerWidth) && !overlap(dial, copy) && !overlap(alice, copy) && !overlap(alice, caption) &&
          scroller.scrollWidth <= scroller.clientWidth + 1 && fontsFit && nativePaint && overviewFits &&
          Math.abs(musicWidth - 336 * Math.min(innerWidth / 1100, innerHeight / 760)) < 1;
      }));
      await capture(win, `stats-design-${width}x${height}-${zoom}`);
    }
    await resize(1100, 760);
    const palettes = [];
    for (const theme of ['light', 'dark', 'eye']) {
      await evaluate(async (name) => { await __gaiaDebug.setTheme(name); }, theme);
      palettes.push(await evaluate(() => ['#stats-view', '.stats-clock', '.stats-today', '[data-goal-minutes="30"]'].map((selector) => {
        const s = getComputedStyle(document.querySelector(selector));
        return [s.color, s.backgroundColor, s.backgroundImage, s.fontFamily, s.borderColor];
      })));
    }
    check('reading themes never recolor the clock, journal or goal controls', JSON.stringify(palettes[0]) === JSON.stringify(palettes[1]) && JSON.stringify(palettes[1]) === JSON.stringify(palettes[2]));
    await evaluate(async () => { await __gaiaDebug.setTheme('light'); });

    check('visiting the journal does not accumulate reading time or replace focused content', await evaluate(async () => {
      const before = JSON.stringify(__gaiaDebug.getReadingStats());
      const time = document.getElementById('stats-today').textContent;
      const day = document.querySelector('.stats-day');
      const book = document.querySelector('.stats-finished-book');
      day.focus();
      await __uiSmoke.wait(1200);
      __gaiaDebug.tickReadingStats(Date.now() + 5000, false);
      return JSON.stringify(__gaiaDebug.getReadingStats()) === before && document.getElementById('stats-today').textContent === time &&
        document.activeElement === day && day === document.querySelector('.stats-day') && book === document.querySelector('.stats-finished-book');
    }));
    win.webContents.focus();
    await evaluate(() => document.querySelector('[data-goal-minutes="30"]').focus());
    await key('Tab');
    await key('Enter');
    check('keyboard goal selection persists and retains visible focus with pressed semantics', await evaluate(async () => {
      const button = document.querySelector('[data-goal-minutes="45"]');
      return document.activeElement === button && button.matches(':focus-visible') && parseFloat(getComputedStyle(button).outlineWidth) >= 2 &&
        button.getAttribute('aria-pressed') === 'true' && (await window.api.stateGet('readingStats')).goalMinutes === 45;
    }));
    await capture(win, 'stats-goal-keyboard-focus');
    await evaluate(() => document.querySelector('.stats-day').focus());
    await key('Tab');
    await key('Tab', ['shift']);
    check('weekly reading detail is visible on keyboard focus and reports exact seconds', await evaluate(() => {
      const day = document.querySelector('.stats-day');
      return document.activeElement === day && day.matches(':focus-visible') && getComputedStyle(day.querySelector('.stats-day-detail')).visibility === 'visible' && /秒/.test(day.getAttribute('aria-label'));
    }));
    await capture(win, 'stats-week-keyboard-detail');

    const goalBounds = await evaluate(() => document.querySelector('[data-goal-minutes="60"]').getBoundingClientRect().toJSON());
    const point = { x: Math.round(goalBounds.left + goalBounds.width / 2), y: Math.round(goalBounds.top + goalBounds.height / 2) };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    await settle();
    check('goal hover has a subtle lift without changing its size', await evaluate((before) => {
      const r = document.querySelector('[data-goal-minutes="60"]').getBoundingClientRect();
      return Math.abs(r.top - before.top + 2) < .2 && r.width === before.width;
    }, goalBounds));
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    await settle();
    check('pressing a goal depresses the surface and keeps the target reachable', await evaluate((before) => {
      const button = document.querySelector('[data-goal-minutes="60"]');
      return Math.abs(button.getBoundingClientRect().top - before.top - 1) < .2 && getComputedStyle(button).boxShadow.includes('inset');
    }, goalBounds));
    await capture(win, 'stats-goal-pressed');
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });

    for (const [width, height] of [[800, 600], [1100, 760], [1600, 1000]]) {
      await resize(width, height);
      await evaluate(async () => {
        const scroller = document.querySelector('.stats-scroll');
        scroller.scrollTop = scroller.scrollHeight;
        await Promise.all([...document.querySelectorAll('.stats-finished-cover[src]')].map((img) => img.decode()));
      });
      check(`archive dates remain on one line at ${width}x${height}`, await evaluate(() =>
        [...document.querySelectorAll('.stats-finished-date')].every((el) => {
          const text = document.createRange();
          text.selectNodeContents(el);
          return el.dateTime && el.scrollWidth <= el.clientWidth + 1 && text.getClientRects().length === 1;
        })
      ));
      await capture(win, `stats-archive-${width}x${height}`, undefined, false);
    }
    await resize(1100, 760);
    await evaluate(() => document.querySelector('.stats-finished-book').focus());
    await key('Tab');
    await key('Tab', ['shift']);
    check('finished books expose full titles and dates on stable keyboard focus', await evaluate(async () => {
      const book = document.activeElement;
      const before = book.getBoundingClientRect();
      __gaiaDebug.renderReadingStats();
      await __uiSmoke.wait(1100);
      return book.classList.contains('stats-finished-book') && book === document.activeElement && book.matches(':focus-visible') &&
        parseFloat(getComputedStyle(book).outlineWidth) >= 2 && /读完于/.test(book.getAttribute('aria-label')) &&
        book.querySelector('time').dateTime && before.top >= 0 && before.bottom <= innerHeight;
    }));
    await capture(win, 'stats-archive-keyboard-focus', undefined, false);
    await evaluate(() => { document.activeElement.blur(); document.querySelector('.stats-scroll').scrollTop = 0; });

    await evaluate(() => document.getElementById('stats-alice').click());
    await evaluate(() => document.getElementById('stats-alice').click());
    check('Alice retains her full-image yawn interaction', await evaluate(() => document.getElementById('stats-alice').classList.contains('stats-alice-yawn')));
    await evaluate(() => document.getElementById('stats-alice').click());
    check('Alice can sleep and wake', await evaluate(() => {
      const asleep = !document.getElementById('stats-alice-zzz').hidden;
      document.getElementById('stats-alice').click();
      return asleep && document.getElementById('stats-alice-zzz').hidden;
    }));

    for (const [name, ms, expected] of [['empty', 0, '00:00:00'], ['under-goal', 7 * 60000 + 23000, '00:07:23'], ['complete', 30 * 60000, '00:30:00'], ['over-hour', 5912000, '01:38:32']]) {
      await evaluate((ms, empty) => {
        const today = window.GaiaReadingStats.dateKey(Date.now());
        state.readingStats = { ...window.__statsSaved, goalMinutes: 30, days: { [today]: { ms, byBook: {} } }, completedBooks: empty ? {} : window.__statsSaved.completedBooks };
        __gaiaDebug.renderReadingStats();
      }, ms, name === 'empty');
      await settle();
      check(`clock state ${name} renders actual duration`, await evaluate((expected, ms) => {
        const clock = window.GaiaStatsPresentation.clockReading(ms, 1800000);
        return document.getElementById('stats-today').textContent === expected &&
          document.getElementById('stats-clock-hour').getAttribute('transform') === `rotate(${clock.hourAngle} 180 180)` &&
          document.getElementById('stats-clock-minute').getAttribute('transform') === `rotate(${clock.minuteAngle} 180 180)` &&
          document.getElementById('stats-ring-percent').textContent === clock.percent + '%';
      }, expected, ms));
      await capture(win, 'stats-state-' + name);
    }

    win.webContents.debugger.attach('1.3');
    try {
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      check('reduced motion stops decoration and control transitions', await evaluate(() =>
        getComputedStyle(document.getElementById('stats-alice')).animationName === 'none' &&
        getComputedStyle(document.getElementById('stats-clock-progress')).transitionDuration === '0s' &&
        getComputedStyle(document.querySelector('[data-goal-minutes]')).transitionDuration === '0s'
      ));
    } finally {
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      win.webContents.debugger.detach();
    }
  } finally {
    await evaluate(async () => {
      state.readingStats = window.__statsSaved;
      await window.api.stateSet('readingStats', state.readingStats);
      delete window.__statsSaved;
      __gaiaDebug.renderReadingStats();
      __gaiaDebug.closeReadingStats();
    });
    win.setMinimumSize(...minimum);
    await resize(1100, 760);
  }
};
