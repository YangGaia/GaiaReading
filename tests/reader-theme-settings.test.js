'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (name) => fs.readFileSync(path.join(__dirname, '../src/renderer', name), 'utf8');
const app = read('app.js');

test('阅读配色只改变阅读容器，并同步三个选择按钮', () => {
  const makeClasses = (...initial) => {
    const values = new Set(initial);
    return { values, remove: (...names) => names.forEach((name) => values.delete(name)), toggle: (name, on) => on ? values.add(name) : values.delete(name) };
  };
  const body = { classList: makeClasses('dark', 'eye', 'unrelated') };
  const reader = { classList: makeClasses('settings-open') };
  const buttons = ['light', 'dark', 'eye'].map((theme) => ({ dataset: { readerTheme: theme }, setAttribute(name, value) { this[name] = value; } }));
  const state = { prefs: { theme: 'light' } };
  const context = vm.createContext({ state, views: { reader }, document: { body, querySelectorAll: () => buttons } });
  vm.runInContext(app.slice(app.indexOf('function applyThemeClass()'), app.indexOf('async function applyTheme(theme)')), context);
  for (const theme of ['dark', 'eye', 'light', 'dark', 'light']) {
    state.prefs.theme = theme;
    context.applyThemeClass();
    assert.deepEqual([...body.classList.values], ['unrelated']);
    assert.deepEqual([...reader.classList.values], ['settings-open', ...(theme === 'light' ? [] : [theme])]);
    assert.deepEqual(buttons.map((button) => button['aria-pressed']), buttons.map((button) => String(button.dataset.readerTheme === theme)));
  }
});

test('阅读配色保持 EPUB、PDF、分页器的应用与偏好保存通路', async () => {
  const source = app.slice(app.indexOf('async function applyTheme(theme)'), app.indexOf('function petValueLabel()'));
  for (const format of ['epub', 'pdf', 'txt', 'mobi', 'azw3']) {
    const calls = [];
    const state = { prefs: { theme: 'light', marginPct: 12 }, current: { format } };
    if (format === 'epub') state.current.rendition = { getContents: () => ['chapter-a', 'chapter-b'] };
    if (['txt', 'mobi', 'azw3'].includes(format)) state.current.paginator = {};
    const context = vm.createContext({ state, applyThemeClass: () => calls.push('scope'), applyReaderStyles: (doc) => calls.push(doc), renderPdfPage: () => calls.push('pdf'), applyMobiTheme: () => calls.push('paginator'), restoreEpubAnnotations: () => calls.push('annotations'), rememberSettings: () => calls.push('remember'), window: { api: { stateSet: async (key, prefs) => { assert.equal(key, 'prefs'); assert.equal(prefs.theme, 'eye'); assert.equal(prefs.marginPct, 12); calls.push('persist'); } } } });
    vm.runInContext(source, context);
    await context.applyTheme('eye');
    assert.deepEqual(calls, ['scope', ...(format === 'epub' ? ['chapter-a', 'chapter-b', 'annotations'] : format === 'pdf' ? ['pdf'] : ['paginator']), 'persist', 'remember']);
  }
});

test('非阅读样式没有日间夜间护眼覆盖，设置样式只影响侧栏及避让的播放器', () => {
  for (const name of ['styles.css', 'non-reading.css', 'library-stats.css', 'home.css', 'settings.css', 'library.css', 'music.css']) {
    assert.doesNotMatch(read(name), /body\.(?:dark|eye)/, name);
  }
  const css = read('settings.css');
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((match) => match[1].trim()).filter((selector) => !selector.startsWith('@'));
  for (const rule of selectors) {
    for (const selector of rule.split(/,(?![^()]*\))/)) assert.match(selector.trim(), /^(?:#settings-(?:overlay|drawer)(?=$|\s|[:.#[])|#bgm-capsule\[data-settings-open="1"\])/, selector);
  }
  const html = read('index.html');
  const reading = html.slice(html.indexOf('id="drawer-reading"'), html.indexOf('id="drawer-funcs"'));
  assert.equal((reading.match(/data-reader-theme=/g) || []).length, 3);
  assert.doesNotMatch(html, /id="btn-theme"/);
  assert.match(app, /const inReader = !views\.reader\.hidden && state\.current != null/);
  assert.match(html, /id="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title"/);
});

test('设置分别调节横纵边距，控制台和右键书签用提示文字说明', () => {
  const html = read('index.html');
  assert.match(html, /id="margin-label">左右边距/);
  assert.match(html, /id="vertical-margin-label">上下边距/);
  for (const id of ['btn-margin', 'margin-value', 'btn-vertical-margin', 'vertical-margin-value']) assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  assert.match(app, /\$\('btn-margin'\)\.addEventListener\('click', cycleMargin\)/);
  assert.match(app, /\$\('btn-vertical-margin'\)\.addEventListener\('click', cycleVerticalMargin\)/);
  const settings = app.slice(app.indexOf('function rememberSettings()'), app.indexOf('function rememberSettings()') + 950);
  assert.match(settings, /Object\.assign\(\{\}, state\.prefs/);
  assert.match(settings, /stateSet\('prefs', state\.prefs\)/);
  const companion = html.slice(html.indexOf('id="drawer-appearance"'), html.indexOf('id="drawer-lookup"'));
  assert.doesNotMatch(companion, /id="btn-pet-console"/);
  assert.match(companion, /class="drawer-hint">右键点击有珠，可打开有珠控制台/);
  const tools = html.slice(html.indexOf('id="drawer-funcs"'), html.indexOf('id="drawer-appearance"'));
  assert.match(tools, /id="btn-simplified"/);
  assert.match(tools, /仅改变正文显示，不影响目录、笔记、书签等中的汉字/);
  assert.match(tools, /class="drawer-hint">在阅读正文任意位置右键/);
});
