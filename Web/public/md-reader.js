/* ════════════════════════════════════════════════════════════════════
 * MarkdownReader — 独立 Markdown 渲染器组件
 * ════════════════════════════════════════════════════════════════════
 *
 * 高内聚低耦合设计：
 *   - 自包含的 Markdown → HTML 渲染引擎（零外部依赖）
 *   - 支持标题、段落、代码块(行内+多语言)、表格、列表、引用、链接、
 *     图片、分隔线、粗体/斜体/删除线/行内代码
 *   - 通过 MarkdownReader.open(title, markdownText) 调用
 *   - 不依赖任何外部库或全局状态，仅创建自己的 DOM overlay
 *
 * 用法:
 *   MarkdownReader.open('stepId1_loop0_result_0.md', markdownContent)
 *   MarkdownReader.close()
 */
'use strict';

var MarkdownReader = (function() {

    // ─── 私有: DOM 元素引用 ──────────────────────────────────────────
    var _overlay = null;
    var _titleEl = null;
    var _bodyEl  = null;
    var _toggleRawBtn = null;
    var _isRawMode = false;
    var _currentMarkdown = '';

    // ─── 私有: 初始化 DOM (惰性创建，首次调用时构建) ────────────────
    function _ensureDOM() {
        if (_overlay) return;

        _overlay = document.createElement('div');
        _overlay.className = 'md-reader-overlay';

        var dialog = document.createElement('div');
        dialog.className = 'md-reader-dialog';

        // Header
        var header = document.createElement('div');
        header.className = 'md-reader-header';

        _titleEl = document.createElement('h3');
        _titleEl.className = 'md-reader-title';

        var headerRight = document.createElement('div');
        headerRight.className = 'md-reader-header-right';

        _toggleRawBtn = document.createElement('button');
        _toggleRawBtn.className = 'md-reader-btn-raw';
        _toggleRawBtn.textContent = '📄 源码';
        _toggleRawBtn.title = '切换源码/渲染视图';
        _toggleRawBtn.onclick = _toggleRaw;

        var closeBtn = document.createElement('button');
        closeBtn.className = 'md-reader-close';
        closeBtn.textContent = '✕';
        closeBtn.title = '关闭';
        closeBtn.onclick = MarkdownReader.close;

        headerRight.appendChild(_toggleRawBtn);
        headerRight.appendChild(closeBtn);
        header.appendChild(_titleEl);
        header.appendChild(headerRight);

        // Body
        _bodyEl = document.createElement('div');
        _bodyEl.className = 'md-reader-body';

        dialog.appendChild(header);
        dialog.appendChild(_bodyEl);
        _overlay.appendChild(dialog);

        // 点击遮罩关闭
        _overlay.addEventListener('click', function(e) {
            if (e.target === _overlay) MarkdownReader.close();
        });

        // ESC 关闭
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && _overlay && _overlay.classList.contains('show')) {
                MarkdownReader.close();
            }
        });

        document.body.appendChild(_overlay);
    }

    // ─── 私有: 切换源码/渲染模式 ─────────────────────────────────────
    function _toggleRaw() {
        _isRawMode = !_isRawMode;
        _toggleRawBtn.textContent = _isRawMode ? '🎨 渲染' : '📄 源码';
        _renderContent();
    }

    function _renderContent() {
        if (_isRawMode) {
            _bodyEl.innerHTML = '<pre class="md-reader-raw">' + _escapeHtml(_currentMarkdown) + '</pre>';
        } else {
            _bodyEl.innerHTML = _renderMarkdown(_currentMarkdown);
            _postProcess();
        }
    }

    // ─── 私有: HTML 转义 ─────────────────────────────────────────────
    function _escapeHtml(text) {
        if (!text) return '';
        var d = document.createElement('div');
        d.textContent = String(text);
        return d.innerHTML;
    }

    // ════════════════════════════════════════════════════════════════
    // Markdown 渲染引擎
    // ════════════════════════════════════════════════════════════════

    function _renderMarkdown(md) {
        if (!md) return '<p class="md-muted">暂无内容</p>';
        md = String(md);

        // 1. 提取代码块（保护内容不被后续处理破坏）
        var codeBlocks = [];
        md = md.replace(/```(\w*)\n?([\s\S]*?)```/g, function(match, lang, code) {
            var idx = codeBlocks.length;
            codeBlocks.push({ lang: lang || '', code: code.replace(/\n$/, '') });
            return '\u0000CODEBLOCK' + idx + '\u0000';
        });

        // 2. HTML 转义剩余文本
        md = _escapeHtml(md);

        // 3. 提取表格（在行处理前）
        md = _processTables(md);

        // 4. 按行处理块级元素
        var lines = md.split('\n');
        var html = [];
        var i = 0;

        while (i < lines.length) {
            var line = lines[i];

            // 代码块占位符（单独一行）
            var cbMatch = line.match(/^\u0000CODEBLOCK(\d+)\u0000$/);
            if (cbMatch) {
                var cb = codeBlocks[Number(cbMatch[1])];
                html.push(_renderCodeBlock(cb.code, cb.lang));
                i++;
                continue;
            }

            // 标题 h1-h6
            var hMatch = line.match(/^(#{1,6})\s+(.*)$/);
            if (hMatch) {
                var level = hMatch[1].length;
                var text = _renderInline(hMatch[2]);
                html.push('<h' + level + ' class="md-h md-h' + level + '">' + text + '</h' + level + '>');
                i++;
                continue;
            }

            // 分隔线
            if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
                html.push('<hr class="md-hr">');
                i++;
                continue;
            }

            // 引用块（连续 > 开头）
            if (/^>\s?/.test(line)) {
                var quoteLines = [];
                while (i < lines.length && /^>\s?/.test(lines[i])) {
                    quoteLines.push(lines[i].replace(/^>\s?/, ''));
                    i++;
                }
                html.push('<blockquote class="md-quote">' + _renderInline(quoteLines.join('\n')) + '</blockquote>');
                continue;
            }

            // 无序列表（- * +）
            if (/^(\s*)[-*+]\s+/.test(line)) {
                var ulItems = [];
                var ulIndent = 0;
                while (i < lines.length) {
                    var ulMatch = lines[i].match(/^(\s*)([-*+])\s+(.*)$/);
                    if (ulMatch) {
                        var indent = ulMatch[1].length;
                        if (ulItems.length === 0) ulIndent = indent;
                        if (indent === ulIndent) {
                            ulItems.push({ text: ulMatch[3], sub: [] });
                        } else if (indent > ulIndent && ulItems.length > 0) {
                            ulItems[ulItems.length - 1].sub.push(ulMatch[3]);
                        }
                        i++;
                    } else if (lines[i].trim() === '' && i + 1 < lines.length && /^(\s*)[-*+]\s+/.test(lines[i + 1])) {
                        i++; // 列表内空行
                    } else {
                        break;
                    }
                }
                html.push('<ul class="md-ul">' + ulItems.map(function(item) {
                    var sub = item.sub.length > 0
                        ? '<ul class="md-ul md-ul-sub">' + item.sub.map(function(s) { return '<li>' + _renderInline(s) + '</li>'; }).join('') + '</ul>'
                        : '';
                    return '<li>' + _renderInline(item.text) + sub + '</li>';
                }).join('') + '</ul>');
                continue;
            }

            // 有序列表（1. 2. 等）
            if (/^\d+\.\s+/.test(line)) {
                var olItems = [];
                while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
                    olItems.push(lines[i].replace(/^\d+\.\s+/, ''));
                    i++;
                }
                html.push('<ol class="md-ol">' + olItems.map(function(t) { return '<li>' + _renderInline(t) + '</li>'; }).join('') + '</ol>');
                continue;
            }

            // 空行
            if (line.trim() === '') {
                i++;
                continue;
            }

            // 普通段落（连续非空非特殊行合并）
            var paraLines = [];
            while (i < lines.length
                && lines[i].trim() !== ''
                && !/^#{1,6}\s/.test(lines[i])
                && !/^>\s?/.test(lines[i])
                && !/^[-*+]\s+/.test(lines[i])
                && !/^\d+\.\s+/.test(lines[i])
                && !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
                && !/^\u0000CODEBLOCK/.test(lines[i])
                && !/^\|/.test(lines[i])
            ) {
                // 检查是否是代码块占位符
                var inlineCb = lines[i].match(/^\u0000CODEBLOCK(\d+)\u0000$/);
                if (inlineCb) {
                    if (paraLines.length > 0) break;
                    var cb2 = codeBlocks[Number(inlineCb[1])];
                    html.push(_renderCodeBlock(cb2.code, cb2.lang));
                    i++;
                    paraLines = null;
                    break;
                }
                paraLines.push(lines[i]);
                i++;
            }
            if (paraLines && paraLines.length > 0) {
                html.push('<p class="md-p">' + _renderInline(paraLines.join(' ')) + '</p>');
            }
        }

        // 5. 还原代码块占位符（如果上面未处理到）
        var result = html.join('\n');
        result = result.replace(/\u0000CODEBLOCK(\d+)\u0000/g, function(match, idx) {
            var cb = codeBlocks[Number(idx)];
            return _renderCodeBlock(cb.code, cb.lang);
        });

        return result;
    }

    // ─── 表格处理 ─────────────────────────────────────────────────────
    function _processTables(text) {
        var lines = text.split('\n');
        var result = [];
        var i = 0;

        while (i < lines.length) {
            if (/^\|/.test(lines[i]) && i + 1 < lines.length && /^\|[\s:|-]+\|/.test(lines[i + 1])) {
                // 收集表格行
                var tableLines = [];
                while (i < lines.length && /^\|/.test(lines[i])) {
                    tableLines.push(lines[i]);
                    i++;
                }
                result.push(_renderTable(tableLines));
            } else {
                result.push(lines[i]);
                i++;
            }
        }

        return result.join('\n');
    }

    function _renderTable(tableLines) {
        if (tableLines.length < 2) return tableLines.join('\n');

        var parseRow = function(line) {
            return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(function(c) { return c.trim(); });
        };

        var headers = parseRow(tableLines[0]);
        var aligns = parseRow(tableLines[1]).map(function(spec) {
            if (/^:/.test(spec) && /:$/.test(spec)) return 'center';
            if (/:$/.test(spec)) return 'right';
            return 'left';
        });

        var bodyRows = tableLines.slice(2).map(parseRow);

        var html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
        headers.forEach(function(h, idx) {
            html += '<th style="text-align:' + (aligns[idx] || 'left') + '">' + _renderInline(h) + '</th>';
        });
        html += '</tr></thead><tbody>';
        bodyRows.forEach(function(row) {
            html += '<tr>';
            row.forEach(function(cell, idx) {
                html += '<td style="text-align:' + (aligns[idx] || 'left') + '">' + _renderInline(cell) + '</td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table></div>';

        return html;
    }

    // ─── 代码块渲染 ───────────────────────────────────────────────────
    function _renderCodeBlock(code, lang) {
        var langLabel = lang ? '<span class="md-code-lang">' + _escapeHtml(lang) + '</span>' : '';
        var copyBtn = '<button class="md-code-copy" data-code="' + encodeURIComponent(code) + '">复制</button>';
        return '<div class="md-code-block">' +
            '<div class="md-code-header">' + langLabel + copyBtn + '</div>' +
            '<pre><code>' + _escapeHtml(code) + '</code></pre>' +
            '</div>';
    }

    // ─── 行内元素渲染 ─────────────────────────────────────────────────
    function _renderInline(text) {
        if (!text) return '';

        // 行内代码（先处理，保护内容）
        var inlineCodes = [];
        text = text.replace(/`([^`]+)`/g, function(match, code) {
            var idx = inlineCodes.length;
            inlineCodes.push(code);
            return '\u0001INLINECODE' + idx + '\u0001';
        });

        // 图片 ![alt](url)
        text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(match, alt, url) {
            return '<img class="md-img" src="' + _escapeAttr(url) + '" alt="' + _escapeAttr(alt) + '" loading="lazy">';
        });

        // 链接 [text](url)
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(match, linkText, url) {
            return '<a class="md-link" href="' + _escapeAttr(url) + '" target="_blank" rel="noopener">' + _renderInline(linkText) + '</a>';
        });

        // 粗体+斜体 ***text***
        text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
        // 粗体 **text**
        text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // 斜体 *text*
        text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
        // 删除线 ~~text~~
        text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

        // 还原行内代码
        text = text.replace(/\u0001INLINECODE(\d+)\u0001/g, function(match, idx) {
            return '<code class="md-inline-code">' + _escapeHtml(inlineCodes[Number(idx)]) + '</code>';
        });

        return text;
    }

    function _escapeAttr(text) {
        return String(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ─── 后处理: 代码复制按钮事件绑定 ─────────────────────────────────
    function _postProcess() {
        if (!_bodyEl) return;
        var copyBtns = _bodyEl.querySelectorAll('.md-code-copy');
        copyBtns.forEach(function(btn) {
            btn.onclick = function() {
                var code = decodeURIComponent(btn.getAttribute('data-code'));
                try {
                    navigator.clipboard.writeText(code);
                    btn.textContent = '✓ 已复制';
                    setTimeout(function() { btn.textContent = '复制'; }, 2000);
                } catch(e) {
                    btn.textContent = '✗ 失败';
                    setTimeout(function() { btn.textContent = '复制'; }, 2000);
                }
            };
        });
    }

    // ════════════════════════════════════════════════════════════════
    // 公开 API
    // ════════════════════════════════════════════════════════════════

    return {
        /**
         * 打开 Markdown 阅读器，渲染指定内容。
         * @param {string} title - 标题（通常为文件名）
         * @param {string} markdown - Markdown 文本
         */
        open: function(title, markdown) {
            _ensureDOM();
            _titleEl.textContent = title || 'Markdown 阅读器';
            _currentMarkdown = markdown || '';
            _isRawMode = false;
            _toggleRawBtn.textContent = '📄 源码';
            _renderContent();
            _overlay.classList.add('show');
        },

        /**
         * 关闭阅读器。
         */
        close: function() {
            if (_overlay) _overlay.classList.remove('show');
        },

        /**
         * 仅渲染 Markdown 为 HTML 字符串（不打开弹窗）。
         * 供外部需要嵌入渲染结果的场景使用。
         * @param {string} markdown
         * @returns {string} HTML 字符串
         */
        render: function(markdown) {
            return _renderMarkdown(markdown);
        }
    };
})();
