import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAiAccess } from '../aiAccess'
import { createProject } from '../projectFs'
import { setPathAccess } from '../projectSettings'
import {
  BASE_INSTRUCTIONS,
  buildInstructions,
  FALLBACK_INSTRUCTIONS,
  loadMemory,
  TOOL_INSTRUCTIONS
} from './instructions'

const TEMPLATE = path.resolve(__dirname, '../../../template')
const STYLE_INTRO =
  'Whenever you write any sample passage, prose or dialogue (only ever into chat or a note, never a draft), follow these style rules:'
const NAMES_INTRO = 'Whenever you suggest names, never use any of these:'
const MEMORY_INTRO = 'Project memory (how the writer works and wants you to talk):'

let tmp: string
let root: string
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'canonball-instr-'))
  root = path.join(tmp, 'project')
  await createProject(root, TEMPLATE)
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const template = (f: string): Promise<string> =>
  fs.readFile(path.join(TEMPLATE, 'memory', f), 'utf8')

describe('buildInstructions', () => {
  it('includes style rules and names to avoid with their framing', async () => {
    const memory = await loadMemory(createAiAccess(root))
    const text = buildInstructions({ mode: 'tools', memory })
    const style = await template('style_rules.md')
    const names = await template('names_to_avoid.md')
    expect(text.indexOf(style)).toBeGreaterThan(text.indexOf(STYLE_INTRO))
    expect(text.indexOf(STYLE_INTRO)).toBeGreaterThan(-1)
    expect(text.indexOf(names)).toBeGreaterThan(text.indexOf(NAMES_INTRO))
    expect(text.indexOf(NAMES_INTRO)).toBeGreaterThan(-1)
  })

  it('leaves out hidden memory', async () => {
    await setPathAccess(root, 'memory', 'hidden')
    const memory = await loadMemory(createAiAccess(root))
    expect(memory).toEqual([])
    const text = buildInstructions({ mode: 'tools', memory })
    expect(text).not.toContain(STYLE_INTRO)
    expect(text).not.toContain(await template('style_rules.md'))
  })

  it('includes other memory as project memory', async () => {
    const memory = await loadMemory(createAiAccess(root))
    const text = buildInstructions({ mode: 'tools', memory })
    expect(text).toContain(MEMORY_INTRO)
    expect(text).toContain(await template('feedback_tone.md'))
    expect(text.indexOf(await template('user_profile.md'))).toBeGreaterThan(
      text.indexOf(MEMORY_INTRO)
    )
  })

  it('caps each memory file at 20,000 characters', async () => {
    await fs.writeFile(path.join(root, 'memory/big.md'), 'y'.repeat(25_000))
    const memory = await loadMemory(createAiAccess(root))
    expect(memory.find((m) => m.relPath === 'memory/big.md')!.content).toHaveLength(20_000)
  })

  it('only loads top-level memory files', async () => {
    await fs.mkdir(path.join(root, 'memory/deep'))
    await fs.writeFile(path.join(root, 'memory/deep/x.md'), 'deep')
    const memory = await loadMemory(createAiAccess(root))
    expect(memory.some((m) => m.relPath.includes('deep'))).toBe(false)
  })

  it('fallback mode carries the tag format and the files', () => {
    const text = buildInstructions({
      mode: 'fallback',
      memory: [],
      files: '<file path="a.md">x</file>'
    })
    expect(text).toContain(BASE_INSTRUCTIONS)
    expect(text).toContain(FALLBACK_INSTRUCTIONS)
    expect(text).toContain('<canonball-edit path="')
    expect(text).toContain('<canonball-create path="')
    expect(text).toContain('<file path="a.md">x</file>')
  })

  it('tools mode names the tools', () => {
    const text = buildInstructions({ mode: 'tools', memory: [] })
    expect(text).toContain(TOOL_INSTRUCTIONS)
    for (const n of ['list_files', 'read_file', 'propose_edit', 'create_note']) {
      expect(text).toContain(n)
    }
  })

  it('appends the session block last', () => {
    const text = buildInstructions({
      mode: 'fallback',
      memory: [{ relPath: 'memory/other.md', content: 'other' }],
      files: '<file path="a.md">x</file>',
      session: 'SESSION BLOCK'
    })
    expect(text.endsWith('\n\nSESSION BLOCK')).toBe(true)
    expect(text.indexOf('SESSION BLOCK')).toBeGreaterThan(text.indexOf('<file path="a.md">'))
    expect(buildInstructions({ mode: 'tools', memory: [] })).not.toContain('SESSION BLOCK')
  })

  it('none mode says no project is open', () => {
    const text = buildInstructions({ mode: 'none', memory: [] })
    expect(text).toContain(BASE_INSTRUCTIONS)
    expect(text).toContain("No project is open, so you can't see any files.")
  })
})
