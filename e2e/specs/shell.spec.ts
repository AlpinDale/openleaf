import { expect, type Page, test } from '@playwright/test'
import {
  createProject,
  editorContent,
  editorLine,
  registerUser,
  waitForCompileIdle,
  waitForPdf,
} from './helpers.js'

// Overleaf's layout shortcuts: ⌃⌘ + arrow on macOS, Ctrl+Alt + arrow elsewhere.
const LAYOUT_MODIFIERS =
  process.platform === 'darwin' ? 'Control+Meta' : 'Control+Alt'

async function openMenuItem(page: Page, menu: string, item: string) {
  await page
    .getByTestId('menu-bar')
    .getByRole('button', { name: menu, exact: true })
    .click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

/** Puts the cursor on a new empty line after the line containing `text`. */
async function newLineAfter(page: Page, text: string) {
  await editorLine(page, text).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
}

test('shell: focus mode, layouts, command palette, PDF and menus', async ({
  page,
}) => {
  await registerUser(page)
  await createProject(page, 'example')
  await waitForPdf(page)
  await waitForCompileIdle(page)

  const rail = page.getByTestId('rail-tab-files')
  const exitFocusMode = page.getByTestId('exit-focus-mode')

  // Focus mode: ⌘⇧M hides the rail and top-bar chrome; Esc brings them back.
  await editorLine(page, '\\section{Introduction}').click()
  await page.keyboard.press('ControlOrMeta+Shift+M')
  await expect(rail).toBeHidden()
  await expect(page.getByTestId('menu-bar')).toBeHidden()
  await expect(exitFocusMode).toBeVisible()
  await expect(editorContent(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(rail).toBeVisible()
  await expect(exitFocusMode).toBeHidden()
  await expect(page.getByTestId('menu-bar')).toBeVisible()

  // Layout shortcuts: PDF only collapses the editor, split view restores it.
  const editorPanelWidth = () =>
    editorContent(page).evaluate(
      element =>
        element.closest('.openleaf-editor-panel')?.getBoundingClientRect()
          .width ?? -1
    )
  await page.keyboard.press(`${LAYOUT_MODIFIERS}+ArrowRight`)
  await expect.poll(editorPanelWidth).toBeLessThan(1)
  await expect(page.getByTestId('pdf-viewer')).toBeVisible()
  await page.getByTestId('layout-dropdown').click()
  await expect(page.getByTestId('layout-pdfOnly')).toHaveAttribute(
    'aria-current',
    'true'
  )
  await page.keyboard.press('Escape')
  await page.keyboard.press(`${LAYOUT_MODIFIERS}+ArrowDown`)
  await expect.poll(editorPanelWidth).toBeGreaterThan(100)

  // Command palette: ⌘P, search, Enter runs the command.
  await editorLine(page, '\\section{Introduction}').click()
  await page.keyboard.press('ControlOrMeta+p')
  const search = page.getByRole('textbox', { name: 'Command palette search' })
  await expect(search).toBeFocused()
  await search.fill('word cou')
  await expect(
    page.getByRole('menuitem', { name: 'Word count', exact: true })
  ).toBeVisible()
  await search.press('Enter')
  const wordCount = page.getByTestId('word-count-modal')
  await expect(wordCount).toBeVisible()
  await expect(page.getByTestId('word-count-table')).toBeVisible({
    timeout: 60_000,
  })
  await expect(search).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(wordCount).toBeHidden()

  // PDF toolbar: Next page moves to page 2 of the example's two pages.
  const pageInput = page.getByTestId('pdf-page-input')
  await expect(page.getByTestId('pdf-total-pages')).toHaveText('/ 2')
  await expect(pageInput).toHaveValue('1')
  await page.getByTestId('pdf-next-page').click()
  await expect(pageInput).toHaveValue('2')
  await expect(page.getByTestId('pdf-next-page')).toBeDisabled()
  await page.getByTestId('pdf-previous-page').click()
  await expect(pageInput).toHaveValue('1')

  // Recompile from scratch clears the cache, then compiles a fresh PDF.
  await page.getByTestId('recompile-dropdown').click()
  const clearCache = page.waitForRequest(
    request =>
      request.method() === 'DELETE' && request.url().endsWith('/compile/cache')
  )
  const compile = page.waitForResponse(
    response =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/compile')
  )
  await page.getByTestId('recompile-from-scratch').click()
  await clearCache
  const compileResponse = await compile
  expect((await compileResponse.json()).status).toBe('success')
  await waitForCompileIdle(page)
  await waitForPdf(page)
  await expect(page.getByTestId('compile-status-text')).toHaveAttribute(
    'data-status',
    'success'
  )

  // Format → Bullet list wraps the current line in an itemize environment.
  await editorLine(page, 'This is an example project.').click()
  await openMenuItem(page, 'Format', 'Bullet list')
  await expect(editorLine(page, '\\begin{itemize}')).toBeVisible()
  await expect(editorLine(page, '\\end{itemize}')).toBeVisible()
  await expect(
    editorLine(page, '\\item This is an example project.')
  ).toBeVisible()

  // Insert → Abstract inserts an abstract environment at the cursor.
  await newLineAfter(page, '\\maketitle')
  await openMenuItem(page, 'Insert', 'Abstract')
  await expect(editorLine(page, '\\begin{abstract}')).toBeVisible()
  await expect(editorLine(page, '\\end{abstract}')).toBeVisible()
  await page.keyboard.type('A short summary.')
  await expect(editorLine(page, 'A short summary.')).toBeVisible()
})
