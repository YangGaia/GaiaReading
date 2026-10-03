'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { KEY_FILE_NAME, LEGACY_KEY_FILE_NAME, migrateLegacyDataFiles } = require('../src/shared/app-paths');

const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const secretsSource = main.slice(main.indexOf('function readAiSecrets()'), main.indexOf('function migrateLegacyAiProfile()'));

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'GaiaReading_Lucky-secrets-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  // A deterministic safeStorage stand-in verifies the persistence flow without
  // reading any OS credential store or using a real API key.
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from('protected-test:' + Buffer.from(text).toString('base64')),
    decryptString: (bytes) => {
      const encoded = bytes.toString();
      assert.ok(encoded.startsWith('protected-test:'));
      return Buffer.from(encoded.slice('protected-test:'.length), 'base64').toString();
    },
  };
  function restart() {
    const context = vm.createContext({ fs, path, safeStorage, aiSecretFile: () => path.join(directory, KEY_FILE_NAME) });
    vm.runInContext(secretsSource, context);
    return context;
  }
  return { directory, safeStorage, restart };
}

test('清空最后一个 API Key 后再次迁移旧备份不会恢复已删除的密钥', (t) => {
  const { directory, safeStorage, restart } = fixture(t);
  const original = safeStorage.encryptString(JSON.stringify({ 'profile-legacy': 'test-old-key' }));
  const legacy = path.join(directory, LEGACY_KEY_FILE_NAME);
  const current = path.join(directory, KEY_FILE_NAME);
  fs.writeFileSync(legacy, original);
  migrateLegacyDataFiles(directory);
  const first = restart();
  assert.equal(first.readAiSecret('profile-legacy'), 'test-old-key');
  first.writeAiSecret('profile-legacy', '');

  migrateLegacyDataFiles(directory);
  const afterRestart = restart();
  assert.equal(afterRestart.readAiSecret('profile-legacy'), '', '用户清空的密钥不能在下次启动时从旧备份复活');
  assert.deepEqual(JSON.parse(safeStorage.decryptString(fs.readFileSync(current))), {});
  assert.deepEqual(fs.readFileSync(legacy), original, '兼容备份保持逐字节不变');
});

test('清空单个接口的密钥保留其他接口，安全存储不可用时不改写现有文件', (t) => {
  const { directory, safeStorage, restart } = fixture(t);
  const runtime = restart();
  runtime.writeAiSecret('first', 'test-first-key');
  runtime.writeAiSecret('second', 'test-second-key');
  runtime.writeAiSecret('first', '');
  assert.equal(runtime.readAiSecret('first'), '');
  assert.equal(runtime.readAiSecret('second'), 'test-second-key');
  const current = path.join(directory, KEY_FILE_NAME);
  const protectedBytes = fs.readFileSync(current);
  safeStorage.isEncryptionAvailable = () => false;
  assert.throws(() => runtime.writeAiSecrets({}), /安全存储当前不可用/);
  assert.deepEqual(fs.readFileSync(current), protectedBytes);
});
