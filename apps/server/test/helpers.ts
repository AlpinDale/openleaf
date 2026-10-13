import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

export type TestApp = {
  app: FastifyInstance
  dataDir: string
}

/** Builds an app on a fresh temp data dir; closed and removed after the file. */
export async function createTestApp(
  env: Record<string, string> = {}
): Promise<TestApp> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openleaf-test-'))
  const config = loadConfig({
    OPENLEAF_DATA_DIR: dataDir,
    OPENLEAF_PUBLIC_URL: 'http://127.0.0.1:3000',
    OPENLEAF_WEB_DIST: path.join(dataDir, 'no-web-dist'),
    ...env,
  })
  const app = await buildApp(config)
  afterAll(async () => {
    await app.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })
  return { app, dataDir }
}

let counter = 0

export type TestUser = { id: string; email: string; cookie: string }

export async function registerUser(
  app: FastifyInstance,
  name = 'Test User'
): Promise<TestUser> {
  const email = `user${++counter}-${Date.now()}@example.com`
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name, password: 'correct horse' },
  })
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`)
  return {
    id: res.json().user.id,
    email,
    cookie: cookieFrom(res.headers['set-cookie']),
  }
}

export function cookieFrom(header: string | string[] | undefined): string {
  const first = Array.isArray(header) ? header[0] : header
  if (!first) throw new Error('no set-cookie header')
  return first.split(';')[0]
}

/** `app.inject` with a session cookie and JSON body. */
export function as(app: FastifyInstance, user: TestUser) {
  return (opts: InjectOptions) =>
    app.inject({
      ...opts,
      headers: { cookie: user.cookie, ...(opts.headers ?? {}) },
    })
}

export async function createProject(
  app: FastifyInstance,
  user: TestUser,
  template: 'blank' | 'example' = 'blank',
  name = 'Test project'
): Promise<string> {
  const res = await as(
    app,
    user
  )({
    method: 'POST',
    url: '/api/projects',
    payload: { name, template },
  })
  if (res.statusCode !== 201)
    throw new Error(`create project failed: ${res.body}`)
  return res.json().id
}

export type TreeJson = {
  rootFolderId: string
  entries: {
    id: string
    parentId: string | null
    kind: string
    name: string
    size: number
  }[]
}

export async function getTree(
  app: FastifyInstance,
  user: TestUser,
  projectId: string
) {
  const res = await as(
    app,
    user
  )({ method: 'GET', url: `/api/projects/${projectId}/tree` })
  return res.json() as TreeJson
}

/** Paths of every doc/file (and folder, suffixed with '/') in a tree. */
export function treePaths(tree: TreeJson): string[] {
  const byId = new Map(tree.entries.map(e => [e.id, e]))
  const pathOf = (id: string): string => {
    const e = byId.get(id)
    if (!e) return ''
    const parent =
      e.parentId && e.parentId !== tree.rootFolderId ? pathOf(e.parentId) : ''
    return parent ? `${parent}/${e.name}` : e.name
  }
  return tree.entries
    .map(e => (e.kind === 'folder' ? `${pathOf(e.id)}/` : pathOf(e.id)))
    .sort()
}

export async function multipart(
  fields: Record<string, string>,
  files: { name: string; data: Uint8Array | string; field?: string }[]
) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  for (const f of files) {
    const bytes =
      typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data
    form.append(f.field ?? 'file', new Blob([bytes]), f.name)
  }
  const req = new Request('http://localhost/', { method: 'POST', body: form })
  return {
    payload: Buffer.from(await req.arrayBuffer()),
    headers: { 'content-type': req.headers.get('content-type') as string },
  }
}
