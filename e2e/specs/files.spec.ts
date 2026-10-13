import fs from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createProject, registerUser } from './helpers.js'

// A valid 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

/** Entry names from a zip's central directory. */
function zipEntryNames(zip: Buffer): string[] {
  const eocdSignature = 0x06054b50
  let eocd = -1
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === eocdSignature) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip: no end of central directory')
  const count = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50)
      throw new Error(`bad central directory header at ${offset}`)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    names.push(zip.toString('utf8', offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return names
}

test('upload, preview, move into a folder, download zip', async ({ page }) => {
  await registerUser(page)
  const projectId = await createProject(page, 'blank')
  const tree = page.getByTestId('file-tree')
  const treeItem = (name: string) =>
    tree.getByRole('treeitem', { name, exact: true })

  // Upload a PNG through the dialog.
  await page.getByTestId('file-tree-upload').click()
  const modal = page.getByTestId('upload-modal')
  await expect(modal).toBeVisible()
  await modal.getByTestId('upload-input').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
  await expect(modal).toBeHidden()
  await expect(treeItem('pixel.png')).toBeVisible()
  await expect(treeItem('pixel.png')).toHaveAttribute('data-entry-kind', 'file')

  // Selecting it shows an image preview.
  await treeItem('pixel.png').click()
  const image = page.getByTestId('file-view-image')
  await expect(image).toBeVisible()
  await expect
    .poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth))
    .toBe(1)

  // Create the folder `figs` at the root.
  await treeItem('main.tex').click()
  await page.getByTestId('file-tree-new-folder').click()
  const nameInput = page.getByTestId('file-tree-name-input')
  await nameInput.fill('figs')
  await nameInput.press('Enter')
  await expect(treeItem('figs')).toHaveAttribute('data-entry-kind', 'folder')

  // Drag the image into it.
  await treeItem('pixel.png').dragTo(treeItem('figs'))
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/projects/${projectId}/tree`)
      const body = (await response.json()) as {
        entries: { id: string; parentId: string | null; name: string }[]
      }
      const byId = new Map(body.entries.map(entry => [entry.id, entry]))
      const png = body.entries.find(entry => entry.name === 'pixel.png')
      return png?.parentId ? byId.get(png.parentId)?.name : undefined
    })
    .toBe('figs')
  const figs = treeItem('figs')
  if ((await figs.getAttribute('aria-expanded')) !== 'true') await figs.click()
  await expect(treeItem('pixel.png')).toHaveAttribute('aria-level', '2')

  // File → Download as source (.zip) contains the moved path.
  await page
    .getByTestId('menu-bar')
    .getByRole('button', { name: 'File', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Download', exact: true }).hover()
  const downloadPromise = page.waitForEvent('download')
  await page
    .getByRole('menuitem', { name: 'Download as source (.zip)' })
    .click()
  const download = await downloadPromise
  const zipPath = await download.path()
  const names = zipEntryNames(await fs.readFile(zipPath))
  expect(names).toContain('figs/pixel.png')
  expect(names).toContain('main.tex')
  expect(names).not.toContain('pixel.png')
})

test('an in-flight upload cannot dismiss or close a later upload dialog', async ({
  page,
}) => {
  await registerUser(page)
  const projectId = await createProject(page, 'blank')
  let releaseUpload!: () => void
  const uploadGate = new Promise<void>(resolve => {
    releaseUpload = resolve
  })
  await page.route(`**/api/projects/${projectId}/upload`, async route => {
    await uploadGate
    await route.continue()
  })

  await page.getByTestId('file-tree-upload').click()
  const modal = page.getByTestId('upload-modal')
  const pendingUpload = page.waitForRequest(request =>
    request.url().endsWith(`/projects/${projectId}/upload`)
  )
  await modal.getByTestId('upload-input').setInputFiles({
    name: 'pending.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
  await pendingUpload
  try {
    await expect(
      modal.getByRole('button', { name: 'Close', exact: true })
    ).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(modal).toBeVisible()
  } finally {
    releaseUpload()
  }
  await expect(modal).toBeHidden()
  await expect(
    page.getByTestId('file-tree').getByRole('treeitem', {
      name: 'pending.png',
      exact: true,
    })
  ).toBeVisible()

  await page.getByTestId('file-tree-upload').click()
  await expect(modal).toBeVisible()
  await expect(modal.getByTestId('upload-row')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
})

test('URL import stays open while pending and permits dismissal after failure', async ({
  page,
}) => {
  await registerUser(page)
  const projectId = await createProject(page, 'blank')
  let releaseImport!: () => void
  const importGate = new Promise<void>(resolve => {
    releaseImport = resolve
  })
  await page.route(
    `**/api/projects/${projectId}/entries/import-url`,
    async route => {
      await importGate
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Import failed' }),
      })
    }
  )
  await page.getByTestId('file-tree-import').click()
  await page.getByRole('menuitem', { name: 'From external URL' }).click()
  const modal = page.getByTestId('import-url-modal')
  await modal
    .getByLabel('URL to fetch the file from')
    .fill('https://example.com/pending.png')
  const pendingImport = page.waitForRequest(request =>
    request.url().endsWith('/entries/import-url')
  )
  await modal.getByRole('button', { name: 'Create', exact: true }).click()
  await pendingImport
  try {
    await expect(
      modal.getByRole('button', { name: 'Cancel', exact: true })
    ).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(modal).toBeVisible()
  } finally {
    releaseImport()
  }
  await expect(
    modal.getByRole('button', { name: 'Cancel', exact: true })
  ).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
})

test('unmatched upload conflicts fail without retrying the same batch', async ({
  page,
}) => {
  await registerUser(page)
  const projectId = await createProject(page, 'blank')
  let requests = 0
  await page.route(`**/api/projects/${projectId}/upload`, async route => {
    requests++
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Conflicting file',
        code: 'conflict',
        details: { conflicts: [{ name: 'unrelated.png' }] },
      }),
    })
  })
  await page.getByTestId('file-tree-upload').click()
  const modal = page.getByTestId('upload-modal')
  await modal.getByTestId('upload-input').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
  await expect(modal.getByTestId('upload-row')).toHaveAttribute(
    'data-status',
    'error'
  )
  expect(requests).toBe(1)
  await expect(
    modal.getByRole('button', { name: 'Close', exact: true })
  ).toBeEnabled()
})
