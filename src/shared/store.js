'use strict';

const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return {};
    }
  }

  save(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  get(key, fallback = null) {
    const data = this.load();
    return key in data ? data[key] : fallback;
  }

  set(key, value) {
    const data = this.load();
    data[key] = value;
    this.save(data);
  }
}

module.exports = { JsonStore };
