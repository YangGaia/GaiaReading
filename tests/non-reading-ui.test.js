'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = path.join(__dirname, '..', 'src', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const sheets = ['non-reading.css', 'library-stats.css'];
const viewControls = {
  home: ['btn-home-shelf', 'btn-home-add-books', 'btn-home-ai', 'btn-home-settings', 'home-img'],
  library: ['btn-back-home', 'btn-settings', 'btn-add-books', 'btn-manage', 'btn-reading-stats', 'import-status', 'manage-bar', 'manage-count', 'btn-select-all', 'btn-remove-selected', 'btn-exit-manage', 'library-hint', 'bookshelf'],
  stats: ['btn-stats-back', 'stats-today', 'stats-goal-copy', 'stats-alice-line', 'stats-alice', 'stats-alice-zzz', 'stats-ring', 'stats-ring-percent', 'stats-week-total', 'stats-week-chart', 'stats-current-streak', 'stats-longest-streak', 'stats-goal-options', 'stats-finished-count', 'stats-finished-books'],
};

// Walk nested blocks without treating braces inside CSS strings as structure.
function styleSelectors(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  function walk(text) {
    let start = 0;
    let quote = '';
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') i += 1;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch !== '{') continue;
      const prelude = text.slice(start, i).trim();
      let depth = 1;
      const bodyStart = ++i;
      for (; i < text.length && depth; i += 1) {
        const inner = text[i];
        if (quote) {
          if (inner === '\\') i += 1;
          else if (inner === quote) quote = '';
        } else if (inner === '"' || inner === "'") quote = inner;
        else if (inner === '{') depth += 1;
        else if (inner === '}') depth -= 1;
      }
      assert.equal(depth, 0, 'CSS block must close');
      if (prelude.startsWith('@')) {
        assert.match(prelude, /^@(media|supports|container|layer)\b/, 'new sheets must not introduce global at-rules');
        walk(text.slice(bodyStart, i - 1));
      } else selectors.push(...prelude.split(',').map((selector) => selector.trim()));
      start = i;
      i -= 1;
    }
    assert.equal(text.slice(start).trim(), '', 'unexpected CSS outside a rule');
  }
  walk(css);
  return selectors;
}

test('非阅读页面的新样式加载在原样式之后，避免替换阅读样式', () => {
  const original = html.indexOf('href="styles.css"');
  assert.ok(original >= 0);
  for (const sheet of sheets) {
    assert.ok(html.indexOf(`href="${sheet}"`) > original, `${sheet} should layer after styles.css`);
    assert.ok(fs.existsSync(path.join(renderer, sheet)), `${sheet} is missing`);
  }
});

test('包括响应式与主题规则在内的新 CSS 全部限定在授权的三个页面内', () => {
  for (const sheet of sheets) {
    const css = fs.readFileSync(path.join(renderer, sheet), 'utf8');
    const selectors = styleSelectors(css);
    assert.ok(selectors.length > 10, `${sheet} should contain parsed style rules`);
    for (const selector of selectors) {
      assert.match(selector, /^(?:body(?:\.[\w-]+)*\s+)?#(?:home-view|library-view|stats-view)(?=$|[\s.#:[>])/, `${sheet}: unscoped selector ${selector}`);
      assert.doesNotMatch(selector, /#(?:home-view|library-view|stats-view)(?:\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?|[.#][\w-]+)*\s*[+~]/, `${sheet}: selector escapes its page ${selector}`);
      assert.doesNotMatch(selector, /#(?:reader-view|ai-view|settings-overlay|fx-canvas)\b/, `${sheet}: unrelated surface ${selector}`);
    }
  }
});

test('首页、书架与目标页保留既有操作控件及动态内容挂载点', () => {
  for (const [view, ids] of Object.entries(viewControls)) {
    const start = html.indexOf(`id="${view}-view"`);
    assert.ok(start >= 0, `${view} view missing`);
    const nextView = html.slice(start + 1).search(/id="(?:home|library|stats|reader|ai)-view"/);
    const section = html.slice(start, nextView < 0 ? undefined : start + 1 + nextView);
    assert.match(section.slice(0, section.indexOf('>')), /\bhidden\b/, `${view} must start hidden until app navigation runs`);
    for (const id of ids) {
      assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} must stay unique`);
      assert.ok(section.includes(`id="${id}"`), `${id} must remain inside ${view}`);
      if (id.startsWith('btn-')) assert.match(html, new RegExp(`<button\\b[^>]*id="${id}"[^>]*>`), `${id} must retain native button semantics`);
    }
  }
  for (const minutes of [15, 30, 45, 60]) {
    assert.match(html, new RegExp(`<button\\b[^>]*data-goal-minutes="${minutes}"[^>]*>`), `${minutes}-minute choice missing`);
  }
  assert.match(html, /<[^>]*id="manage-bar"[^>]*\bhidden\b[^>]*>/);
  assert.match(html, /<[^>]*id="stats-alice-zzz"[^>]*\bhidden\b[^>]*>/);
  assert.match(html, /<[^>]*id="stats-alice"[^>]*role="button"[^>]*>/);
});

test('视觉改版保留可访问的角色说明、导入反馈与目标选择语义', () => {
  const tagFor = (id) => {
    const tag = html.match(new RegExp(`<[^>]*\\bid="${id}"[^>]*>`));
    assert.ok(tag, `${id} is missing`);
    return tag[0];
  };
  for (const id of ['home-img', 'stats-alice']) {
    assert.match(tagFor(id), /\balt="[^"]+"/, `${id} must describe its character art`);
  }
  assert.match(tagFor('stats-alice'), /\btabindex="0"/, 'the interactive character must remain keyboard accessible');
  assert.match(tagFor('stats-alice'), /\baria-label="[^"]+"/, 'the interactive character must explain its action');
  assert.match(tagFor('import-status'), /\brole="status"/, 'import status must stay a live status region');
  assert.match(tagFor('import-status'), /\baria-live="polite"/);
  assert.match(tagFor('stats-goal-options'), /\brole="group"/);
  assert.match(tagFor('stats-goal-options'), /\baria-label="[^"]+"/, 'the goal controls need a group name');
});
