'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');

async function bookFileStat(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function sameBookFileStat(before, after) {
  return !!before && !!after && before.dev === after.dev && before.ino === after.ino &&
    before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

async function inspectBookFile(filePath, { signal } = {}) {
  const before = await bookFileStat(filePath);
  if (!before) throw new Error('无法找到所选的电子书文件。');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath, { signal })) hash.update(chunk);
  const stat = await bookFileStat(filePath);
  if (!sameBookFileStat(before, stat)) throw new Error('电子书文件在校验时发生变化，请重新选择。');
  return { fingerprint: hash.digest('hex'), stat };
}

module.exports = { bookFileStat, sameBookFileStat, inspectBookFile };
