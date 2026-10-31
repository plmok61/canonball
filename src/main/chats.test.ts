import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { listChats, loadChat, saveChat } from './chats'
import type { ChatThread } from '../shared/ai'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'canonball-chats-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const ID_BAD = '33333333-3333-4333-8333-333333333333'

function thread(id: string, updatedAt: string, title = 'Hello'): ChatThread {
  return {
    version: 1,
    id,
    title,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    messages: [
      { role: 'user', content: 'Hi', at: '2026-01-01T00:00:00.000Z' },
      { role: 'assistant', content: 'Hello', at: '2026-01-01T00:00:01.000Z' }
    ]
  }
}

const chatsDir = (): string => path.join(root, '.canonball', 'chats')

describe('chat storage', () => {
  it('listing a project without chats writes nothing', async () => {
    expect(await listChats(root)).toEqual([])
    expect(fs.existsSync(path.join(root, '.canonball'))).toBe(false)
  })

  it('save then load round-trips', async () => {
    const t = thread(ID_A, '2026-01-02T00:00:00.000Z')
    await saveChat(root, t)
    const raw = fs.readFileSync(path.join(chatsDir(), `${ID_A}.json`), 'utf8')
    expect(raw).toBe(JSON.stringify(t, null, 2) + '\n')
    expect(await loadChat(root, ID_A)).toEqual(t)
  })

  it('saving adds a gitignore inside the chats folder', async () => {
    await saveChat(root, thread(ID_A, '2026-01-02T00:00:00.000Z'))
    expect(fs.readFileSync(path.join(chatsDir(), '.gitignore'), 'utf8')).toBe('*\n')
    fs.writeFileSync(path.join(chatsDir(), '.gitignore'), 'custom\n')
    await saveChat(root, thread(ID_B, '2026-01-03T00:00:00.000Z'))
    expect(fs.readFileSync(path.join(chatsDir(), '.gitignore'), 'utf8')).toBe('custom\n')
  })

  it('lists newest first', async () => {
    await saveChat(root, thread(ID_A, '2026-01-02T00:00:00.000Z', 'Old'))
    await saveChat(root, thread(ID_B, '2026-01-03T00:00:00.000Z', 'New'))
    expect(await listChats(root)).toEqual([
      { id: ID_B, title: 'New', updatedAt: '2026-01-03T00:00:00.000Z' },
      { id: ID_A, title: 'Old', updatedAt: '2026-01-02T00:00:00.000Z' }
    ])
  })

  it('skips unreadable chat files', async () => {
    fs.mkdirSync(chatsDir(), { recursive: true })
    const bad = path.join(chatsDir(), `${ID_BAD}.json`)
    fs.writeFileSync(bad, '{oops')
    fs.writeFileSync(path.join(chatsDir(), 'notes.json'), '{}')
    await saveChat(root, thread(ID_A, '2026-01-02T00:00:00.000Z'))
    expect((await listChats(root)).map((c) => c.id)).toEqual([ID_A])
    await expect(loadChat(root, ID_BAD)).rejects.toThrow('Chat file is unreadable')
    expect(fs.readFileSync(bad, 'utf8')).toBe('{oops')
  })

  it('reports a missing chat', async () => {
    await expect(loadChat(root, ID_A)).rejects.toThrow('Chat not found')
  })

  it('rejects invalid ids and shapes', async () => {
    await expect(loadChat(root, '../x')).rejects.toThrow()
    const bad = { ...thread(ID_A, 'x'), messages: [{ role: 'system', content: 'x', at: 'y' }] }
    await expect(saveChat(root, bad as unknown as ChatThread)).rejects.toThrow('Invalid chat')
    expect(fs.existsSync(path.join(root, '.canonball'))).toBe(false)
  })
})
