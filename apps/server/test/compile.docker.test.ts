import fs from 'node:fs'
import path from 'node:path'
import { YDOC_TEXTS } from '@openleaf/shared'
import { describe, expect, it } from 'vitest'
import type * as Y from 'yjs'
import { compileDir, compileKey } from '../src/compile/materialize.js'
import { replaceYText } from '../src/realtime/ydoc-text.js'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  registerUser,
} from './helpers.js'

describe.skipIf(process.env.OPENLEAF_TEST_DOCKER !== '1')(
  'compile (docker runner)',
  async () => {
    const { app, dataDir } = await createTestApp({
      OPENLEAF_COMPILE_RUNNER: 'docker',
      OPENLEAF_COMPILE_SCRATCH_MB: '64',
    })
    const user = await registerUser(app)
    const req = as(app, user)

    it('compiles the example project', async () => {
      const id = await createProject(app, user, 'example')
      const res = await req({
        method: 'POST',
        url: `/api/projects/${id}/compile`,
        payload: {},
      })
      expect(res.json().status).toBe('success')
      const paths = res.json().outputFiles.map((f: { path: string }) => f.path)
      expect(paths).toEqual(
        expect.arrayContaining(['output.pdf', 'output.log'])
      )
      const again = await req({
        method: 'POST',
        url: `/api/projects/${id}/compile`,
        payload: {},
      })
      expect(again.json().status).toBe('success')
      expect(
        again.json().outputFiles.map((file: { path: string }) => file.path)
      ).toContain('output.pdf')
      const words = await req({
        method: 'GET',
        url: `/api/projects/${id}/wordcount`,
      })
      expect(words.statusCode).toBe(200)
      expect(words.json().textWords).toBeGreaterThan(0)
    }, 300_000)

    it('runs shell escape without network access', async () => {
      const id = await createProject(app, user)
      const tree = await getTree(app, user, id)
      const main = tree.entries.find(e => e.name === 'main.tex')
      await app.ctx.realtime.withProjectDoc(id, doc =>
        replaceYText(
          doc.getMap<Y.Text>(YDOC_TEXTS).get(main?.id as string) as Y.Text,
          '\\documentclass{article}\n\\begin{document}\n\\immediate\\write18{curl -s https://example.com > net.txt}\nHi\n\\end{document}\n'
        )
      )
      await req({
        method: 'POST',
        url: `/api/projects/${id}/compile`,
        payload: {},
      })
      const file = path.join(
        compileDir(dataDir, compileKey(id, user.id)),
        'net.txt'
      )
      const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
      expect(content).toBe('')
    }, 300_000)

    it('bounds scratch writes, keeps input read-only and excludes unsafe artifacts', async () => {
      const id = await createProject(app, user)
      const dir = compileDir(dataDir, compileKey(id, user.id))
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'main.tex'), 'immutable host source')
      await app.ctx.compile.imageGate(app.ctx.config.texliveImages[0])
      const result = await app.ctx.compile.runner.run({
        key: compileKey(id, user.id),
        dir,
        image: app.ctx.config.texliveImages[0],
        timeoutMs: 30_000,
        sourcePaths: new Set(['main.tex']),
        cmd: [
          'sh',
          '-c',
          'id -u > uid.txt; env > env.txt; stat -f -c %T /compile > fs-kind.txt; kill -STOP 1 2>watchdog.log; echo $? > watchdog-status.txt; sh -c "echo denied > /var/tmp/openleaf-probe" 2>rootfs.log; echo $? > rootfs-status.txt; echo changed > main.tex; echo bad > /input/main.tex; ln -s /etc/passwd escape; dd if=/dev/zero of=fill.bin bs=1M count=128 2>fill.log; status=$?; rm -f fill.bin; echo $status > cap.txt; echo safe > safe.txt',
        ],
      })
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain('Read-only file system')
      expect(fs.readFileSync(path.join(dir, 'main.tex'), 'utf8')).toBe(
        'immutable host source'
      )
      expect(fs.readFileSync(path.join(dir, 'safe.txt'), 'utf8').trim()).toBe(
        'safe'
      )
      expect(
        Number(fs.readFileSync(path.join(dir, 'cap.txt'), 'utf8'))
      ).not.toBe(0)
      expect(
        Number(fs.readFileSync(path.join(dir, 'uid.txt'), 'utf8'))
      ).not.toBe(0)
      expect(
        Number(fs.readFileSync(path.join(dir, 'watchdog-status.txt'), 'utf8'))
      ).not.toBe(0)
      expect(
        Number(fs.readFileSync(path.join(dir, 'rootfs-status.txt'), 'utf8'))
      ).not.toBe(0)
      expect(fs.readFileSync(path.join(dir, 'rootfs.log'), 'utf8')).toContain(
        'Read-only file system'
      )
      expect(
        fs.readFileSync(path.join(dir, 'fs-kind.txt'), 'utf8').trim()
      ).toBe('tmpfs')
      expect(fs.readFileSync(path.join(dir, 'env.txt'), 'utf8')).toContain(
        'TMPDIR=/tmp'
      )
      expect(fs.existsSync(path.join(dir, 'escape'))).toBe(false)
    }, 60_000)
  }
)
