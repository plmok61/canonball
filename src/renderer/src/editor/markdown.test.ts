// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createExtensions } from './extensions'
import { loadIntoEditor, serializeEditor, splitFrontMatter } from './markdown'

const repoRoot = resolve(__dirname, '../../../..')
const templateDir = join(repoRoot, 'template')

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return markdownFiles(full)
    return name.endsWith('.md') ? [full] : []
  })
}

const templateFiles = markdownFiles(templateDir).map((file) => ({
  name: relative(templateDir, file),
  text: readFileSync(file, 'utf8')
}))

let editors: Editor[] = []

function newEditor(): Editor {
  const editor = new Editor({ extensions: createExtensions() })
  editors.push(editor)
  return editor
}

function roundTrip(md: string): string {
  const editor = newEditor()
  const doc = loadIntoEditor(editor, md)
  return serializeEditor(editor, doc)
}

function comments(md: string): string[] {
  return md.match(/<!--[\s\S]*?-->/g) ?? []
}

function wordCounts(md: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const word of md.match(/[\p{L}\p{N}]+/gu) ?? []) {
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return counts
}

afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors = []
})

it('finds the template fixtures', () => {
  expect(templateFiles.length).toBeGreaterThan(5)
  expect(templateFiles.map((f) => f.name)).toContain('memory/style_rules.md')
})

describe('splitFrontMatter', () => {
  it('returns null when the yaml is not a plain object', () => {
    expect(splitFrontMatter('---\n- a\n- b\n---\nText\n').frontMatter).toBeNull()
    expect(splitFrontMatter('---\nkey: [unclosed\n---\nText\n').frontMatter).toBeNull()
    expect(splitFrontMatter('---\nkey: value\n').frontMatter).toBeNull()
    expect(splitFrontMatter('Text\n---\nkey: value\n---\n').frontMatter).toBeNull()
  })

  it('splits a valid block', () => {
    const { frontMatter, body } = splitFrontMatter('---\na: 1\n---\nText\n')
    expect(frontMatter).toBe('---\na: 1\n---\n')
    expect(body).toBe('Text\n')
  })
})

