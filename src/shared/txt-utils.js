'use strict';

const iconv = require('iconv-lite');

function isValidUtf8(buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function containsCjk(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function detectEncoding(buf) {
  if (buf.length >= 2) {
    if (buf[0] === 0xef && buf[1] === 0xbb) return 'utf8';
    if (buf[0] === 0xff && buf[1] === 0xfe) return 'utf16le';
    if (buf[0] === 0xfe && buf[1] === 0xff) return 'utf16be';
  }
  if (!isValidUtf8(buf)) return 'gbk';
  const utf8Text = iconv.decode(buf, 'utf8');
  const gbkText = iconv.decode(buf, 'gbk');
  if (containsCjk(utf8Text)) return 'utf8';
  if (containsCjk(gbkText)) return 'gbk';
  return 'utf8';
}

function decodeTxt(buf) {
  const encoding = detectEncoding(buf);
  let text;
  if (encoding === 'utf16le') {
    text = buf.subarray(2).toString('utf16le');
  } else if (encoding === 'utf16be') {
    const body = buf.subarray(2);
    const swapped = Buffer.alloc(body.length);
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    text = swapped.toString('utf16le');
  } else {
    text = iconv.decode(buf, encoding);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  }
  return { encoding, text };
}

function titleFromFilename(name) {
  return String(name).replace(/\.(epub|pdf|txt)$/i, '');
}

module.exports = { decodeTxt, detectEncoding, titleFromFilename };
