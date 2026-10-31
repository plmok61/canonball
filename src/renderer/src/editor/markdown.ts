import type { Editor, JSONContent } from '@tiptap/core'
import { parse as parseYaml } from 'yaml'

export interface OpenDoc {
  /**
   * Raw front matter text, including both `---` fences, the closing fence's
   * newline, and any blank lines that follow it, so it can be written back
   * byte-for-byte. `null` when the file has no front matter.
   */
  frontMatter: string | null
}

const FENCE = /^---\r?$/

function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Front matter is recognised only when the first line is exactly `---`, a later
 * line is exactly `---`, and the text between parses as a YAML mapping. Anything
 * else (notably a scene break at the top of a chapter) is left in the body.
 */
export function splitFrontMatter(md: string): { frontMatter: string | null; body: string } {
  const none = { frontMatter: null, body: md }
  const lines = md.split('\n')
  if (lines.length < 2 || !FENCE.test(lines[0])) return none

  const close = lines.findIndex((line, i) => i > 0 && FENCE.test(line))
  if (close === -1) return none

  try {
    if (!isPlainObject(parseYaml(lines.slice(1, close).join('\n')))) return none
  } catch {
    return none
  }

  let end = lines.slice(0, close + 1).join('\n').length
  if (end < md.length) end += 1 // the closing fence's newline
  while (md.startsWith('\n', end) || md.startsWith('\r\n', end)) {
    end += md.startsWith('\r\n', end) ? 2 : 1
  }
  return { frontMatter: md.slice(0, end), body: md.slice(end) }
}

function isEmptyParagraph(node: JSONContent | undefined): boolean {
  return node?.type === 'paragraph' && !node.content?.length
}

/**
 * `- <!-- hint -->` reaches us as a list item holding an empty paragraph and a
 * block comment, because a list item must start with a paragraph. Fold the
 * comment into that paragraph so it saves back as `- <!-- hint -->`.
 */
function liftLeadingComments(node: JSONContent): JSONContent {
  if (!node.content) return node
  const content = node.content.map(liftLeadingComments)
  const [first, second] = content
  if (
    (node.type === 'listItem' || node.type === 'taskItem') &&
    isEmptyParagraph(first) &&
    second?.type === 'htmlComment'
  ) {
    content.splice(0, 2, {
      type: 'paragraph',
      content: [{ type: 'htmlCommentInline', attrs: { raw: second.attrs?.raw ?? '' } }]
    })
  }
  return { ...node, content }
}

function requireMarkdown(editor: Editor): NonNullable<Editor['markdown']> {
  if (!editor.markdown) throw new Error('The editor was created without the Markdown extension')
  return editor.markdown
}

export function loadIntoEditor(editor: Editor, md: string): OpenDoc {
  const { frontMatter, body } = splitFrontMatter(md)
  const json = liftLeadingComments(requireMarkdown(editor).parse(body))
  editor.commands.setContent(json.content?.length ? json : '', { emitUpdate: false })
  return { frontMatter }
}

export function serializeEditor(editor: Editor, doc: OpenDoc): string {
  const body = requireMarkdown(editor).serialize(editor.getJSON()).replace(/\s+$/, '')
  return (doc.frontMatter ?? '') + (body ? `${body}\n` : '')
}
