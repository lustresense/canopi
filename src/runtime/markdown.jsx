/*
 * Lightweight, zero-dependency Markdown renderer for canoPi message bodies.
 *
 * parseBlocks()/parseInline() are pure: they turn text into a small node tree
 * of plain objects/strings. The Markdown component walks that tree into React
 * elements only — no HTML strings, no dangerouslySetInnerHTML, so hostile
 * message text can never inject markup.
 *
 * Supported: headings (#, ##, ###, …), fenced code blocks, inline code,
 * bold (**x** / __x__), italic (*x* / _x_), strikethrough (~~x~~),
 * links ([label](url) + bare URLs), unordered/ordered lists, task lists,
 * tables, horizontal rules, blockquotes, paragraphs with hard line breaks.
 */
import React, { useMemo } from 'react';

/* Order matters: code spans, inline math ($...$), then links, bare URLs, strikethrough,
 * then ** / __ bold, then * / _ italic. `_italic_` refuses intra-word
 * matches so snake_case identifiers survive. */
const INLINE_RE = /(`+)([\s\S]*?)\1|\$([^\$\n]+?)\$|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<]+)|~~([^~\n]+)~~|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\n]+?)\*|(?<![\w])_([^_\n]+?)_(?![\w])/g;

/* Only http(s), mailto and relative paths may reach href. Anything with
 * another scheme (javascript:, data:, vbscript:, …) is rejected outright;
 * the scheme test runs on a whitespace-stripped copy so control-character
 * smuggling (`java\nscript:`) is caught too. */
export function safeUrl(raw) {
  const u = String(raw == null ? '' : raw).trim();
  if (!u) return null;
  const probe = u.replace(/[\s\u0000-\u001f]+/g, '');
  if (/^(https?:\/\/|mailto:)/i.test(probe)) return u;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(probe)) return null; /* any other scheme */
  if (probe.startsWith('//')) return null; /* protocol-relative */
  return u; /* relative path */
}

export function parseInline(src) {
  const out = [];
  const s = String(src == null ? '' : src);
  if (!s) return out;
  const re = new RegExp(INLINE_RE.source, 'g');
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push({ type: 'code', text: m[2] });
    else if (m[3] !== undefined) out.push({ type: 'math', text: m[3] });
    else if (m[4] !== undefined) out.push({ type: 'link', href: m[5], children: parseInline(m[4]) });
    else if (m[6] !== undefined) out.push({ type: 'link', href: m[6], children: [m[6]] });
    else if (m[7] !== undefined) out.push({ type: 'del', children: parseInline(m[7]) });
    else if (m[8] !== undefined) out.push({ type: 'strong', children: parseInline(m[8]) });
    else if (m[9] !== undefined) out.push({ type: 'strong', children: parseInline(m[9]) });
    else if (m[10] !== undefined) out.push({ type: 'em', children: parseInline(m[10]) });
    else out.push({ type: 'em', children: parseInline(m[11]) });
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/* ------------------------------- blocks ---------------------------------- */
const RE_BLANK = /^\s*$/;
const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_QUOTE = /^\s*>\s?(.*)$/;
const RE_UL = /^\s*[-*+]\s+(.*)$/;
const RE_OL = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const RE_FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const RE_HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const RE_TABLE_DELIM = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/;
const RE_TABLE_ROW = /[^|]*\|/;
const RE_TASK = /^\[([ xX])\]\s+(.*)$/;
const RE_MATH_BLOCK_SINGLE = /^\s*\$\$([\s\S]+?)\$\$\s*$/;
const RE_MATH_BLOCK_OPEN = /^\s*\$\$\s*$/;
const RE_DETAILS_OPEN = /^\s*<details(?:\s+open)?>/i;
const RE_DETAILS_CLOSE = /^\s*<\/details>\s*$/i;
const RE_SUMMARY = /<summary>([\s\S]*?)<\/summary>/i;

/* Split one table row into trimmed cells; outer pipes optional, `\|` escapes. */
function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.replace(/\\\|/g, '|').trim());
}

function alignOf(delimiterCell) {
  const left = delimiterCell.startsWith(':');
  const right = delimiterCell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

const startsBlock = ln =>
  RE_FENCE_OPEN.test(ln) || RE_HEADING.test(ln) || RE_HR.test(ln) || RE_QUOTE.test(ln) || RE_UL.test(ln) || RE_OL.test(ln);

export function parseBlocks(content) {
  const lines = String(content == null ? '' : content).split(/\r\n|\r|\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (RE_BLANK.test(line)) { i++; continue; }

    const fence = RE_FENCE_OPEN.exec(line);
    if (fence) {
      const closer = new RegExp('^\\s*' + (fence[1][0] === '~' ? '~{3,}' : '`{3,}') + '\\s*$');
      const lang = fence[2] || '';
      i++;
      const buf = [];
      while (i < lines.length && !closer.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < lines.length) i++; /* consume closing fence (EOF if unclosed) */
      blocks.push({ type: 'code', lang, text: buf.join('\n') });
      continue;
    }

    const heading = RE_HEADING.exec(line);
    if (heading) { blocks.push({ type: 'h', level: heading[1].length, text: heading[2].trim() }); i++; continue; }

    if (RE_HR.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

    /* GFM table: header row immediately followed by a delimiter row;
     * header/delimiter cell counts must match or it stays a paragraph. */
    if (RE_TABLE_ROW.test(line) && i + 1 < lines.length && RE_TABLE_DELIM.test(lines[i + 1])) {
      const headers = splitTableRow(line);
      const delims = splitTableRow(lines[i + 1]);
      if (headers.length && headers.length === delims.length) {
        const aligns = delims.map(alignOf);
        i += 2;
        const rows = [];
        while (i < lines.length && !RE_BLANK.test(lines[i]) && lines[i].includes('|')) {
          const row = splitTableRow(lines[i]);
          while (row.length < headers.length) row.push('');
          rows.push(row.slice(0, headers.length));
          i++;
        }
        blocks.push({ type: 'table', headers, aligns, rows });
        continue;
      }
    }

    /* Block math: $$...$$ on single line or multi-line */
    const mathSingle = RE_MATH_BLOCK_SINGLE.exec(line);
    if (mathSingle) {
      blocks.push({ type: 'math', text: mathSingle[1].trim() });
      i++;
      continue;
    }
    if (RE_MATH_BLOCK_OPEN.test(line)) {
      i++;
      const buf = [];
      while (i < lines.length && !RE_MATH_BLOCK_OPEN.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < lines.length) i++;
      blocks.push({ type: 'math', text: buf.join('\n').trim() });
      continue;
    }

    /* HTML <details> / <summary> */
    const detailsOpen = RE_DETAILS_OPEN.exec(line);
    if (detailsOpen) {
      const isOpen = /open/i.test(detailsOpen[0]);
      i++;
      const buf = [];
      while (i < lines.length && !RE_DETAILS_CLOSE.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < lines.length) i++;
      const fullContent = buf.join('\n');
      const summaryMatch = RE_SUMMARY.exec(fullContent);
      const summary = summaryMatch ? summaryMatch[1].trim() : '';
      const content = fullContent.replace(RE_SUMMARY, '').trim();
      blocks.push({ type: 'details', open: isOpen, summary, content });
      continue;
    }

    if (RE_UL.test(line)) {
      const items = [];
      let m;
      let isTask = false;
      while (i < lines.length && (m = RE_UL.exec(lines[i]))) {
        const itemText = m[1].trim();
        if (RE_TASK.test(itemText)) isTask = true;
        items.push(itemText);
        i++;
      }
      blocks.push({ type: 'ul', isTask, items });
      continue;
    }

    if (RE_OL.test(line)) {
      const items = [];
      let start = 1;
      let m;
      while (i < lines.length && (m = RE_OL.exec(lines[i]))) {
        if (!items.length) start = parseInt(m[1], 10) || 1;
        items.push(m[2].trim());
        i++;
      }
      blocks.push({ type: 'ol', start, items });
      continue;
    }

    const para = [line];
    i++;
    while (i < lines.length && !RE_BLANK.test(lines[i]) && !startsBlock(lines[i])) { para.push(lines[i]); i++; }
    blocks.push({ type: 'p', lines: para });
  }
  return blocks;
}

