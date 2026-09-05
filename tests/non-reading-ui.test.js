'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = path.join(__dirname, '..', 'src', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const sheets = ['non-reading.css', 'library-stats.css', 'home.css'];
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
        if (prelude === '@font-face') {
          const face = text.slice(bodyStart, i - 1);
          assert.match(face, /font-family:\s*"Gaia (?:Home Noto|Wordmark)"/);
          if (face.includes('Gaia Home Noto')) assert.match(face, /src:\s*local\("Noto Sans SC"\)/);
          else assert.match(face, /src:\s*url\("fonts\/cormorant-garamond-latin-500\.woff2"\)/);
        } else {
          assert.match(prelude, /^@(media|supports|container|layer)\b/, 'new sheets must not introduce other global at-rules');
          walk(text.slice(bodyStart, i - 1));
        }
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
      if (sheet === 'home.css') assert.match(selector, /^#home-view(?=$|[\s.#:[>])/, 'the new home stylesheet must not restyle other pages');
      assert.doesNotMatch(selector, /#(?:home-view|library-view|stats-view)(?:\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?|[.#][\w-]+)*\s*[+~]/, `${sheet}: selector escapes its page ${selector}`);
      assert.doesNotMatch(selector, /#(?:reader-view|ai-view|settings-overlay|fx-canvas)\b/, `${sheet}: unrelated surface ${selector}`);
    }
  }
});

test('正式首页包含线条构图、原首页素材和可打包的轮廓蒙版', () => {
  const section = html.slice(html.indexOf('id="home-view"'), html.indexOf('id="ai-view"'));
  assert.match(section, /id="home-img"[^>]+src="images\/1\.jpg"/);
  assert.doesNotMatch(section, /2\.jpeg|home-item-number|home-subtitle|alice-companion/);
  for (const marker of ['home-bgm-slot', 'header-rule', 'study-divider', 'portrait-lines']) assert.ok(section.includes(marker), marker);
  const css = fs.readFileSync(path.join(renderer, 'home.css'), 'utf8');
  assert.match(css, /mask-image:\s*url\("images\/home\/alice-matte\.png"\)/);
  assert.doesNotMatch(css, /mask-image:\s*(?:radial|linear)-gradient/);
  const bundled = fs.readFileSync(path.join(renderer, 'images/home/alice-matte.png'));
  assert.deepEqual(bundled, fs.readFileSync(path.join(renderer, '../../docs/design/home/assets/alice-matte.png')));
  assert.match(html, /<script src="home-layout\.js"><\/script>/);
});

test('首页按实际尺寸绘制等比例构图，不放大已合成的页面图层', () => {
  const css = fs.readFileSync(path.join(renderer, 'home.css'), 'utf8');
  assert.match(css, /\.home-surface\s*\{[^}]*width:\s*calc\(1100 \* var\(--home-unit\)\);[^}]*height:\s*calc\(760 \* var\(--home-unit\)\)/);
  for (const selector of ['home-stage', 'home-surface']) {
    const rule = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))[1];
    assert.doesNotMatch(rule, /transform:|zoom:|filter:/);
  }
  assert.match(css, /font-size:\s*calc\(46 \* var\(--home-unit\)\)/);
  assert.match(css, /backdrop-filter:\s*none/);
  assert.doesNotMatch(css, /\b\d*(?:vw|vh|svh|dvh)\b|@media[^\{]*(?:width|height)|--home-pet-space/);
  assert.match(html, /class="home-stage"/);
});

test('首页字标字体随软件离线分发，控件保持 Noto Sans SC', () => {
  const font = fs.readFileSync(path.join(renderer, 'fonts/cormorant-garamond-latin-500.woff2'));
  assert.equal(font.subarray(0, 4).toString('ascii'), 'wOF2');
  assert.match(fs.readFileSync(path.join(renderer, 'fonts/CormorantGaramond-OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE/);
  const css = fs.readFileSync(path.join(renderer, 'home.css'), 'utf8');
  assert.match(css, /#home-view h1\s*\{[^}]*font-family:\s*"Gaia Wordmark"/);
  assert.match(css, /#home-view\s*\{[^}]*font-family:\s*"Gaia Home Noto"/);
  assert.doesNotMatch(css, /@import|src:\s*url\(["']?https?:/);
  assert.match(html, /rel="preload" href="fonts\/cormorant-garamond-latin-500\.woff2"/);
});

test('首页光感反馈不接管点击或存储，离页与减少动态效果会清理动画', () => {
  const script = fs.readFileSync(path.join(renderer, 'home-interactions.js'), 'utf8');
  assert.match(html, /<script src="home-interactions\.js"><\/script>/);
  assert.doesNotMatch(script, /window\.api|stateSet|localStorage|preventDefault|stopPropagation|addEventListener\(['"]click/);
  assert.match(script, /event\.pointerType === 'touch' \|\| event\.buttons/);
  assert.match(script, /cancelAnimationFrame\(frame\)/);
  assert.match(script, /reducedMotion\.addEventListener\('change', syncVisibility\)/);
  assert.match(script, /document\.addEventListener\('visibilitychange', syncVisibility\)/);
  assert.match(script, /animation\.onfinish = .*animation\.cancel\(\)/);
  assert.doesNotMatch(script, /setInterval|setTimeout|\.scale|rotate|transform:/);
});

test('桌宠不依赖首页画布大小和坐标系，只使用原有窗口位置与用户尺寸设置', () => {
  const pet = fs.readFileSync(path.join(renderer, 'pet.js'), 'utf8');
  assert.doesNotMatch(pet, /home-surface|home-layout|positionFrame|frame\.scale/);
  assert.match(pet, /Math\.round\(150 \* saved\.scale\)/);
  assert.match(pet, /window\.innerWidth - bw/);
  assert.match(pet, /window\.innerHeight - bh/);
  const css = fs.readFileSync(path.join(renderer, 'styles.css'), 'utf8');
  assert.match(css, /\.gaia-pet-bubble\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.gaia-pet-bubble\s*\{[^}]*pointer-events:\s*none/);
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
