'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaTxtHtml = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 把 TXT 文本转成分页阅读用的段落 HTML：
   * - 空行（连续两个以上换行）作为段落分隔
   * - 段内的单个换行保留为 <br>，避免整本书被合并成一大段
   * - \r\n / \r 统一为 \n，并做 HTML 转义
   */
  function paragraphsToHtml(text) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    const blocks = normalized.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    if (!blocks.length) return '';
    return blocks
      .map((block) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        return '<p>' + lines.map(escapeHtml).join('<br>') + '</p>';
      })
      .join('');
  }

  return { paragraphsToHtml };
});