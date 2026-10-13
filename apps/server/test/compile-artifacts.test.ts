import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { c, Header } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import { recoverSandboxArchive } from '../src/compile/artifacts.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))
  )
})
async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'openleaf-artifacts-'))
  dirs.push(base)
  const input = path.join(base, 'input')
  const output = path.join(base, 'output')
  await fs.mkdir(input)
  await fs.mkdir(output)
  return { base, input, output }
}

describe('sandbox artifact recovery', () => {
  it('keeps host sources immutable and excludes symlinks and hardlinks', async () => {
    const { base, input, output } = await fixture()
    await fs.writeFile(path.join(input, 'main.tex'), 'sandbox modified source')
    await fs.writeFile(path.join(output, 'main.tex'), 'host source')
    await fs.writeFile(path.join(input, 'output.pdf'), 'generated PDF')
    await fs.symlink('/etc/passwd', path.join(input, 'escape'))
    await fs.link(path.join(input, 'output.pdf'), path.join(input, 'hardlink'))
    await recoverSandboxArchive(
      Readable.from(
        c({ cwd: input }, ['main.tex', 'output.pdf', 'escape', 'hardlink'])
      ),
      output,
      new Set(['main.tex']),
      64 * 1024 * 1024
    )
    expect(await fs.readFile(path.join(output, 'main.tex'), 'utf8')).toBe(
      'host source'
    )
    expect(await fs.readdir(output)).toEqual(
      expect.arrayContaining(['main.tex', 'output.pdf'])
    )
    expect(await fs.readdir(output)).not.toContain('escape')
    expect(await fs.readdir(output)).not.toContain('hardlink')
    expect(await fs.readdir(base)).toEqual(
      expect.arrayContaining(['input', 'output'])
    )
  })

  it('rejects traversal and files replacing source directories', async () => {
    const { base, input, output } = await fixture()
    await fs.writeFile(path.join(base, 'secret'), 'host secret')
    await fs.writeFile(path.join(input, 'chapter'), 'not a directory')
    await fs.mkdir(path.join(output, 'chapter'))
    await fs.writeFile(path.join(output, 'chapter/main.tex'), 'host source')
    await recoverSandboxArchive(
      Readable.from(
        c({ cwd: input, preservePaths: true }, ['../secret', 'chapter'])
      ),
      output,
      new Set(['chapter/main.tex']),
      64 * 1024 * 1024
    )
    expect(await fs.readFile(path.join(base, 'secret'), 'utf8')).toBe(
      'host secret'
    )
    expect(
      await fs.readFile(path.join(output, 'chapter/main.tex'), 'utf8')
    ).toBe('host source')
    expect(await fs.readdir(output)).toEqual(['chapter'])
  })

  it('bounds generated files without counting protected source inputs', async () => {
    const { input, output } = await fixture()
    const sources = new Set<string>()
    const paths: string[] = []
    for (let i = 0; i < 510; i++) {
      const source = `source-${i}.tex`
      sources.add(source)
      paths.push(source)
      await fs.writeFile(path.join(input, source), 'source')
    }
    for (let i = 0; i < 510; i++) {
      const generated = `generated-${i}.aux`
      paths.push(generated)
      await fs.writeFile(path.join(input, generated), 'generated')
    }
    await recoverSandboxArchive(
      Readable.from(c({ cwd: input }, paths)),
      output,
      sources,
      64 * 1024 * 1024
    )
    expect((await fs.readdir(output)).length).toBe(500)
    expect(
      await fs.readFile(path.join(output, 'generated-0.aux'), 'utf8')
    ).toBe('generated')
  })

  it('skips regular files exceeding the recovery byte budget', async () => {
    const { input, output } = await fixture()
    await fs.writeFile(path.join(input, 'large.aux'), 'too large')
    await fs.writeFile(path.join(input, 'small.aux'), 'ok')
    await recoverSandboxArchive(
      Readable.from(c({ cwd: input }, ['large.aux', 'small.aux'])),
      output,
      new Set(),
      4
    )
    expect(await fs.readdir(output)).toEqual(['small.aux'])
  })

  it('counts non-file archive entries against the traversal budget', async () => {
    const { output } = await fixture()
    function* archive() {
      for (let index = 0; index < 10_001; index++) {
        const block = Buffer.alloc(512)
        new Header({
          path: `dir-${index}/`,
          type: 'Directory',
          size: 0,
          mode: 0o755,
        }).encode(block)
        yield block
      }
      yield Buffer.alloc(1024)
    }
    await expect(
      recoverSandboxArchive(
        Readable.from(archive()),
        output,
        new Set(),
        64 * 1024 * 1024
      )
    ).rejects.toThrow('Sandbox archive entry limit reached')
    expect(await fs.readdir(output)).toEqual([])
  })

  it('aborts oversized archive streams even when the file itself is skipped', async () => {
    const { output } = await fixture()
    function* archive() {
      const header = Buffer.alloc(512)
      new Header({
        path: 'sparse-output',
        type: 'File',
        size: 33 * 1024 * 1024,
        mode: 0o644,
      }).encode(header)
      yield header
      const chunk = Buffer.alloc(1024 * 1024)
      for (let index = 0; index < 33; index++) yield chunk
      yield Buffer.alloc(1024)
    }
    await expect(
      recoverSandboxArchive(Readable.from(archive()), output, new Set(), 1)
    ).rejects.toThrow('Sandbox archive byte limit reached')
    expect(await fs.readdir(output)).toEqual([])
  })
})
