import { Node, type Extensions, type JSONContent } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { ListItem, TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'

const COMMENT = /^<!--[\s\S]*?-->/
// A comment that opens a line (up to three spaces of indent, as in CommonMark)
// and closes with nothing but whitespace after it on its last line.
const BLOCK_COMMENT = /^ {0,3}(<!--[\s\S]*?-->)[ \t]*(?:\n|$)/
// A line that opens with a comment but is not a block comment: text follows the
// closing `-->`, or the comment never closes. Kept as a paragraph so nothing on
// the line is dropped (left to marked, the comment would swallow the line, or
// the rest of the file).
const COMMENT_LINE = /^ {0,3}(?:<!--[\s\S]*?-->[^\n]*|<!--[^\n]*)(?:\n|$)/

/** The text a writer sees for a comment: what sits between `<!--` and `-->`. */
export function commentHintText(raw: string): string {
  return raw
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .trim()
}

/**
 * Where a comment line could interrupt the paragraph being read. marked calls
 * this on the source minus its first character, so index 0 is mid-line (as in
 * `\<!--`): only a comment after a newline counts.
 */
function blockCommentStart(src: string): number {
  const match = /\n {0,3}<!--/.exec(src)
  return match ? match.index + 1 : -1
}

function rawAttribute(): { raw: { default: string; rendered: false } } {
  return { raw: { default: '', rendered: false } }
}

function hintAttributes(raw: string): Record<string, string> {
  return { class: 'cb-hint', contenteditable: 'false', spellcheck: 'false', 'data-cb-comment': raw }
}

function parseRaw(element: HTMLElement): { raw: string } {
  return { raw: element.getAttribute('data-cb-comment') ?? '' }
}

/**
 * An HTML comment standing on its own line(s). The writer sees its inner text as
 * a read-only hint; the original `raw` text (including `<!--` and `-->`) is
 * written back exactly.
 */
export const HtmlComment = Node.create({
  name: 'htmlComment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes: rawAttribute,

  parseHTML() {
    return [{ tag: 'div[data-cb-comment]', getAttrs: parseRaw }]
  },

  renderHTML({ node }) {
    return ['div', hintAttributes(node.attrs.raw), commentHintText(node.attrs.raw)]
  },

  markdownTokenizer: {
    name: 'htmlComment',
    level: 'block',
    start: blockCommentStart,
    tokenize(src, _tokens, lexer) {
      const block = BLOCK_COMMENT.exec(src)
      if (block) return { type: 'htmlComment', raw: block[0], text: block[1] }

      // Not typed 'paragraph': marked would merge a following paragraph into it.
      const line = COMMENT_LINE.exec(src)
      if (!line) return undefined
      const text = line[0].trim()
      return {
        type: 'htmlComment',
        raw: line[0],
        text,
        tokens: lexer.inlineTokens(text),
        line: true
      }
    }
  },

  parseMarkdown(token, helpers) {
    if (token.line)
      return helpers.createNode('paragraph', {}, helpers.parseInline(token.tokens ?? []))
    return helpers.createNode('htmlComment', { raw: token.text ?? '' })
  },

  renderMarkdown(node) {
    return node.attrs?.raw ?? ''
  }
})

/** An HTML comment inside a line of prose, e.g. `Eyes are <!-- decide --> grey.` */
export const HtmlCommentInline = Node.create({
  name: 'htmlCommentInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes: rawAttribute,

  parseHTML() {
    return [{ tag: 'span[data-cb-comment]', getAttrs: parseRaw }]
  },

  renderHTML({ node }) {
    return ['span', hintAttributes(node.attrs.raw), commentHintText(node.attrs.raw)]
  },

  markdownTokenizer: {
    name: 'htmlCommentInline',
    level: 'inline',
    start: '<!--',
    tokenize(src) {
      const match = COMMENT.exec(src)
      if (!match) return undefined
      return { type: 'htmlCommentInline', raw: match[0], text: match[0] }
    }
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode('htmlCommentInline', { raw: token.text ?? '' })
  },

  renderMarkdown(node) {
    return node.attrs?.raw ?? ''
  }
})

// Inline HTML as CommonMark defines it: an open or closing tag, a processing
// instruction, a declaration or CDATA (comments are handled above). Autolinks
// such as `<https://…>` and `<a@b.com>` do not match.
const INLINE_HTML =
  /^(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<!\[CDATA\[[\s\S]*?\]\]>)/
// A footnote reference, `[^1]` or `[^long-note]`.
const FOOTNOTE_REF = /^\[\^[^\]\s]+\]/
// A footnote definition, with any continuation lines indented four spaces or
// a tab (blank lines may sit between them).
const FOOTNOTE_DEF = /^\[\^[^\]\s]+\]:[^\n]*(?:\n(?:[ \t]*\n)*(?: {4}|\t)[^\n]*)*(?:\n|$)/

