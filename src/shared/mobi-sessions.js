'use strict';

const fs = require('fs');
const path = require('path');

function sessionError(message, code) {
  return Object.assign(new Error(message), { code });
}

class MobiSessions {
  constructor({ fork, tempRoot, timeoutMs = 30000 }) {
    this.fork = fork;
    this.tempRoot = path.resolve(tempRoot);
    this.timeoutMs = timeoutMs;
    this.sessions = new Map();
    this.cleanups = new Set();
    this.sequence = 0;
    fs.mkdirSync(this.tempRoot, { recursive: true });
  }

  async open(filePath, owner) {
    void this.closeOwner(owner);
    const id = 'mobi-' + (++this.sequence);
    const directory = fs.mkdtempSync(path.join(this.tempRoot, 'book-'));
    const session = { id, owner, directory, child: null, ready: false, closed: false, sequence: 0, pending: new Map() };
    this.sessions.set(id, session);
    let finishCleanup;
    session.cleaned = new Promise(resolve => { finishCleanup = resolve; });
    this.cleanups.add(session.cleaned);
    let cleaning = false;
    const cleanup = async () => {
      if (cleaning) return;
      cleaning = true;
      try {
        if (path.dirname(directory) === this.tempRoot && path.basename(directory).startsWith('book-')) {
          await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        }
      } catch (error) { console.error('MOBI_RESOURCE_CLEANUP_FAILED', error.message); }
      this.cleanups.delete(session.cleaned);
      finishCleanup();
    };
    try {
      const child = this.fork();
      session.child = child;
      child.on('message', message => {
        if (session.closed || !message) return;
        const pending = session.pending.get(message.id);
        if (!pending) return;
        session.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(sessionError(message.error, 'MOBI_PARSE_FAILED'));
        else pending.resolve(message.value);
      });
      child.once('spawn', () => {
        session.ready = true;
        if (session.closed) { child.kill(); return; }
        for (const pending of session.pending.values()) this.send(session, pending);
      });
      child.once('error', error => {
        this.terminate(session, error);
        if (!child.pid) void cleanup();
      });
      const exited = code => {
        this.terminate(session, sessionError('图书解析进程意外退出（' + code + '），请重新打开', 'MOBI_WORKER_EXIT'));
        void cleanup();
      };
      child.once('exit', exited);
      child.once('close', exited);
      const opened = await this.request(id, owner, 'open', { filePath, directory });
      return { ...opened, sessionId: id };
    } catch (error) {
      this.terminate(session, error);
      if (!session.child) void cleanup();
      throw error;
    }
  }

  send(session, pending) {
    try { session.child.postMessage(pending.message); }
    catch (error) { this.terminate(session, error); }
  }

  request(id, owner, method, payload) {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner || session.closed) {
      return Promise.reject(sessionError('MOBI 会话已失效，请重新打开', 'MOBI_SESSION_CLOSED'));
    }
    return new Promise((resolve, reject) => {
      const requestId = ++session.sequence;
      const pending = { resolve, reject, message: { id: requestId, method, payload } };
      pending.timer = setTimeout(() => {
        this.terminate(session, sessionError('图书解析超时，已停止解析；可返回书架或重新打开', 'MOBI_TIMEOUT'));
      }, this.timeoutMs);
      session.pending.set(requestId, pending);
      if (session.ready) this.send(session, pending);
    });
  }

  terminate(session, error = sessionError('已取消图书解析', 'MOBI_CANCELLED')) {
    if (session.closed) return;
    session.closed = true;
    this.sessions.delete(session.id);
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    session.pending.clear();
    if (session.child) {
      try { session.child.kill(); } catch (failure) { console.error('MOBI_WORKER_STOP_FAILED', failure.message); }
    }
  }

  closeSession(id, owner) {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) return Promise.resolve();
    this.terminate(session);
    return session.cleaned;
  }

  closeOwner(owner) {
    const pending = [];
    for (const session of this.sessions.values()) {
      if (session.owner === owner) pending.push(this.closeSession(session.id, owner));
    }
    return Promise.all(pending);
  }

  close() {
    for (const session of this.sessions.values()) this.terminate(session);
    return Promise.all(this.cleanups);
  }
}

module.exports = { MobiSessions };
