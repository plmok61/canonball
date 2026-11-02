/** The system prompt, built per request: base text, tool or fallback rules, and memory/. */
import type { AiAccess } from '../aiAccess'

export const BASE_INSTRUCTIONS =
  'You are the assistant inside Canonball, a writing app. The writer writes the prose. You keep notes, answer questions and help them think things through. Never write, continue or rewrite their manuscript. If they ask for a sample passage, put it in the chat or in a note, label it as a sample, and never put it in a draft.'

export const TOOL_INSTRUCTIONS = [
  "You can see the writer's project through tools. Use list_files and read_file before answering questions about the project.",
  'You can suggest changes with propose_edit (change an existing file) and create_note (make a new note). These are only suggestions: the writer accepts or rejects each one, and nothing changes until they accept.',
  "Protected files (usually the writer's drafts) can never be changed, so don't try. Put every change to one file in one propose_edit call."
].join('\n\n')

export const FALLBACK_INSTRUCTIONS = [
  'You can\'t call tools here, so the files you may see are included below. Each file shows whether it is protected: you can only read a protected file (protected="true") and can suggest changes to the others (protected="false").',
  'To suggest a change to a file you can edit, write this in your reply, with one or more old/new pairs. Each old text must appear exactly once in the file:',
  '<canonball-edit path="notes/example.md"><old>text to replace</old><new>replacement text</new></canonball-edit>',
  'To suggest a new note in a folder you can edit, write:',
  '<canonball-create path="notes/new-note.md">content of the note</canonball-create>',
  "These are only suggestions: the writer accepts or rejects each one. Protected files (usually the writer's drafts) can never be changed, so don't try. Put every change to one file in one canonball-edit block."
].join('\n\n')

const NO_PROJECT = "No project is open, so you can't see any files."
const STYLE_INTRO =
  'Whenever you write any sample passage, prose or dialogue (only ever into chat or a note, never a draft), follow these style rules:'
const NAMES_INTRO = 'Whenever you suggest names, never use any of these:'
const MEMORY_INTRO = 'Project memory (how the writer works and wants you to talk):'
const STYLE_PATH = 'memory/style_rules.md'
const NAMES_PATH = 'memory/names_to_avoid.md'
const MEMORY_FILE_CAP = 20_000

export interface MemoryFile {
  relPath: string
  content: string
}

/** Top-level memory/*.md files, each capped. A file that can't be read is skipped. */
export async function loadMemory(access: AiAccess): Promise<MemoryFile[]> {
  const out: MemoryFile[] = []
  for (const f of await access.list()) {
    if (!/^memory\/[^/]+\.md$/.test(f.relPath)) continue
    try {
      const { content } = await access.read(f.relPath)
      out.push({ relPath: f.relPath, content: content.slice(0, MEMORY_FILE_CAP) })
    } catch {
      // Vanished since list(): leave it out.
    }
  }
  return out
}

export function buildInstructions(opts: {
  mode: 'tools' | 'fallback' | 'none'
  memory: MemoryFile[]
  files?: string
  /** The brainstorm-session block; always last. */
  session?: string
}): string {
  const parts = [BASE_INSTRUCTIONS]
  if (opts.mode === 'tools') parts.push(TOOL_INSTRUCTIONS)
  else if (opts.mode === 'fallback') parts.push(FALLBACK_INSTRUCTIONS)
  else parts.push(NO_PROJECT)

  const style = opts.memory.find((m) => m.relPath === STYLE_PATH)
  const names = opts.memory.find((m) => m.relPath === NAMES_PATH)
  const others = opts.memory.filter((m) => m !== style && m !== names)
  if (style) parts.push(`${STYLE_INTRO}\n\n${style.content}`)
  if (names) parts.push(`${NAMES_INTRO}\n\n${names.content}`)
  if (others.length > 0) {
    parts.push(
      `${MEMORY_INTRO}\n\n` + others.map((m) => `${m.relPath}:\n${m.content}`).join('\n\n')
    )
  }
  if (opts.mode === 'fallback' && opts.files) parts.push(opts.files)
  if (opts.session) parts.push(opts.session)
  return parts.join('\n\n')
}
