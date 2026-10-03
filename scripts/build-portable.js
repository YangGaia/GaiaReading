'use strict';

// Dot-source scripts/dev-env.ps1 before running with --edition=full|lite|all.
const fs = require('node:fs');
const path = require('node:path');
const { requireFPath } = require('../src/shared/app-paths');
const { BGM_TRACKS, BGM_DEFAULT_LOOP } = require('../src/shared/bgm');

const LITE_FILES = ['1-01.flac', '1-05.flac', '1-08.flac'];

function absoluteFDirectory(value) {
  if (typeof value !== 'string' || !/^f:[\\/]/i.test(value)) throw new Error('Build directories must be absolute F-drive paths.');
  return path.resolve(value);
}

function parseArgs(args) {
  const options = { edition: 'all' };
  const seen = new Set();
  for (const argument of args) {
    const match = /^--(edition|output)=(.+)$/.exec(argument);
    if (!match || seen.has(match[1])) throw new Error('Usage: node scripts/build-portable.js --edition=full|lite|all [--output=F:\\absolute-directory]');
    seen.add(match[1]);
    options[match[1]] = match[2];
  }
  if (!['full', 'lite', 'all'].includes(options.edition)) throw new Error('Unknown portable edition: ' + options.edition);
  if (options.output) options.output = absoluteFDirectory(options.output);
  return options;
}

function selectTracks(edition, tracks) {
  if (!['full', 'lite'].includes(edition)) throw new Error('Expected a full or lite edition.');
  if (!Array.isArray(tracks) || tracks.length !== 59) throw new Error('The source catalog must contain exactly 59 tracks.');
  if (new Set(tracks.map(track => track.id)).size !== tracks.length || new Set(tracks.map(track => track.file)).size !== tracks.length) {
    throw new Error('Duplicate track IDs or audio filenames.');
  }
  for (const track of tracks) {
    if (typeof track.id !== 'string' || !track.id || !/^\d-\d{2}\.flac$/.test(track.file)) throw new Error('Invalid source track.');
  }
  const selected = tracks.filter(track => edition === 'full' || LITE_FILES.includes(track.file));
  if (edition === 'lite' && selected.length !== LITE_FILES.length) throw new Error('The Lite catalog is missing a required track.');
  if (!BGM_DEFAULT_LOOP.every(id => selected.some(track => track.id === id))) throw new Error('The edition is missing a default-loop track.');
  return selected.map(track => ({ ...track }));
}

function generateCatalog(source, tracks) {
  const declarations = [...source.matchAll(/(const BGM_TRACKS\s*=\s*)\[[\s\S]*?^\s*\];/gm)];
  if (declarations.length !== 1) throw new Error('Expected exactly one BGM_TRACKS declaration.');
  const declaration = declarations[0];
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const array = JSON.stringify(tracks, null, 2).replace(/\n/g, newline + '  ');
  return source.slice(0, declaration.index) + declaration[1] + array + ';' + source.slice(declaration.index + declaration[0].length);
}

function createBuildPlan({ edition, metadata, projectDirectory, workDirectory, catalogSource, tracks = BGM_TRACKS }) {
  projectDirectory = absoluteFDirectory(projectDirectory);
  workDirectory = absoluteFDirectory(workDirectory);
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(metadata.version)) throw new Error('Invalid release version.');
  const selected = selectTracks(edition, tracks);
  const label = edition === 'full' ? 'Full' : 'Lite';
  const stagingDirectory = path.join(workDirectory, edition, 'staging');
  const outputDirectory = path.join(workDirectory, edition, 'output');
  const artifactName = `GaiaReading_Lucky-${metadata.version}-Windows-x64-${label}.exe`;
  const base = JSON.parse(JSON.stringify(metadata.build));
  const config = {
    ...base,
    extends: null,
    directories: { ...base.directories, app: projectDirectory, output: outputDirectory },
    // A closed root whitelist excludes profiles, books, backups and build state.
    files: [
      { from: '.', to: '.', filter: ['src/**/*', 'assets/icon.png', 'package.json', 'LICENSE*', 'NOTICE*', 'THIRD_PARTY_NOTICES.md', '!src/shared/bgm.js', '!**/*.baiduyun.uploading.cfg', '!node_modules/canvas{,/**/*}'] },
      { from: 'assets/bgm', to: 'assets/bgm', filter: ['cover.jpg', ...selected.map(track => track.file)] },
      { from: stagingDirectory, to: 'src/shared', filter: ['bgm.js'] },
    ],
    extraFiles: [],
    extraResources: [],
    asarUnpack: ['assets/bgm/**'],
    win: { ...base.win, files: [], extraFiles: [], extraResources: [], target: ['portable'], artifactName },
    extraMetadata: { ...base.extraMetadata, gaiaPortable: { edition, trackCount: selected.length } },
    publish: null,
  };
  return {
    edition, tracks: selected, artifactName, stagingDirectory, outputDirectory, config,
    configPath: path.join(stagingDirectory, 'electron-builder.json'),
    catalogPath: path.join(stagingDirectory, 'bgm.js'),
    catalogSource: generateCatalog(catalogSource, selected),
  };
}

