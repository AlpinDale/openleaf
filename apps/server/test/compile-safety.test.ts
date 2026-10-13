import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compileDir, materialize } from '../src/compile/materialize.js'
import { HostRunner } from '../src/compile/runner.js'
import type { ProjectSnapshot } from '../src/tree/snapshot.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))
  )
})
async function temporary() {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'openleaf-compile-safety-')
  )
  dirs.push(dir)
  return dir
}
function snapshot(docs: Record<string, string>): ProjectSnapshot {
  return {
    rows: [],
    entries: Object.entries(docs).map(([path, text]) => ({
      id: path,
      path,
      kind: 'doc',
      text,
    })),
  }
}
const options = { draft: false, rootDocPath: 'main.tex' }

describe('untrusted generated compile files', () => {
  it('removes generated parent symlinks before writing project sources', async () => {
    const data = await temporary()
    const outside = await temporary()
    const dir = compileDir(data, 'key')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(outside, 'secret.tex'), 'host secret')
    await fs.symlink(outside, path.join(dir, 'figs'))
    await materialize(
      data,
      'key',
      snapshot({ 'figs/secret.tex': 'project text' }),
      options
    )
    expect(await fs.readFile(path.join(outside, 'secret.tex'), 'utf8')).toBe(
      'host secret'
    )
    expect(await fs.readFile(path.join(dir, 'figs/secret.tex'), 'utf8')).toBe(
      'project text'
    )
  })

  it('restores source files changed by a previous TeX process despite matching manifest', async () => {
    const data = await temporary()
    const source = snapshot({ 'main.tex': 'trusted project source' })
    await materialize(data, 'key', source, options)
    await fs.writeFile(
      path.join(compileDir(data, 'key'), 'main.tex'),
      'modified by TeX'
    )
    expect((await materialize(data, 'key', source, options)).written).toBe(1)
    expect(
      await fs.readFile(path.join(compileDir(data, 'key'), 'main.tex'), 'utf8')
    ).toBe('trusted project source')
    expect((await materialize(data, 'key', source, options)).written).toBe(0)
  })

  it('rejects oversized inputs before writing them to the host cache', async () => {
    const data = await temporary()
    await expect(
      materialize(data, 'key', snapshot({ 'main.tex': 'too large' }), {
        ...options,
        maxBytes: 4,
      })
    ).rejects.toMatchObject({ statusCode: 413 })
    await expect(fs.stat(compileDir(data, 'key'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('replaces a generated compile-root symlink without following it', async () => {
    const data = await temporary()
    const outside = await temporary()
    const dir = compileDir(data, 'key')
    await fs.mkdir(path.dirname(dir), { recursive: true })
    await fs.writeFile(path.join(outside, 'main.tex'), 'outside source')
    await fs.symlink(outside, dir)
    await materialize(
      data,
      'key',
      snapshot({ 'main.tex': 'project source' }),
      options
    )
    expect(await fs.readFile(path.join(outside, 'main.tex'), 'utf8')).toBe(
      'outside source'
    )
    expect(await fs.readFile(path.join(dir, 'main.tex'), 'utf8')).toBe(
      'project source'
    )
  })
  it('materializes prototype-named sources and file/folder transitions', async () => {
    const data = await temporary()
    const source = Object.fromEntries([['__proto__', 'ordinary source']])
    await materialize(data, 'key', snapshot(source), options)
    await materialize(
      data,
      'key',
      snapshot({ '__proto__/child.tex': 'nested' }),
      options
    )
    expect(
      await fs.readFile(
        path.join(compileDir(data, 'key'), '__proto__/child.tex'),
        'utf8'
      )
    ).toBe('nested')
    await materialize(data, 'key', snapshot(source), options)
    expect(
      await fs.readFile(path.join(compileDir(data, 'key'), '__proto__'), 'utf8')
    ).toBe('ordinary source')
  })
})

describe('host runner process lifetime', () => {
  it('kills descendants holding stdout after the process leader exits', async () => {
    const dir = await temporary()
    const runner = new HostRunner(dir)
    // Platform integration: real pipes/process groups must close on the runner's deadline.
    const result = await runner.run({
      key: 'descendants',
      dir,
      image: 'unused',
      timeoutMs: 300,
      sourcePaths: new Set(),
      cmd: [
        process.execPath,
        '-e',
        "const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});process.exit(0)",
      ],
    })
    expect(result.timedOut).toBe(true)
    expect(result.durationMs).toBeLessThan(3000)
  }, 5000)

  it('caps captured output while continuing to drain the process', async () => {
    const dir = await temporary()
    const runner = new HostRunner(dir)
    const result = await runner.run({
      key: 'output',
      dir,
      image: 'unused',
      timeoutMs: 3000,
      sourcePaths: new Set(),
      cmd: [
        process.execPath,
        '-e',
        "process.stdout.write('x'.repeat(3*1024*1024))",
      ],
    })
    expect(result.exitCode).toBe(0)
    expect(Buffer.byteLength(result.stdout)).toBe(2 * 1024 * 1024)
  })

  it('preserves literal placeholder-like text in valid user filenames', async () => {
    const dir = await temporary()
    const file = path.join(dir, '$COMPILE_DIR.tex')
    await fs.writeFile(file, 'literal filename')
    const runner = new HostRunner(dir)
    const result = await runner.run({
      key: 'filename',
      dir,
      image: 'unused',
      timeoutMs: 3000,
      sourcePaths: new Set(['$COMPILE_DIR.tex']),
      cmd: [
        process.execPath,
        '-e',
        'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))',
        file,
      ],
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('literal filename')
  })
})