/* ------------------------------- render ---------------------------------- */
function inline(nodes, key) {
  return nodes.map((n, idx) => {
    const k = `${key}.${idx}`;
    if (typeof n === 'string') return n;
    if (n.type === 'code') return <code key={k}>{n.text}</code>;
    if (n.type === 'math') return <code key={k} className="md-math-inline">{n.text}</code>;
    if (n.type === 'strong') return <strong key={k}>{inline(n.children, k)}</strong>;
    if (n.type === 'em') return <em key={k}>{inline(n.children, k)}</em>;
    if (n.type === 'del') return <del key={k}>{inline(n.children, k)}</del>;
    if (n.type === 'link') {
      const href = safeUrl(n.href);
      if (!href) return <span key={k}>{inline(n.children, k)}</span>; /* hostile scheme: text only */
      return <a key={k} href={href} target="_blank" rel="noopener noreferrer">{inline(n.children, k)}</a>;
    }
    return String(n);
  });
}

function renderBlock(b, key) {
  switch (b.type) {
    case 'h': {
      const Tag = `h${Math.min(Math.max(b.level, 1), 6)}`;
      return <Tag key={key}>{inline(parseInline(b.text), `${key}.t`)}</Tag>;
    }
    case 'code':
      if (b.lang === 'diff') {
        const lines = b.text.split('\n');
        return (
          <pre key={key} data-lang="diff">
            <code>{lines.map((line, li) => {
              if (line.startsWith('+') && !line.startsWith('+++')) {
                return <span key={li} className="diff-add">{line}{'\n'}</span>;
              }
              if (line.startsWith('-') && !line.startsWith('---')) {
                return <span key={li} className="diff-del">{line}{'\n'}</span>;
              }
              return <span key={li}>{line}{'\n'}</span>;
            })}</code>
          </pre>
        );
      }
      return <pre key={key} data-lang={b.lang || undefined}><code>{b.text}</code></pre>;
    case 'hr':
      return <hr key={key} className="md-hr" />;
    case 'p':
      return (
        <p key={key}>
          {b.lines.map((ln, idx) => (
            <React.Fragment key={`${key}.${idx}`}>{idx > 0 ? <br /> : null}{inline(parseInline(ln), `${key}.${idx}`)}</React.Fragment>
          ))}
        </p>
      );
    case 'ul':
      return (
        <ul key={key} className={b.isTask ? "task-list" : undefined}>
          {b.items.map((it, idx) => {
            const k = `${key}.${idx}`;
            const task = RE_TASK.exec(it);
            if (task) {
              const checked = task[1] !== ' ';
              return (
                <li key={k} className="task-list-item">
                  <input type="checkbox" checked={checked} disabled readOnly />
                  {' '}{inline(parseInline(task[2]), k)}
                </li>
              );
            }
            return <li key={k}>{inline(parseInline(it), k)}</li>;
          })}
        </ul>
      );
    case 'ol':
      return <ol key={key} start={b.start}>{b.items.map((it, idx) => <li key={`${key}.${idx}`}>{inline(parseInline(it), `${key}.${idx}`)}</li>)}</ol>;
    case 'table':
      return (
        <div key={key} className="table-wrap">
          <table className="md-table">
            <thead>
              <tr>{b.headers.map((h, ci) => (
                <th key={ci} style={{ textAlign: b.aligns[ci] }}>{inline(parseInline(h), `${key}.h${ci}`)}</th>
              ))}</tr>
            </thead>
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri}>{row.map((cell, ci) => (
                  <td key={ci} style={{ textAlign: b.aligns[ci] }}>{inline(parseInline(cell), `${key}.${ri}.${ci}`)}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'quote':
      return <blockquote key={key}>{b.blocks.map((bb, idx) => renderBlock(bb, `${key}.${idx}`))}</blockquote>;
    case 'math':
      return <div key={key} className="md-math" tabIndex={0} role="region" aria-label="Math formula"><code>{b.text}</code></div>;
    case 'details':
      return (
        <details key={key} className="md-details" open={b.open || undefined}>
          <summary>{inline(parseInline(b.summary), `${key}.s`)}</summary>
          <div className="md-details-body">{parseBlocks(b.content).map((cb, ci) => renderBlock(cb, `${key}.b${ci}`))}</div>
        </details>
      );
    default:
      return null;
  }
}

export function Markdown({ content }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  return <>{blocks.map((b, idx) => renderBlock(b, String(idx)))}</>;
}

export default Markdown;
