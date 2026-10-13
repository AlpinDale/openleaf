import { expect, type Page, test } from '@playwright/test'
import {
  activeLine,
  createProject,
  cursorToLineEnd,
  editorContent,
  registerUser,
} from './helpers.js'

const tabs = (page: Page) => page.getByTestId('editor-tabs').getByRole('tab')
const tab = (page: Page, name: string) =>
  page.getByTestId('editor-tabs').getByRole('tab').filter({ hasText: name })

async function entryIds(page: Page, projectId: string) {
  const response = await page.request.get(`/api/projects/${projectId}/tree`)
  const tree = (await response.json()) as {
    rootFolderId: string
    entries: { id: string; name: string }[]
  }
  const byName = new Map(tree.entries.map(entry => [entry.name, entry.id]))
  return { rootFolderId: tree.rootFolderId, byName }
}

async function setEditingMode(
  page: Page,
  mode: 'editing' | 'reviewing' | 'viewing'
) {
  await page.getByTestId('review-mode-switcher').click()
  await page.getByTestId(`editing-mode-${mode}`).click()
  await expect(page.getByTestId('review-mode-switcher')).toHaveAttribute(
    'data-mode',
    mode
  )
}

test('editor tabs: preview tabs, pinning by editing, closing', async ({
  page,
}) => {
  await registerUser(page)
  const projectId = await createProject(page, 'example')
  const treeItem = (name: string) =>
    page.getByTestId('file-tree').getByRole('treeitem', { name, exact: true })

  // The opened doc gets a preview (temporary) tab; editing pins it.
  await expect(tabs(page)).toHaveCount(1)
  await expect(tab(page, 'main.tex')).toHaveClass(/tab-temporary/)
  await cursorToLineEnd(page, '\\section{Introduction}')
  await page.keyboard.type(' pinned')
  await expect(tab(page, 'main.tex')).not.toHaveClass(/tab-temporary/)

  // A second doc opens in a new preview tab next to the pinned one.
  await treeItem('references.bib').click()
  await expect(tabs(page)).toHaveCount(2)
  await expect(tab(page, 'references.bib')).toHaveClass(/tab-temporary/)
  await expect(tab(page, 'references.bib')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(editorContent(page)).toContainText('@book{knuth1984')

  // Opening a third doc without editing replaces the preview tab.
  const { rootFolderId } = await entryIds(page, projectId)
  const created = await page.request.post(
    `/api/projects/${projectId}/entries`,
    { data: { parentId: rootFolderId, name: 'third.tex', kind: 'doc' } }
  )
  expect(created.ok()).toBe(true)
  await treeItem('third.tex').click()
  await expect(tabs(page)).toHaveCount(2)
  await expect(tab(page, 'references.bib')).toHaveCount(0)
  await expect(tab(page, 'third.tex')).toHaveAttribute('aria-selected', 'true')

  // Switching tabs switches the doc.
  await tab(page, 'main.tex').click()
  await expect(editorContent(page)).toContainText('Introduction} pinned')

  // Closing a tab removes it; closing the active one opens its neighbour.
  await tab(page, 'third.tex').getByRole('button', { name: 'Close' }).click()
  await expect(tabs(page)).toHaveCount(1)
  await expect(tab(page, 'main.tex')).toHaveAttribute('aria-selected', 'true')

  // Double-clicking a preview tab pins it; tabs persist across a reload.
  await treeItem('references.bib').click()
  await expect(tab(page, 'references.bib')).toHaveClass(/tab-temporary/)
  await tab(page, 'references.bib').dblclick()
  await expect(tab(page, 'references.bib')).not.toHaveClass(/tab-temporary/)
  await page.reload()
  await expect(tabs(page)).toHaveCount(2)

  // Middle-click closes a tab.
  await tab(page, 'references.bib').click({ button: 'middle' })
  await expect(tabs(page)).toHaveCount(1)
})

test('editing mode switch: reviewing tracks, viewing is read-only', async ({
  page,
}) => {
  await registerUser(page)
  await createProject(page, 'blank')
  await expect(page.getByTestId('review-mode-switcher')).toHaveAttribute(
    'data-mode',
    'editing'
  )

  // Reviewing: my edits become tracked insertions.
  await setEditingMode(page, 'reviewing')
  await cursorToLineEnd(page, '\\section{Introduction}')
  await page.keyboard.type(' suggested')
  await expect(
    editorContent(page).locator('.ol-tc-insert', { hasText: 'suggested' })
  ).toBeVisible()

  // Viewing: typing changes nothing.
  await setEditingMode(page, 'viewing')
  const before = await editorContent(page).textContent()
  await cursorToLineEnd(page, '\\section{Introduction}')
  await page.keyboard.type('ignored')
  await expect(editorContent(page)).not.toContainText('ignored')
  expect(await editorContent(page).textContent()).toBe(before)

  // Editing again: edits apply directly, untracked.
  await setEditingMode(page, 'editing')
  await cursorToLineEnd(page, '\\maketitle')
  await page.keyboard.type(' direct')
  await expect(editorContent(page)).toContainText('\\maketitle direct')
  await expect(
    editorContent(page).locator('.ol-tc-insert', { hasText: 'direct' })
  ).toHaveCount(0)
})

test('deep link ?doc=&line= opens the doc at that line', async ({ page }) => {
  await registerUser(page)
  const projectId = await createProject(page, 'example')
  const { byName } = await entryIds(page, projectId)
  const bibId = byName.get('references.bib')
  if (!bibId) throw new Error('references.bib missing from the example')

  await page.goto(`/project/${projectId}?doc=${bibId}&line=9`)
  await expect(activeLine(page)).toContainText('Leslie Lamport')
  await expect(tab(page, 'references.bib')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  // the parameters are stripped once handled
  await expect(page).toHaveURL(new RegExp(`/project/${projectId}$`))

  // An unknown doc shows a toast instead.
  await page.goto(
    `/project/${projectId}?doc=00000000-0000-0000-0000-000000000000`
  )
  await expect(page.getByText('The linked file was not found')).toBeVisible()
})
