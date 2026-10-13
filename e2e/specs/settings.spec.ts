import { expect, test } from '@playwright/test'
import {
  createProject,
  cursorToLineEnd,
  editorContent,
  registerUser,
} from './helpers.js'

test('settings modal, dictionary editor, main bibliography and new references', async ({
  page,
}) => {
  await registerUser(page)
  const projectId = await createProject(page, 'example')

  // Settings open from the rail; the breadcrumbs toggle applies immediately.
  await expect(page.locator('.ol-cm-breadcrumbs')).toBeVisible()
  await page.getByTestId('rail-tab-settings').click()
  const modal = page.getByTestId('settings-modal')
  await expect(modal).toBeVisible()
  await modal.getByTestId('setting-breadcrumbs').click()
  await expect(page.locator('.ol-cm-breadcrumbs')).toHaveCount(0)

  // Dictionary editor adds and removes learned words.
  await modal.getByTestId('settings-tab-spelling_and_language').click()
  await modal.locator('#dictionary-settings').click()
  const dictionary = page.getByTestId('dictionary-modal')
  await dictionary.getByTestId('dictionary-add-input').fill('zzqword')
  await dictionary.getByTestId('dictionary-add-input').press('Enter')
  const entry = dictionary
    .getByTestId('dictionary-entry')
    .filter({ hasText: 'zzqword' })
  await expect(entry).toBeVisible()
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/auth/me')).json()).learnedWords
    )
    .toContain('zzqword')
  await entry.getByRole('button', { name: 'Remove from dictionary' }).click()
  await expect(entry).toHaveCount(0)
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/auth/me')).json()).learnedWords
    )
    .not.toContain('zzqword')
  await page.keyboard.press('Escape')

  // Main bibliography file.
  await expect(dictionary).toBeHidden()
  if (!(await modal.isVisible()))
    await page.getByTestId('rail-tab-settings').click()
  await modal.getByTestId('settings-tab-references').click()
  await modal
    .locator('#mainBibliographyDocId')
    .selectOption({ label: 'references.bib' })
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/projects/${projectId}`)).json())
          .mainBibDocId
    )
    .not.toBeNull()
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()

  // Insert → Citation → Add new reference appends to the main .bib and cites it.
  await cursorToLineEnd(page, '\\section{Conclusion}')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Insert', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Citation' }).click()
  const dialog = page.getByTestId('citation-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('citation-add-new').click()
  await dialog
    .getByTestId('citation-bibtex')
    .fill(
      '@book{e2etest2026,\n  title = {End to End},\n  author = {Tester, Ada},\n  year = {2026}\n}'
    )
  await dialog.getByRole('button', { name: 'Add and cite' }).click()
  await expect(dialog).toBeHidden()
  await expect(editorContent(page)).toContainText('\\cite{e2etest2026}')

  await page
    .getByRole('treeitem', { name: 'references.bib', exact: true })
    .click()
  await expect(editorContent(page)).toContainText('@book{e2etest2026,')
})

for (const firstFails of [false, true]) {
  test(`queued settings changes survive an earlier ${firstFails ? 'failure' : 'slow response'}`, async ({
    page,
  }) => {
    await registerUser(page)
    await createProject(page, 'blank')
    await page.getByTestId('rail-tab-settings').click()
    const modal = page.getByTestId('settings-modal')
    let completed = 0
    const firstResponseGate = Promise.withResolvers<void>()
    let requests = 0
    await page.route('**/api/users/me', async route => {
      if (route.request().method() !== 'PATCH') {
        await route.continue()
        return
      }
      requests++
      if (requests === 1) {
        // Hold the earlier result until the second toggle has been clicked.
        const response = firstFails ? undefined : await route.fetch()
        await firstResponseGate.promise
        const delay = Promise.withResolvers<void>()
        setTimeout(delay.resolve, 300)
        await delay.promise
        if (response) {
          await route.fulfill({ response })
        } else {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'validation', message: 'Rejected first change' },
            }),
          })
        }
      } else {
        const response = await route.fetch()
        await route.fulfill({ response })
      }
      completed++
    })

    await modal.getByTestId('setting-breadcrumbs').click()
    await expect.poll(() => requests).toBe(1)
    await modal.getByTestId('setting-nonBlinkingCursor').click()
    await expect(modal.getByTestId('setting-nonBlinkingCursor')).toBeChecked()
    firstResponseGate.resolve()
    await expect.poll(() => completed).toBe(2)
    await expect(modal.getByTestId('setting-nonBlinkingCursor')).toBeChecked()
    if (firstFails) {
      await expect(modal.getByTestId('setting-breadcrumbs')).toBeChecked()
    } else {
      await expect(modal.getByTestId('setting-breadcrumbs')).not.toBeChecked()
    }
    const me = await (await page.request.get('/api/auth/me')).json()
    expect(me.settings.nonBlinkingCursor).toBe(true)
    expect(me.settings.breadcrumbs).toBe(firstFails)
  })
}
