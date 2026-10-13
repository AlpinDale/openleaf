import { describe, expect, it } from 'vitest'
import {
  as,
  createProject,
  createTestApp,
  getTree,
  multipart,
  registerUser,
} from './helpers.js'

describe('main bibliography setting', async () => {
  const { app } = await createTestApp()
  const user = await registerUser(app)
  const req = as(app, user)
  const json = { 'content-type': 'application/json' }

  async function setup() {
    const projectId = await createProject(app, user, 'example')
    const tree = await getTree(app, user, projectId)
    const id = (name: string) =>
      tree.entries.find(e => e.name === name)?.id as string
    return {
      projectId,
      bibId: id('references.bib'),
      mainId: id('main.tex'),
      tree,
    }
  }
  const details = async (projectId: string) =>
    (await req({ method: 'GET', url: `/api/projects/${projectId}` })).json()
  const patch = (projectId: string, mainBibDocId: string | null) =>
    req({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      payload: { mainBibDocId },
    })

  it('accepts only .bib documents of the same project', async () => {
    const { projectId, bibId, mainId } = await setup()
    expect((await patch(projectId, mainId)).statusCode).toBe(400)
    const other = await setup()
    expect((await patch(projectId, other.bibId)).statusCode).toBe(400)
    expect((await patch(projectId, bibId)).statusCode).toBe(200)
    expect((await details(projectId)).mainBibDocId).toBe(bibId)
  })

  it('is cleared when the .bib is deleted', async () => {
    const { projectId, bibId } = await setup()
    await patch(projectId, bibId)
    await req({
      method: 'DELETE',
      url: `/api/projects/${projectId}/entries/${bibId}`,
      headers: json,
    })
    expect((await details(projectId)).mainBibDocId).toBeNull()
  })

  it('is remapped to the copied .bib when a project is copied', async () => {
    const { projectId, bibId } = await setup()
    await patch(projectId, bibId)
    const copy = await req({
      method: 'POST',
      url: `/api/projects/${projectId}/copy`,
      payload: { name: 'Copy' },
    })
    const copyId = copy.json().id as string
    const copyBib = (await getTree(app, user, copyId)).entries.find(
      e => e.name === 'references.bib'
    )?.id
    expect(copyBib).toBeDefined()
    expect(copyBib).not.toBe(bibId)
    expect((await details(copyId)).mainBibDocId).toBe(copyBib)
  })

  it('is retained across .bib renames and cleared when renamed to another extension', async () => {
    const { projectId, bibId } = await setup()
    await patch(projectId, bibId)
    const rename = (name: string) =>
      req({
        method: 'POST',
        url: `/api/projects/${projectId}/entries/${bibId}/rename`,
        payload: { name },
      })
    expect((await rename('library.BIB')).statusCode).toBe(200)
    expect((await details(projectId)).mainBibDocId).toBe(bibId)
    expect((await rename('library.txt')).statusCode).toBe(200)
    expect((await details(projectId)).mainBibDocId).toBeNull()
  })

  it('is cleared when a history restore removes the .bib', async () => {
    const { projectId, tree } = await setup()
    // A version without the new .bib, then add and select it.
    const [first] = (
      await req({ method: 'GET', url: `/api/projects/${projectId}/history` })
    ).json().versions
    const upload = await req({
      method: 'POST',
      url: `/api/projects/${projectId}/upload`,
      ...(await multipart({ parentId: tree.rootFolderId }, [
        { name: 'extra.bib', data: '@misc{x, title={X}}\n' },
      ])),
    })
    const extraId = upload.json().entries[0].id as string
    await patch(projectId, extraId)
    const restore = await req({
      method: 'POST',
      url: `/api/projects/${projectId}/history/${first.oid}/restore`,
      payload: {},
    })
    expect(restore.statusCode).toBe(200)
    expect((await details(projectId)).mainBibDocId).toBeNull()
  })
})
