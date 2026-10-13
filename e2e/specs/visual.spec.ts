import { expect, test } from '@playwright/test'
import {
  createProject,
  cursorToLineEnd,
  editorContent,
  editorLine,
  registerUser,
} from './helpers.js'

test('Visual Editor renders headings and math', async ({ page }) => {
  await registerUser(page)
  await createProject(page, 'blank')

  await cursorToLineEnd(page, '\\section{Introduction}')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Inline math $x^2$ here.')
  await page.keyboard.press('Escape')
  await expect(editorLine(page, 'Inline math')).toHaveText(
    'Inline math $x^2$ here.'
  )
  // Keep the cursor away from the lines under test so they render.
  await editorLine(page, '\\documentclass').click()

  await page.getByText('Visual', { exact: true }).click()
  await expect(page.locator('input[value="rich-text"]')).toBeChecked()

  const heading = editorContent(page)
    .locator('.ol-cm-heading', { hasText: 'Introduction' })
    .first()
  await expect(heading).toBeVisible()
  await expect(heading).not.toContainText('\\')
  await expect(heading).not.toContainText('section')

  await expect(
    editorLine(page, 'Inline math').locator('mjx-container svg')
  ).toBeVisible()
})