async function buildPortable(options) {
  const projectDirectory = requireFPath(path.resolve(__dirname, '..'), 'Development directory');
  // Fail before loading the builder or creating outputs if dev-env was omitted.
  for (const name of ['TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'npm_config_cache', 'NODE_COMPILE_CACHE', 'ELECTRON_CACHE', 'ELECTRON_BUILDER_CACHE', 'APP_BUILDER_TMP_DIR']) {
    requireFPath(process.env[name], name + ' (dot-source scripts/dev-env.ps1 first)');
  }
  const outputBase = requireFPath(options.output || path.join(projectDirectory, '.tmp'), 'Portable build output');
  const metadata = JSON.parse(fs.readFileSync(path.join(projectDirectory, 'package.json'), 'utf8'));
  const catalogSource = fs.readFileSync(path.join(projectDirectory, 'src/shared/bgm.js'), 'utf8');
  const editions = options.edition === 'all' ? ['full', 'lite'] : [options.edition];
  // Validate catalogs, cover and source audio before creating the workspace.
  for (const edition of editions) {
    for (const filename of ['cover.jpg', ...selectTracks(edition, BGM_TRACKS).map(track => track.file)]) {
      const asset = path.join(projectDirectory, 'assets/bgm', filename);
      if (!fs.lstatSync(asset).isFile()) throw new Error('Missing regular music asset: ' + asset);
    }
  }
  fs.mkdirSync(outputBase, { recursive: true });
  const workDirectory = requireFPath(fs.mkdtempSync(path.join(outputBase, 'portable-build-')), 'Portable build workspace');
  const builder = require('electron-builder');
  const results = [];
  for (const edition of editions) {
    const plan = createBuildPlan({ edition, metadata, projectDirectory, workDirectory, catalogSource });
    requireFPath(plan.stagingDirectory, 'Portable catalog staging');
    requireFPath(plan.outputDirectory, 'Portable edition output');
    fs.mkdirSync(plan.stagingDirectory, { recursive: true });
    fs.writeFileSync(plan.catalogPath, plan.catalogSource, { encoding: 'utf8', flag: 'wx' });
    fs.writeFileSync(plan.configPath, JSON.stringify(plan.config, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    // Inline API config unions arrays with package.build. A standalone config
    // file makes the three FileSets authoritative, including Lite exclusions.
    const artifacts = await builder.build({
      projectDir: projectDirectory, config: plan.configPath,
      targets: builder.Platform.WINDOWS.createTarget('portable', builder.Arch.x64), publish: 'never',
    });
    const expected = path.join(plan.outputDirectory, plan.artifactName);
    if (!fs.statSync(expected).isFile()) throw new Error('Portable artifact was not produced: ' + expected);
    results.push({ edition, trackCount: plan.tracks.length, artifact: expected, outputDirectory: plan.outputDirectory, artifacts });
  }
  return results;
}

if (require.main === module) {
  Promise.resolve().then(() => buildPortable(parseArgs(process.argv.slice(2))))
    .then(results => console.log(JSON.stringify(results, null, 2)))
    .catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
}

module.exports = { parseArgs, selectTracks, generateCatalog, createBuildPlan, buildPortable };