describe('markdown round trip', () => {
  it('preserves front matter byte-for-byte', () => {
    const text = readFileSync(join(templateDir, 'memory/style_rules.md'), 'utf8')
    const editor = newEditor()
    const doc = loadIntoEditor(editor, text)
    const fenceEnd = text.indexOf('\n---\n', 4) + '\n---\n'.length
    const original = text.slice(0, fenceEnd)

    expect(doc.frontMatter?.startsWith(original)).toBe(true)
    expect(serializeEditor(editor, doc).startsWith(original)).toBe(true)
    // the front matter must not leak into the editable document
    expect(editor.getText()).not.toContain('name: Style Rules')
  })

  it('does not treat a leading scene break as front matter', () => {
    const editor = newEditor()
    const doc = loadIntoEditor(editor, '---\n\nShe left.\n\n---\n\nHe stayed.\n')
    expect(doc.frontMatter).toBeNull()
    const out = serializeEditor(editor, doc)
    expect(out).toContain('She left.')
    expect(out).toContain('He stayed.')
  })

  it.each(templateFiles)('preserves block HTML comments verbatim in $name', ({ text }) => {
    const out = roundTrip(text)
    for (const comment of comments(text)) {
      expect(out).toContain(comment)
    }
    expect(comments(out)).toEqual(comments(text))
  })

  it('preserves inline HTML comments', () => {
    const out = roundTrip('Eyes are <!-- decide --> grey.\n')
    expect(out).toContain('<!-- decide -->')
    expect(out).toBe('Eyes are <!-- decide --> grey.\n')
  })

  it('renders comments as non-editable hints showing the inner text', () => {
    const editor = newEditor()
    loadIntoEditor(editor, '<!-- block hint -->\n\nEyes are <!-- decide --> grey.\n')
    const hints = Array.from(editor.view.dom.querySelectorAll('.cb-hint'))
    expect(hints.map((h) => h.textContent?.trim())).toEqual(['block hint', 'decide'])
    for (const hint of hints) expect(hint.getAttribute('contenteditable')).toBe('false')
    expect(editor.view.dom.querySelector('div.cb-hint')).not.toBeNull()
  })

  it.each(templateFiles)('round trip is idempotent for $name', ({ text }) => {
    const once = roundTrip(text)
    expect(roundTrip(once)).toBe(once)
  })

  it.each(templateFiles)('keeps every word in $name', ({ text }) => {
    expect(wordCounts(roundTrip(text))).toEqual(wordCounts(text))
  })

  it('scene break serializes as a thematic break', () => {
    const editor = newEditor()
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before.' }] },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] }
      ]
    })
    const out = serializeEditor(editor, { frontMatter: null })
    expect(out).toMatch(/^(---|\*\*\*|\* \* \*)$/m)
    expect(out.endsWith('\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
  })

  it('tables and links round-trip', () => {
    const out = roundTrip('| A | B |\n|---|---|\n| 1 | 2 |\n\n[site](https://example.com)\n')
    const editor = newEditor()
    loadIntoEditor(editor, out)
    const dom = editor.view.dom
    const cells = Array.from(dom.querySelectorAll('th, td')).map((c) => c.textContent?.trim())
    expect(cells).toEqual(['A', 'B', '1', '2'])
    const link = dom.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com')
    expect(link?.textContent).toBe('site')
  })

  it.each([
    ['template placeholders', '## Chapter 1 — *[Title]*\n\n### [Character Name]\n'],
    ['deep headings', '#### Four\n\n###### Six\n'],
    ['task lists', '- [ ] todo\n- [x] done\n'],
    ['images', 'Before ![a map](map.png) after.\n'],
    ['bare URLs', 'See https://example.com/a_b and www.example.com now.\n'],
    ['plain ampersands and angles', 'Jack & Jill, 3 < 4 > 2.\n'],
    ['snake_case', 'Use the old_name field.\n'],
    ['a comment with text after it', '<!-- hint --> and prose\n\nNext.\n'],
    ['a multi-line comment', '<!--\nline one\nline two\n-->\n\nPara.\n'],
    ['a comment in a list item', '- <!-- hint -->\n- real item\n'],
    ['a comment in a heading', '## Title <!-- h -->\n']
  ])('saves %s unchanged', (_label, md) => {
    expect(roundTrip(md)).toBe(md)
  })

  it('keeps the text around a comment that never closes', () => {
    const out = roundTrip('Before.\n\n<!-- never closed\n\nAfter text here.\n')
    expect(wordCounts(out)).toEqual(wordCounts('Before. <!-- never closed After text here.'))
    expect(roundTrip(out)).toBe(out)
  })

  it.each([
    '# not a heading',
    '1. not a list',
    '- not a bullet',
    '> not a quote',
    '*not em* and _not em_ and **not bold**',
    '[not](a-link) and [not]: a-definition',
    'Wow!',
    '<b>not a tag</b> <!-- not a comment -->',
    'AT&T &amp; &copy; &#38;',
    'back\\slash `not code` ~~not struck~~',
    'https://example.com/_a_'
  ])('reads typed text %j back exactly', (text) => {
    const editor = newEditor()
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text }] },
        // a `!` right before a link must not turn it into an image
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Wow!' },
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'https://x.com' } }]
            }
          ]
        }
      ]
    })
    const md = serializeEditor(editor, { frontMatter: null })
    const reread = newEditor()
    loadIntoEditor(reread, md)
    expect(reread.getJSON()).toEqual(editor.getJSON())
  })

  it('loads without emitting an update', () => {
    const editor = newEditor()
    let updates = 0
    editor.on('update', () => updates++)
    loadIntoEditor(editor, '# Title\n\nText.\n')
    expect(updates).toBe(0)
  })
})
