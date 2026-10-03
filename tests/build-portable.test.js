'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseArgs, selectTracks, generateCatalog, createBuildPlan, buildPortable } = require('../scripts/build-portable');
const { BGM_TRACKS, BGM_DEFAULT_LOOP } = require('../src/shared/bgm');
const root = path.join(__dirname, '..');
const catalog = fs.readFileSync(path.join(root, 'src/shared/bgm.js'), 'utf8');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function loadCatalog(source) {
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(source, context);
  return context.module.exports;
}

test('portable CLI selects editions and only accepts explicit F-drive output directories', () => {
  assert.deepEqual(parseArgs([]), { edition: 'all' });
  assert.deepEqual(parseArgs(['--edition=lite', '--output=F:\\portable-output']), { edition: 'lite', output: 'F:\\portable-output' });
  for (const args of [['--edition=other'], ['--edition=full', '--edition=lite'], ['--output='], ['--output=relative'], ['--output=C:\\build'], ['--publish=always']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('Full keeps all 59 songs; Lite keeps exactly the three selected files in album order', () => {
  assert.equal(selectTracks('full', BGM_TRACKS).length, 59);
  assert.deepEqual(selectTracks('lite', BGM_TRACKS).map(track => track.file), ['1-01.flac', '1-05.flac', '1-08.flac']);
  assert.throws(() => selectTracks('lite', BGM_TRACKS.filter(track => track.file !== '1-05.flac')));
  assert.throws(() => selectTracks('full', [...BGM_TRACKS.slice(1), BGM_TRACKS[1]]));
  assert.throws(() => selectTracks('full', [{ ...BGM_TRACKS[0], file: '../private.flac' }, ...BGM_TRACKS.slice(1)]));
});

for (const edition of ['full', 'lite']) {
  test(edition + ' generated catalog preserves the default loop and manual navigation without missing audio', () => {
    const tracks = selectTracks(edition, BGM_TRACKS);
    const generated = generateCatalog(catalog, tracks);
    const bgm = loadCatalog(generated);
    const declaration = /const BGM_TRACKS\s*=\s*\[[\s\S]*?^\s*\];/m;
    assert.equal(generated.replace(declaration, '<catalog>'), catalog.replace(declaration, '<catalog>'));
    assert.deepEqual(Array.from(bgm.BGM_DEFAULT_LOOP), BGM_DEFAULT_LOOP);
    assert.deepEqual(Array.from(bgm.BGM_TRACKS, track => track.file), tracks.map(track => track.file));
    let current = tracks[0].id;
    const visited = new Set();
    for (const track of tracks) {
      assert.equal(current, track.id); visited.add(current);
      const next = bgm.nextManualTrack(current, 1);
      assert.equal(bgm.nextManualTrack(next, -1), current);
      assert.ok(tracks.some(item => item.file === bgm.trackById(next).file));
      assert.ok(tracks.some(item => item.id === bgm.nextAutoTrack(current)));
      current = next;
    }
    assert.equal(current, tracks[0].id); assert.equal(visited.size, tracks.length);
    assert.equal(bgm.nextAutoTrack('alice'), 'soujurou');
    assert.equal(bgm.nextAutoTrack('soujurou'), 'alice');
    assert.equal(bgm.nextAutoTrack('missing-saved-id'), 'alice');
    assert.ok(bgm.trackById(bgm.nextManualTrack('missing-saved-id', 1)));
  });
}

test('catalog generation refuses an ambiguous or missing declaration', () => {
  assert.throws(() => generateCatalog('const tracks = [];', BGM_TRACKS));
  assert.throws(() => generateCatalog(catalog + catalog, BGM_TRACKS));
});

test('a missing music cover stops preflight before creating a build workspace', async t => {
  const originalStat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (filename, ...args) => {
    if (filename === path.join(root, 'assets/bgm/cover.jpg')) throw Object.assign(new Error('fixture missing cover'), { code: 'ENOENT' });
    return originalStat(filename, ...args);
  });
  t.mock.method(fs, 'mkdirSync', () => assert.fail('preflight must finish before workspace creation'));
  await assert.rejects(buildPortable({ edition: 'lite' }), /fixture missing cover/);
});

test('edition plans keep the package configuration immutable and isolate their output', () => {
  const before = JSON.stringify(metadata);
  const workDirectory = path.join(root, '.tmp/portable-build-fixture');
  const full = createBuildPlan({ edition: 'full', metadata, projectDirectory: root, workDirectory, catalogSource: catalog, tracks: BGM_TRACKS });
  const lite = createBuildPlan({ edition: 'lite', metadata, projectDirectory: root, workDirectory, catalogSource: catalog, tracks: BGM_TRACKS });
  assert.equal(JSON.stringify(metadata), before);
  assert.equal(full.artifactName, `GaiaReading_Lucky-${metadata.version}-Windows-x64-Full.exe`);
  assert.equal(lite.artifactName, `GaiaReading_Lucky-${metadata.version}-Windows-x64-Lite.exe`);
  assert.notEqual(full.outputDirectory, lite.outputDirectory);
  assert.deepEqual(lite.config.win.target, ['portable']);
  assert.equal(lite.config.appId, metadata.build.appId);
  assert.equal(lite.config.npmRebuild, false);
  assert.deepEqual(lite.config.extraMetadata.gaiaPortable, { edition: 'lite', trackCount: 3 });
  assert.equal(lite.config.publish, null);
});

test('electron-builder effective FileSets select only edition music and map the generated catalog once', async t => {
  // Builder's multi-part stdout progress writes can corrupt Node's parallel
  // test-child message framing on Windows. Keep them on the runner's channel.
  const { log } = require('builder-util');
  t.mock.method(log, 'info', (fields, message) => t.diagnostic(message || String(fields)));
  const { getConfig, validateConfiguration } = require('app-builder-lib/out/util/config/config');
  const { getMainFileMatchers, getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher');
  const { getDestinationPath } = require('app-builder-lib/out/util/appFileCopier');
  const temporaryRoot = path.join(root, '.tmp');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const workDirectory = fs.mkdtempSync(path.join(temporaryRoot, 'portable-plan-test-'));
  t.after(() => fs.rmSync(workDirectory, { recursive: true, force: true }));
  for (const edition of ['full', 'lite']) {
    const plan = createBuildPlan({ edition, metadata, projectDirectory: root, workDirectory, catalogSource: catalog, tracks: BGM_TRACKS });
    fs.mkdirSync(plan.stagingDirectory, { recursive: true });
    fs.writeFileSync(plan.configPath, JSON.stringify(plan.config));
    fs.writeFileSync(plan.catalogPath, plan.catalogSource);
    // Passing a config file avoids the API's array-union with package.build.files.
    const config = await getConfig(root, plan.configPath, null);
    await validateConfiguration(config, { isEnabled: false });
    const destination = path.join(plan.outputDirectory, 'resources/app');
    const platform = { info: { config, projectDir: root, buildResourcesDir: 'build', isPrepackedAppAsar: false, debugLogger: { isEnabled: false } } };
    const matchers = getMainFileMatchers(root, destination, value => value, config.win, platform, plan.outputDirectory, false);
    const included = file => matchers.filter(matcher => matcher.createFilter()(file, { isDirectory: () => false }));
    for (const track of BGM_TRACKS) {
      const selected = included(path.join(root, 'assets/bgm', track.file));
      assert.equal(selected.length, plan.tracks.some(item => item.id === track.id) ? 1 : 0, edition + ': ' + track.file);
    }
    assert.equal(included(path.join(root, 'assets/bgm/cover.jpg')).length, 1);
    const audioFiles = fs.readdirSync(path.join(root, 'assets/bgm')).filter(name => name.endsWith('.flac') && included(path.join(root, 'assets/bgm', name)).length);
    assert.equal(audioFiles.length, edition === 'lite' ? 3 : 59);
    for (const relative of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) assert.equal(included(path.join(root, relative)).length, 1, relative);
    assert.equal(included(path.join(root, 'src/shared/bgm.js')).length, 0);
    const replacements = included(plan.catalogPath);
    assert.equal(replacements.length, 1);
    assert.equal(getDestinationPath(plan.catalogPath, { src: replacements[0].from, destination: replacements[0].to }), path.join(destination, 'src/shared/bgm.js'));
    assert.equal(included(path.join(root, 'src/main.js')).length, 1);
    for (const relative of ['数据/GaiaReading_Lucky.json', '备份/private.zip', '.tmp/private.json', '.cache/private.json', '.env', 'assets/bgm/1-01.flac.baiduyun.uploading.cfg']) {
      assert.equal(included(path.join(root, relative)).length, 0, relative);
    }
    const dependencies = getNodeModuleFileMatcher(root, destination, value => value, config.win, platform.info);
    assert.equal(dependencies.createFilter()(path.join(root, 'node_modules/canvas/package.json'), { isDirectory: () => false }), false);
    assert.equal(dependencies.createFilter()(path.join(root, 'node_modules/jszip/package.json'), { isDirectory: () => false }), true);
  }
});
