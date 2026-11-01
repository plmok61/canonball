import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { flushHoldingArea } from './trashFlush'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-flush-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('flushHoldingArea', () => {
  it('flushes each holding item and removes its folder', async () => {
    const hold = path.join(root, '.canonball', 'trash')
    await fs.mkdir(path.join(hold, 'a'), { recursive: true })
    await fs.mkdir(path.join(hold, 'b'), { recursive: true })
    await fs.writeFile(path.join(hold, 'a', 'one.md'), '1')
    await fs.writeFile(path.join(hold, 'a', 'two.md'), '2')
    await fs.writeFile(path.join(hold, 'b', 'dir'), '3')
    const seen: string[] = []
    await flushHoldingArea(root, async (p) => {
      seen.push(p)
      await fs.rm(p, { recursive: true }) // the real trashItem moves it away
    })
    expect(seen.sort()).toEqual([
      path.join(hold, 'a', 'one.md'),
      path.join(hold, 'a', 'two.md'),
      path.join(hold, 'b', 'dir')
    ])
    expect(await fs.readdir(hold)).toEqual([])
  })

  it('no holding area is fine', async () => {
    await expect(flushHoldingArea(root, async () => {})).resolves.toBeUndefined()
  })

  it('one failing item does not stop the rest', async () => {
    const hold = path.join(root, '.canonball', 'trash')
    await fs.mkdir(path.join(hold, 'a'), { recursive: true })
    await fs.writeFile(path.join(hold, 'a', 'x.md'), '1')
    await fs.writeFile(path.join(hold, 'a', 'y.md'), '2')
    const seen: string[] = []
    await flushHoldingArea(root, async (p) => {
      seen.push(p)
      if (p.endsWith('x.md')) throw new Error('nope')
    })
    expect(seen).toHaveLength(2)
  })
})
