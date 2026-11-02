import { promises as fsp } from 'fs'
import { CHAT_ID_RE, parseChatThread, type ChatSummary, type ChatThread } from '../shared/ai'
import { resolveInside, writeDoc } from './projectFs'

export const CHATS_REL = '.canonball/chats'

const FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/

function chatRel(id: string): string {
  if (typeof id !== 'string' || !CHAT_ID_RE.test(id)) throw new Error('Invalid chat id')
  return `${CHATS_REL}/${id}.json`
}

async function readThread(root: string, id: string): Promise<ChatThread> {
  const full = resolveInside(root, chatRel(id))
  let raw: string
  try {
    raw = await fsp.readFile(full, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('Chat not found', { cause: err })
    throw new Error('Chat file is unreadable', { cause: err })
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('Chat file is unreadable')
  }
  const thread = parseChatThread(json)
  if (!thread || thread.id !== id) throw new Error('Chat file is unreadable')
  return thread
}

export async function listChats(root: string): Promise<ChatSummary[]> {
  let names: string[]
  try {
    names = await fsp.readdir(resolveInside(root, CHATS_REL))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw err
  }
  const out: ChatSummary[] = []
  for (const name of names) {
    const m = FILE_RE.exec(name)
    if (!m) continue
    try {
      const t = await readThread(root, m[1])
      out.push({ id: t.id, title: t.title, updatedAt: t.updatedAt })
    } catch {
      // Unreadable files are skipped, never overwritten.
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

export function loadChat(root: string, id: string): Promise<ChatThread> {
  return readThread(root, id)
}

export async function saveChat(root: string, thread: ChatThread): Promise<void> {
  const parsed = parseChatThread(thread)
  if (!parsed) throw new Error('Invalid chat')
  const rel = chatRel(parsed.id)
  const dir = resolveInside(root, CHATS_REL)
  try {
    await readThread(root, parsed.id)
  } catch (err) {
    // A missing file is a new thread; anything else must not be overwritten.
    if ((err as Error).message !== 'Chat not found') throw err
  }
  await fsp.mkdir(dir, { recursive: true })
  try {
    // 'wx': keep any existing .gitignore as the writer left it.
    await fsp.writeFile(resolveInside(root, `${CHATS_REL}/.gitignore`), '*\n', {
      encoding: 'utf8',
      flag: 'wx'
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
  await writeDoc(root, rel, JSON.stringify(parsed, null, 2) + '\n')
}
