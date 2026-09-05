'use strict';

// Runs inside non-reading-smoke's disposable user-data directory. All requests
// exercised below go to a local fixture, never a paid model or a user's endpoint.
const assert = require('node:assert/strict');
const http = require('node:http');

module.exports = async ({ win, report, check, capture }) => {
  const evaluate = (fn, arg) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const click = (selector) => evaluate((selector) => __uiSmoke.click(selector), selector);
  const settle = () => evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await evaluate(async () => {
    const original = await window.api.aiProfilesGet();
    await window.api.aiProfileSave({ ...original.items[0], name: 'DeepSeek', model: 'deepseek-chat', apiKey: 'gaia-ui-fixture', activate: false });
    await window.api.aiProfileSave({ name: '自定义接口', provider: 'custom', baseUrl: 'https://relay.example/v1', model: 'relay/private-model', apiKey: 'gaia-ui-fixture', activate: false });
    const saved = await window.api.aiProfileSave({ name: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-astra', apiKey: 'gaia-ui-fixture', activate: true });
    acceptAiProfiles(saved, saved.activeId);
    openAiCenter('home');
    await document.fonts.ready;
    await GaiaPet.whenReady();
  });
  await wait(350);
  await capture(win, 'ai-center-1100x760');
  check('AI center opens the real configuration page', await evaluate(() => !views.ai.hidden && els.aiModel.value === 'gpt-6-astra' && els.aiApiKey.value === '' && els.aiApiKey.type === 'password'));
  report.checks.push(await evaluate(() => __uiSmoke.assertStyleIsolation('ai')));
  const preferences = await evaluate(async () => ({ profiles: await window.api.aiProfilesGet(), music: GaiaBgm.getState() }));
  let palette;
  for (const theme of ['light', 'dark', 'eye']) {
    await evaluate((theme) => __gaiaDebug.setTheme(theme), theme);
    for (const [width, height] of [[800, 600], [1100, 760], [1600, 1000], [1440, 600], [800, 1000], [2560, 1080]]) {
      win.setContentSize(width, height);
      await wait(200);
      await evaluate(() => { document.querySelector('.ai-center-scroll').scrollTop = 0; });
      const info = await evaluate(() => {
        const root = document.getElementById('ai-view');
        const scroller = root.querySelector('.ai-center-scroll');
        const style = getComputedStyle(root);
        const field = getComputedStyle(document.getElementById('ai-model'));
        const header = root.querySelector('.topbar').getBoundingClientRect();
        const player = document.getElementById('bgm-capsule').getBoundingClientRect();
        const card = root.querySelector('.ai-config-card');
        const expected = Math.min(innerWidth / 1100, innerHeight / 760);
        return { palette: [style.backgroundColor, style.color, field.backgroundColor, field.color],
          noOverflow: scroller.scrollWidth <= scroller.clientWidth + 1 && root.scrollWidth <= root.clientWidth + 1,
          native: [root, card, document.getElementById('bgm-capsule')].every((el) => getComputedStyle(el).transform === 'none'),
          musicFits: player.top >= header.top && player.bottom <= header.bottom && player.right <= innerWidth,
          musicScale: Math.abs(player.width - 336 * expected) < .1,
          fontReady: document.fonts.check('14px "Gaia Home Noto"') && document.fonts.check('23px "Gaia Wordmark"'),
          font: style.fontFamily, modelFont: field.fontFamily,
          columns: getComputedStyle(root.querySelector('.ai-center-grid')).gridTemplateColumns.split(' ').length };
      });
      palette ||= info.palette;
      assert.deepEqual(info.palette, palette, 'Reader themes must not recolor the AI workspace');
      check(`AI ${theme} ${width}x${height}: native paint, fonts and responsive music`, info.noOverflow && info.native && info.musicFits && info.musicScale && info.fontReady && info.font.includes('Gaia Home Noto') && info.modelFont.includes('Consolas'));
      check(`AI ${theme} ${width}x${height}: responsive columns`, info.columns === (width <= 900 ? 1 : 2));
      report.checks.push(await evaluate(() => __uiSmoke.layout('ai')));
      report.checks.push(await evaluate(() => __uiSmoke.controls('ai')));
      report.checks.push(await evaluate(() => __uiSmoke.contrast('ai')));
      if (theme === 'light') await capture(win, `ai-center-${width}x${height}`);
    }
  }
  assert.deepEqual(await evaluate(async () => ({ profiles: await window.api.aiProfilesGet(), music: GaiaBgm.getState() })), preferences, 'Resizing and themes do not mutate profiles or playback');

  // Exercise the existing companion controls in the disposable profile. The new
  // layout must follow its size/visibility without changing any pet state itself.
  const initialPet = await evaluate(() => GaiaPet.getState());
  for (const [width, height] of [[800, 600], [1100, 760]]) {
    win.setContentSize(width, height);
    await wait(180);
    for (const scale of [.75, 1.5]) {
      const afterUserChange = await evaluate((scale) => {
        const control = [...document.querySelectorAll('.gaia-pet-console-select-row')].find((row) => row.firstElementChild.textContent === '尺寸').querySelector('select');
        control.value = String(scale);
        control.dispatchEvent(new Event('change', { bubbles: true }));
        return GaiaPet.getState();
      }, scale);
      await settle();
      check(`AI ${width}x${height}: reserves companion space at ${scale * 100}%`, await evaluate(() => {
        const pet = document.getElementById('gaia-pet');
        const root = document.getElementById('ai-view');
        return parseFloat(root.style.getPropertyValue('--ai-companion-width')) === pet.offsetWidth &&
          parseFloat(getComputedStyle(root.querySelector('.ai-center-scroll')).paddingRight) >= pet.offsetWidth + 40;
      }));
      report.checks.push(await evaluate(() => __uiSmoke.controls('ai')));
      assert.deepEqual(await evaluate(() => GaiaPet.getState()), afterUserChange, 'Layout cannot move, resize or save the companion');
    }
  }
  await evaluate(() => GaiaPet.setEnabled(false));
  await settle();
  check('AI reclaims the companion reserve when it is hidden', await evaluate(() => document.getElementById('ai-view').style.getPropertyValue('--ai-companion-width') === '0px'));
  await evaluate((initial) => {
    // Restore visibility before using the size control: a user can only adjust
    // this control on a visible companion with a measurable bounding box.
    GaiaPet.setEnabled(initial.on);
    const control = [...document.querySelectorAll('.gaia-pet-console-select-row')].find((row) => row.firstElementChild.textContent === '尺寸').querySelector('select');
    control.value = String(initial.scale);
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }, initialPet);
  win.setContentSize(1100, 760);
  await wait(180);
  report.checks.push(await evaluate(() => __uiSmoke.controls('ai')));
  const originalModel = await evaluate(() => els.aiModel.value);
  await click('#btn-ai-model-menu');
  check('OpenAI lists GPT-6 by exact ID once', await evaluate(() => {
    const options = [...els.aiModelOptions.querySelectorAll('[data-model-id="gpt-6-astra"]')];
    return options.length === 1 && options[0].textContent === 'gpt-6-astra';
  }));
  await click('[data-model-id="gpt-6-astra"]');
  check('clicking a model preserves the exact request ID', await evaluate(() => els.aiModel.value === 'gpt-6-astra' && els.aiModelOptions.hidden));
  win.webContents.focus();
  const key = async (keyCode) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    // Electron sends keyDown and character input separately; Enter activates a
    // native button on the character event, as a physical keyboard would.
    if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await settle();
  };
  await evaluate(() => els.aiModel.focus());
  await key('Down');
  const keyboardFocus = await evaluate(() => ({ element: document.activeElement.className, outline: getComputedStyle(document.activeElement).outlineStyle, focused: document.hasFocus(), matchesFocus: document.activeElement.matches(':focus'), hidden: els.aiModelOptions.hidden }));
  report.keyboardFocus = keyboardFocus;
  check('model picker can be entered with the keyboard and has visible focus: ' + JSON.stringify(keyboardFocus), keyboardFocus.element.includes('ai-model-option') && keyboardFocus.outline === 'solid');
  await capture(win, 'ai-center-model-list-1100x760');
  await key('Tab');
  await key('Tab');
  await key('Tab');
  check('keyboard can reach the GPT-6 option', await evaluate(() => document.activeElement.dataset.modelId === 'gpt-6-astra'));
  await key('Enter');
  const keyboardSelection = await evaluate(() => ({ model: els.aiModel.value, hidden: els.aiModelOptions.hidden, focused: document.activeElement.id || document.activeElement.className }));
  report.keyboardSelection = keyboardSelection;
  check('keyboard selection applies the exact ID and returns focus to the input: ' + JSON.stringify(keyboardSelection), keyboardSelection.model === 'gpt-6-astra' && keyboardSelection.hidden && keyboardSelection.focused === 'ai-model');
  await evaluate(() => { setAiModelMenuOpen(false); els.aiModel.value = 'relay/private-model'; els.aiProvider.value = 'custom'; els.aiProvider.dispatchEvent(new Event('change', { bubbles: true })); });
  check('changing to custom keeps the manually filled ID', await evaluate(() => els.aiModel.value === 'relay/private-model'));
  await click('#btn-ai-model-menu');
  check('custom also offers GPT-6 by exact ID', await evaluate(() => els.aiModelOptions.querySelector('[data-model-id="gpt-6-astra"]').textContent === 'gpt-6-astra'));
  await click('[data-model-id="gpt-6-astra"]');
  await evaluate(() => updateAiConfigForm());
  check('switching editors has not overwritten the saved profile', await evaluate((model) => els.aiModel.value === model && els.aiProvider.value === 'openai', originalModel));

  // Exercise the actual IPC, encrypted key storage and existing request client.
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ path: request.url, model: body && body.model });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/v1/models') response.end(JSON.stringify({ data: [{ id: 'gpt-6-astra' }, { id: 'gpt-6-astra' }, { id: 'relay/another-model' }] }));
    else if (request.url === '/v1/chat/completions') response.end(JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }));
    else { response.statusCode = 404; response.end('{}'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const provider of ['openai', 'custom']) {
      await click('#btn-ai-profile-new');
      await evaluate(({ provider, baseUrl }) => {
        els.aiProfileName.value = '测试 ' + provider;
        els.aiProvider.value = provider;
        els.aiProvider.dispatchEvent(new Event('change', { bubbles: true }));
        els.aiBaseUrl.value = baseUrl;
        els.aiBaseUrl.dispatchEvent(new Event('input', { bubbles: true }));
        els.aiApiKey.value = 'gaia-ui-fixture';
        els.aiModel.value = 'gpt-6-astra';
      }, { provider, baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
      await click('#btn-ai-save');
      check(`${provider}: saves and activates the exact GPT-6 ID with a protected key`, await evaluate(async () => {
        const profiles = await window.api.aiProfilesGet();
        const active = profiles.items.find((profile) => profile.id === profiles.activeId);
        return active.model === 'gpt-6-astra' && active.hasApiKey && !Object.hasOwn(active, 'apiKey') && els.aiApiKey.value === '' &&
          document.querySelector('.ai-profile-item.selected').getAttribute('aria-pressed') === 'true';
      }));
      await click('#btn-ai-test');
      check(`${provider}: actual connection button reaches the local fixture`, await evaluate(() => els.aiConfigStatus.classList.contains('success') && els.aiConfigStatus.textContent.includes('连接成功')));
      await click('#btn-ai-model-refresh');
      check(`${provider}: discovered GPT-6 deduplicates against the preset`, await evaluate(() => els.aiModelOptions.querySelectorAll('[data-model-id="gpt-6-astra"]').length === 1 && !!els.aiModelOptions.querySelector('[data-model-id="relay/another-model"]') && els.aiModel.value === 'gpt-6-astra'));
      await click('[data-model-id="gpt-6-astra"]');
    }
    assert.deepEqual(requests.filter((request) => request.path.endsWith('/chat/completions')).map((request) => request.model), ['gpt-6-astra', 'gpt-6-astra']);
    report.aiRequests = requests;
  } finally { await new Promise((resolve) => server.close(resolve)); }

  await evaluate(() => { els.aiBaseUrl.value = 'not a URL'; });
  await click('#btn-ai-save');
  check('invalid input keeps the established error feedback', await evaluate(() => els.aiConfigStatus.classList.contains('error') && els.aiConfigStatus.textContent.includes('Base URL')));
  await capture(win, 'ai-center-error-1100x760');
  await evaluate(() => updateAiConfigForm());
  await click('#btn-ai-back');
  check('AI back returns to its original page', await evaluate(() => __gaiaDebug.getView() === 'home'));

  // Disable only the new sheet to verify it cannot change other page styles.
  check('AI styles cannot affect other pages or the pet', await evaluate(() => {
    const sheet = [...document.styleSheets].find((item) => /\/ai-center\.css$/.test(item.href || ''));
    const elements = ['home-view', 'library-view', 'stats-view', 'reader-view', 'settings-overlay', 'gaia-pet', 'bgm-capsule'].flatMap((id) => {
      const root = document.getElementById(id); return [root, ...root.querySelectorAll('button, input, h1, h2, .page-title')];
    });
    const snapshot = () => elements.map((el) => { const s = getComputedStyle(el); return [...s].map((key) => s.getPropertyValue(key)).join('|'); });
    const before = snapshot();
    sheet.disabled = true;
    let after;
    try { after = snapshot(); } finally { sheet.disabled = false; }
    return JSON.stringify(before) === JSON.stringify(after);
  }));
  await settle();
};
