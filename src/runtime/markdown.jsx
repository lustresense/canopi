/*
 * Lightweight, zero-dependency Markdown renderer for canoPi message bodies.
 *
 * parseBlocks()/parseInline() are pure: they turn text into a small node tree
 * of plain objects/strings. The Markdown component walks that tree into React
 * elements only — no HTML strings, no dangerouslySetInnerHTML, so hostile
 * message text can never inject markup.
 *
 * Supported: headings (#, ##, ###, …), fenced code blocks, inline code,
 * bold (**x** / __x__), italic (*x* / _x_), unordered/ordered lists,
 * blockquotes, paragraphs with hard line breaks.
 */
import React, { useMemo } from 'react';

/* ------------------------------- inline ---------------------------------- */
/* Order matters: code spans, then ** / __ bold, then * / _ italic.
 * `_italic_` refuses intra-word matches so snake_case identifiers survive. */
const INLINE_RE = /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\n]+?)\*|(?<![\w])_([^_\n]+?)_(?![\w])/g;

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
    else if (m[3] !== undefined) out.push({ type: 'strong', children: parseInline(m[3]) });
    else if (m[4] !== undefined) out.push({ type: 'strong', children: parseInline(m[4]) });
    else if (m[5] !== undefined) out.push({ type: 'em', children: parseInline(m[5]) });
    else out.push({ type: 'em', children: parseInline(m[6]) });
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

const startsBlock = ln =>
  RE_FENCE_OPEN.test(ln) || RE_HEADING.test(ln) || RE_QUOTE.test(ln) || RE_UL.test(ln) || RE_OL.test(ln);

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

    if (RE_QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) { inner.push(lines[i].replace(RE_QUOTE, '$1')); i++; }
      blocks.push({ type: 'quote', blocks: parseBlocks(inner.join('\n')) });
      continue;
    }

    if (RE_UL.test(line)) {
      const items = [];
      let m;
      while (i < lines.length && (m = RE_UL.exec(lines[i]))) { items.push(m[1].trim()); i++; }
      blocks.push({ type: 'ul', items });
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
    if (n.type === 'strong') return <strong key={k}>{inline(n.children, k)}</strong>;
    if (n.type === 'em') return <em key={k}>{inline(n.children, k)}</em>;
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
      return <pre key={key} data-lang={b.lang || undefined}><code>{b.text}</code></pre>;
    case 'p':
      return (
        <p key={key}>
          {b.lines.map((ln, idx) => (
            <React.Fragment key={`${key}.${idx}`}>{idx > 0 ? <br /> : null}{inline(parseInline(ln), `${key}.${idx}`)}</React.Fragment>
          ))}
        </p>
      );
    case 'ul':
      return <ul key={key}>{b.items.map((it, idx) => <li key={`${key}.${idx}`}>{inline(parseInline(it), `${key}.${idx}`)}</li>)}</ul>;
    case 'ol':
      return <ol key={key} start={b.start}>{b.items.map((it, idx) => <li key={`${key}.${idx}`}>{inline(parseInline(it), `${key}.${idx}`)}</li>)}</ol>;
    case 'quote':
      return <blockquote key={key}>{b.blocks.map((bb, idx) => renderBlock(bb, `${key}.${idx}`))}</blockquote>;
    default:
      return null;
  }
}

export function Markdown({ content }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  return <>{blocks.map((b, idx) => renderBlock(b, String(idx)))}</>;
}

export default Markdown;
