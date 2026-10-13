import { expect, test } from '@playwright/test'
import {
  activeLine,
  createProject,
  cursorToLineEnd,
  editorContent,
  editorLine,
  pdfCanvas,
  registerUser,
  waitForPdf,
} from './helpers.js'

test('example project: PDF, autocomplete, environments, SyncTeX', async ({
  page,
}) => {
  await registerUser(page)
  await createProject(page, 'example')

  await expect(
    page.getByRole('treeitem', { name: 'main.tex', exact: true })
  ).toBeVisible()
  await expect(editorContent(page)).toContainText('\\section{Introduction}')

  // The initial compile renders at least one page.
  await waitForPdf(page)
  await expect(pdfCanvas(page)).toBeVisible()

  // Autocomplete for commands.
  await cursorToLineEnd(page, 'Lamport~\\cite{lamport1994}')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('\\textbf')
  const completions = page.locator('.cm-tooltip-autocomplete')
  await expect(completions).toBeVisible()
  await expect(completions).toContainText('\\textbf')
  await page.keyboard.press('Escape')
  await expect(completions).toBeHidden()

  // Environments close themselves: typed straight through (no pause), and at
  // a human pace where the completion list is showing when Enter is pressed.
  for (const [name, delay] of [
    ['itemize', 0],
    ['enumerate', 150],
  ] as const) {
    await page.keyboard.press('Enter')
    await page.keyboard.type(`\\begin{${name}}`, { delay })
    await page.keyboard.press('Enter')
    await expect(editorLine(page, `\\end{${name}}`)).toBeVisible()
    await expect(editorContent(page)).not.toContainText(`\\end{${name}}}`)
    await expect(editorContent(page)).not.toContainText('\\usepackage{}')
    // Leave the new environment before the next round.
    await page.keyboard.press('Escape')
    await editorLine(page, `\\end{${name}}`).click()
    await page.keyboard.press('End')
  }

  // PDF → code: double-click a word in the PDF moves the cursor into main.tex.
  await editorLine(page, '\\documentclass').click()
  await expect(activeLine(page)).toContainText('\\documentclass')
  const word = page
    .getByTestId('pdf-panel')
    .locator('.textLayer span', { hasText: 'Mathematics' })
    .first()
  await expect(word).toBeAttached()
  await word.dblclick()
  await expect(activeLine(page)).toContainText('Mathematics')
  await expect(
    page.getByRole('treeitem', { name: 'main.tex', exact: true })
  ).toHaveAttribute('aria-selected', 'true')

  // Code → PDF: the "→" button draws a highlight box in the PDF.
  await editorLine(page, '\\section{Introduction}').click()
  await page.getByTestId('sync-to-pdf').click()
  await expect(
    page.getByTestId('pdf-panel').locator('.synctex-highlight').first()
  ).toBeAttached()
})
