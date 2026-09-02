/*
 * Minimal markdown renderer. Deliberately dependency-free so the lab works
 * offline and behind corporate proxies.
 * Supports: headings, fenced code, lists, tables, blockquotes, hr,
 * bold/italic/inline-code/links, paragraphs.
 */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
  }

  function inline(text) {
    var out = escapeHtml(text);
    var codes = [];
    out = out.replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c);
      return '\u0000CODE' + (codes.length - 1) + '\u0000';
    });
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/\u0000CODE(\d+)\u0000/g, function (_, i) {
      return '<code>' + codes[+i] + '</code>';
    });
    return out;
  }

  function splitRow(line) {
    return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) {
      return c.trim();
    });
  }

  function render(md) {
    if (!md) return '';
    var lines = md.replace(/\r\n/g, '\n').split('\n');
    var html = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      var fence = line.match(/^\s*```(\S*)\s*$/);
      if (fence) {
        var lang = fence[1] || '';
        var buf = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++;
        html.push('<pre><code class="lang-' + escapeHtml(lang) + '">' +
                  escapeHtml(buf.join('\n')) + '</code></pre>');
        continue;
      }

      if (!line.trim()) { i++; continue; }

      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        var lvl = h[1].length;
        html.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>');
        i++;
        continue;
      }

      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html.push('<hr>');
        i++;
        continue;
      }

      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1])) {
        var header = splitRow(line.trim());
        i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          rows.push(splitRow(lines[i].trim()));
          i++;
        }
        var t = '<table><thead><tr>';
        header.forEach(function (c) { t += '<th>' + inline(c) + '</th>'; });
        t += '</tr></thead><tbody>';
        rows.forEach(function (r) {
          t += '<tr>';
          for (var c = 0; c < header.length; c++) {
            t += '<td>' + inline(r[c] || '') + '</td>';
          }
          t += '</tr>';
        });
        html.push(t + '</tbody></table>');
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        var quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        html.push('<blockquote>' + render(quote.join('\n')) + '</blockquote>');
        continue;
      }

      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        var ordered = /^\s*\d+\.\s+/.test(line);
        var tag = ordered ? 'ol' : 'ul';
        var items = [];
        while (i < lines.length && (/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) ||
               (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          var m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
          if (m) {
            items.push({ indent: m[1].length, text: m[3] });
          } else if (items.length) {
            items[items.length - 1].text += ' ' + lines[i].trim();
          }
          i++;
        }
        var base = Math.min.apply(null, items.map(function (it) { return it.indent; }));
        var out = '<' + tag + '>';
        var open = false;
        var nested = false;
        items.forEach(function (it) {
          if (it.indent > base) {
            if (!nested) { out += '<ul>'; nested = true; }
            out += '<li>' + inline(it.text) + '</li>';
          } else {
            if (nested) { out += '</ul>'; nested = false; }
            if (open) out += '</li>';
            out += '<li>' + inline(it.text);
            open = true;
          }
        });
        if (nested) out += '</ul>';
        if (open) out += '</li>';
        html.push(out + '</' + tag + '>');
        continue;
      }

      var para = [];
      while (i < lines.length && lines[i].trim() &&
             !/^\s*```/.test(lines[i]) &&
             !/^(#{1,6})\s+/.test(lines[i]) &&
             !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
             !/^\s*>/.test(lines[i]) &&
             !/^\s*\|/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      if (para.length) html.push('<p>' + inline(para.join(' ')) + '</p>');
    }

    return html.join('\n');
  }

  global.md = { render: render, escapeHtml: escapeHtml };
})(window);