function rawAttributes(raw: string): Record<string, string> {
  return { class: 'cb-raw', contenteditable: 'false', spellcheck: 'false', 'data-cb-raw': raw }
}

function parseRawSource(element: HTMLElement): { raw: string } {
  return { raw: element.getAttribute('data-cb-raw') ?? '' }
}

/**
 * Markdown the editor does not understand, standing on its own line(s): an
 * HTML block (from marked's `html` token) or a footnote definition. The writer
 * sees the source as read-only text; `raw` is written back exactly.
 */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes: rawAttribute,

  parseHTML() {
    return [{ tag: 'div[data-cb-raw]', getAttrs: parseRawSource }]
  },

  renderHTML({ node }) {
    return ['div', rawAttributes(node.attrs.raw), node.attrs.raw]
  },

  markdownTokenName: 'html',

  // Footnote definitions come through as block `html` tokens so they share the
  // handler below. `start` never fires: like marked's own definitions, they do not
  // interrupt a paragraph.
  markdownTokenizer: {
    name: 'footnoteDefinition',
    level: 'block',
    start: () => -1,
    tokenize(src) {
      const match = FOOTNOTE_DEF.exec(src)
      if (!match) return undefined
      return { type: 'html', block: true, raw: match[0], text: match[0] }
    }
  },

  parseMarkdown(token, helpers) {
    if (!token.block) return []
    return helpers.createNode('rawBlock', { raw: (token.raw ?? '').replace(/\n+$/, '') })
  },

  renderMarkdown(node) {
    return node.attrs?.raw ?? ''
  }
})

/** An inline HTML tag (`<span class="a">`, `</span>`, `<br>`) or footnote reference. */
export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes: rawAttribute,

  parseHTML() {
    return [{ tag: 'span[data-cb-raw]', getAttrs: parseRawSource }]
  },

  renderHTML({ node }) {
    return ['span', rawAttributes(node.attrs.raw), node.attrs.raw]
  },

  // Runs before marked's own inline rules, so `[^1]` is never read as a link
  // and tags never reach @tiptap/markdown's HTML parsing, which drops them.
  markdownTokenizer: {
    name: 'rawInline',
    level: 'inline',
    start: (src) => src.search(/<[A-Za-z/?!]|\[\^/),
    tokenize(src) {
      const match = INLINE_HTML.exec(src) ?? FOOTNOTE_REF.exec(src)
      if (!match) return undefined
      return { type: 'rawInline', raw: match[0], text: match[0] }
    }
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode('rawInline', { raw: token.text ?? '' })
  },

  renderMarkdown(node) {
    return node.attrs?.raw ?? ''
  }
})

// What marked's GFM autolinker reads as a bare URL (before it trims trailing
// punctuation, which can then neither open nor close emphasis). The parser reads
// it verbatim, backslashes included, so it must not be escaped.
const BARE_URL = /(?:(?:https?|ftp):\/\/|www\.)(?:[a-zA-Z0-9-]+\.?)+[^\s<]*/g

