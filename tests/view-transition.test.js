'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const source = app.slice(app.indexOf('let viewEntryAnimation ='), app.indexOf('function visibleViewName('));
const contentSelectors = { home: '.study-layout', library: '.library-body', ai: '.ai-center-layout', stats: '.stats-scroll', reader: '#reader-body' };
const routes = Object.keys(contentSelectors).flatMap((from) => Object.entries(contentSelectors)
  .filter(([to]) => to !== from).map(([to, selector]) => [from, to, selector]));

function harness(from = 'home', reducedMotion = false) {
  const animations = [];
  const musicViews = [];
  const petViews = [];
  const views = Object.fromEntries(['splash', 'home', 'library', 'ai', 'reader', 'stats'].map((name) => {
    const classes = new Set();
    const content = { animate(keyframes, options) {
      const animation = { keyframes, options, target: this, playState: 'running',
        cancel() { this.playState = 'idle'; }, finish() { this.onfinish(); } };
      animations.push(animation);
      return animation;
    } };
    return [name, { hidden: name !== from, classList: { remove: (c) => classes.delete(c), add: (c) => classes.add(c), contains: (c) => classes.has(c) },
      content, querySelector(selector) { this.selector = selector; return content; } }];
  }));
  const context = vm.createContext({ views, $: () => ({}), stopHeldPageKey() {},
    setTocMode() {}, TOC_MODES: { CLOSED: 'closed' }, clearFx() {}, renderReadingStats() {}, updateTocEdgeAvailability() {}, updatePetUI() {},
    applyThemeClass() { views.reader.themedWhileHidden = views.reader.hidden; },
    window: { matchMedia: () => ({ matches: reducedMotion }),
      GaiaBgm: { positionBgm: (view) => musicViews.push(view) },
      GaiaPet: { init: () => Promise.resolve(), setView: (view) => petViews.push(view) } } });
  vm.runInContext(source, context);
  return { context, views, animations, musicViews, petViews, show: (name) => context.showView(name),
    active: () => vm.runInContext('viewEntryAnimation', context) };
}

for (const [from, to, selector] of routes) {
  test(`${from} → ${to}: switch immediately with an opaque root and a short content entrance`, async () => {
    const h = harness(from);
    h.show(to);
    assert.deepEqual(Object.keys(h.views).filter((name) => !h.views[name].hidden), [to]);
    assert.equal(h.views[to].classList.contains('view-fade'), false, 'root must not fade against the light body');
    assert.equal(h.views[to].selector, selector, 'animation excludes the music header and independent pet');
    if (to === 'reader') assert.equal(h.views.reader.themedWhileHidden, true, 'apply reading colors before showing the view');
    assert.equal(h.animations.length, 1);
    const animation = h.animations[0];
    assert.equal(animation.target, h.views[to].content);
    assert.equal(animation.options.duration, 200);
    assert.equal(animation.options.delay, undefined, 'no delayed navigation');
    assert.deepEqual(JSON.parse(JSON.stringify(animation.keyframes)), [
      { opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' },
    ]);
    assert.deepEqual(h.musicViews, [to]);
    await Promise.resolve();
    assert.deepEqual(h.petViews, [to]);
  });
}

test('rapid navigation cancels the previous entrance without queuing or delaying the latest page', () => {
  const h = harness();
  for (const name of ['library', 'reader', 'stats', 'reader', 'ai', 'reader', 'library', 'home']) {
    const previous = h.active();
    h.show(name);
    if (previous) assert.equal(previous.playState, 'idle');
    assert.equal(h.views[name].hidden, false);
    assert.equal(h.animations.filter((a) => a.playState === 'running').length, 1);
  }
  const current = h.active();
  h.animations[0].finish();
  assert.equal(h.active(), current, 'a stale finish event must not clear the latest entrance');
  current.finish();
  assert.equal(current.playState, 'idle');
  assert.equal(h.active(), null, 'completed effects must release their target');
});

test('entering the reader also cancels the old effect and never restores a whole-page fade', () => {
  const h = harness();
  h.show('library');
  const entrance = h.active();
  h.show('reader');
  assert.equal(entrance.playState, 'idle');
  assert.equal(h.active().target, h.views.reader.content);
  assert.equal(h.views.reader.hidden, false);
  assert.equal(h.views.reader.classList.contains('view-fade'), false);
});

test('startup and repeated navigation do not restart content animations or fade the background', () => {
  for (const [from, to] of [['splash', 'home'], ...Object.keys(contentSelectors).map((name) => [name, name])]) {
    const h = harness(from);
    h.show(to);
    assert.equal(h.views[to].classList.contains('view-fade'), false, `${from} → ${to}`);
    assert.equal(h.animations.length, 0);
  }
});

test('reduced motion keeps every route opaque and immediately usable without an entrance animation', () => {
  for (const [from, to] of routes) {
    const h = harness(from, true);
    h.show(to);
    assert.equal(h.views[to].hidden, false);
    assert.equal(h.views[to].classList.contains('view-fade'), false);
    assert.equal(h.animations.length, 0);
  }
});

test('splash fades onto the real home instead of an empty body, then releases navigation', () => {
  const h = harness('splash');
  let finish;
  let resolved = false;
  h.context.setTimeout = (fn) => { finish = fn; };
  h.context.state = { resolveHome() { resolved = true; } };
  vm.runInContext(app.slice(app.indexOf('function finishSplash('), app.indexOf('function migrateHabitsFromLastBook(')), h.context);
  h.context.finishSplash();
  assert.equal(h.views.splash.hidden, false);
  assert.equal(h.views.home.hidden, false, 'home must already fill the area under the fading splash');
  assert.equal(resolved, false);
  finish();
  assert.equal(h.views.splash.hidden, true);
  assert.equal(h.views.home.hidden, false);
  assert.equal(resolved, true);
  assert.equal(h.animations.length, 0, 'do not replay entry once the splash has faded');
});

test('no legacy whole-view fade remains and the app backing surface is graphite', () => {
  for (const name of ['app.js', 'styles.css', 'home.css', 'non-reading.css']) {
    const text = fs.readFileSync(path.join(__dirname, '../src/renderer', name), 'utf8');
    assert.doesNotMatch(text, /view-fade|@keyframes fadeIn\b/, name);
  }
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer/styles.css'), 'utf8');
  assert.match(css, /body\s*\{[^}]*background:\s*#111419/);
  assert.match(css, /#reader-view\s*\{[^}]*background:\s*var\(--reader-bg\)/, 'actual reading colors stay local');
});
