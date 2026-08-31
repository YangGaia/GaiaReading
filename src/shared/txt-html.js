'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./txt-chapters'));
  } else {
    root.GaiaTxtHtml = factory(root.GaiaTxtChapters);
  }
})(typeof self !== 'undefined' ? self : this, function (txtChapters) {
  'use strict';

  const splitTxtParagraphs = (txtChapters && txtChapters.splitTxtParagraphs) || null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 把 TXT 文本转成分页阅读用的段落 HTML：
   * - 有空行：空行作为段落分隔，段内单个换行保留为 <br>
   * - 没有空行：每一行单独成段（常见于每段一行的小说 TXT）
   * - \r\n / \r 统一为 \n，并做 HTML 转义
   */
  function paragraphsToHtml(text) {
    if (!splitTxtParagraphs) {
      const normalized = String(text || '').replace(/\r\n?/g, '\n');
      const hasBlankLines = /\n\s*\n/.test(normalized);
      if (hasBlankLines) {
        const blocks = normalized.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
        return blocks
          .map((block) => {
            const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
            return '<p>' + lines.map(escapeHtml).join('<br>') + '</p>';
          })
          .join('');
      }
      const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
      return lines.map((line) => '<p>' + escapeHtml(line) + '</p>').join('');
    }
    return splitTxtParagraphs(text)
      .map((para) => '<p>' + para.split('\n').map(escapeHtml).join('<br>') + '</p>')
      .join('');
  }

  return { paragraphsToHtml };
});