/** Inline escapes for prose outside a bare URL. */
function escapeInline(text: string): string {
  return (
    text
      // `&` only where it would read back as an entity the parser decodes
      .replace(/&(?=#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|(?:lt|gt|quot|amp);)/g, '&amp;')
      // emphasis, code, strike and escape characters; `_` inside a word is inert
      .replace(/[\\`*~]|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\$&')
      // a `]` that could close a link, reference or definition; without one, no
      // `[` can start a link
      .replace(/\](?=[([:])/g, '\\]')
      // `[^` would read back as a footnote reference
      .replace(/\[(?=\^)/g, '\\[')
      // `<` only where it could open a tag, comment or autolink
      .replace(/<(?=[A-Za-z/!?])/g, '\\<')
  )
}

/**
 * Escape a text node for markdown without the noise @tiptap/markdown adds by
 * default (`&` → `&amp;`, `>` → `&gt;`, every `[`, `]` and `_` backslashed), so
 * a writer's file stays readable as plain text: `[Character Name]` stays as is.
 * Only what would otherwise read back differently is escaped.
 *
 * - `inParagraph`: escape line starts that would become a heading, quote or list.
 * - `inLink`: the text is a link label, where marked does not autolink URLs.
 * - `beforeLink`: a link starts right after this text.
 */
export function escapeMarkdownText(
  text: string,
  {
    inParagraph = false,
    inLink = false,
    beforeLink = false
  }: { inParagraph?: boolean; inLink?: boolean; beforeLink?: boolean }
): string {
  let out = ''
  let rest = 0
  if (!inLink) {
    for (const url of text.matchAll(BARE_URL)) {
      out += escapeInline(text.slice(rest, url.index)) + url[0]
      rest = url.index + url[0].length
    }
  }
  const tail = escapeInline(text.slice(rest))
  // a trailing `!` right before a link's `[` would turn the link into an image
  out += beforeLink ? tail.replace(/!$/, '\\!') : tail
  if (inParagraph) {
    out = out
      .replace(/(^|\n)([#>])/g, '$1\\$2')
      .replace(/(^|\n)([-+])(?=[ \t\n]|$)/g, '$1\\$2')
      .replace(/(^|\n)(\d{1,9})([.)])(?=[ \t\n]|$)/g, '$1$2\\$3')
  }
  return out
}

type EncodeText = (text: string, node: JSONContent, parent?: JSONContent) => string

function hasLink(node: JSONContent | undefined): boolean {
  return (node?.marks ?? []).some((m) => (typeof m === 'string' ? m : m.type) === 'link')
}

/** Whether a link opens right after this text node (unknown position → assume so). */
function linkFollows(node: JSONContent, parent?: JSONContent): boolean {
  const siblings = parent?.content ?? []
  const index = siblings.indexOf(node)
  if (index === -1) return true
  return !hasLink(node) && hasLink(siblings[index + 1])
}

const CanonballMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event)
    // `encodeTextForMarkdown` is @tiptap/markdown's per-text-node escaper. It
    // leaves text in code marks and code blocks untouched; probing it with `*`
    // tells us whether this node is in code, so code keeps its stock handling.
    const manager = this.storage.manager as unknown as { encodeTextForMarkdown: EncodeText }
    const original = manager.encodeTextForMarkdown.bind(manager)
    manager.encodeTextForMarkdown = (text, node, parent) =>
      original('*', node, parent) === '*'
        ? original(text, node, parent)
        : escapeMarkdownText(text, {
            inParagraph: parent?.type === 'paragraph',
            inLink: hasLink(node),
            beforeLink: linkFollows(node, parent)
          })
  }
})

const CanonballLink = Link.extend({
  // A bare URL (`https://…`, `www.…`, `<https://…>`) stays plain text, so it is
  // saved as it was written rather than as `[https://…](https://…)`.
  parseMarkdown(token, helpers) {
    if (!token.raw?.startsWith('[')) return helpers.createTextNode(token.text ?? token.raw ?? '')
    return this.parent?.(token, helpers) ?? []
  }
})

const CanonballListItem = ListItem.extend({
  // An empty item renders as `- ` (or `1. `), which marked reads back as a
  // paragraph of text; without the trailing space it stays an empty item.
  renderMarkdown(node, helpers, ctx) {
    return (this.parent?.(node, helpers, ctx) ?? '').replace(/^([-+*]|\d{1,9}[.)]) +(?=\n|$)/, '$1')
  }
})

const CanonballTable = Table.extend({
  // The stock renderer wraps the table in newlines, which adds a blank line
  // around every table each time the file is saved.
  renderMarkdown(node, helpers, ctx) {
    return (this.parent?.(node, helpers, ctx) ?? '').replace(/^\n+|\n+$/g, '')
  }
})

export function createExtensions(): Extensions {
  return [
    StarterKit.configure({
      // The toolbar offers H1–H3, but deeper headings in a file must survive.
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      // Underline has no markdown form, so it could not be saved.
      underline: false,
      link: false,
      listItem: false
    }),
    CanonballListItem,
    CanonballLink.configure({ openOnClick: false, autolink: false }),
    CanonballTable,
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: true }),
    HtmlComment,
    HtmlCommentInline,
    RawBlock,
    RawInline,
    CanonballMarkdown
  ]
}
