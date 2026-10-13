import { expect, test } from '@playwright/test'
import {
  createProject,
  cursorToLineEnd,
  editorContent,
  registerUser,
} from './helpers.js'

test('misspellings are underlined and can be learned', async ({ page }) => {
  await registerUser(page)
  await createProject(page, 'blank')

  await cursorToLineEnd(page, '\\section{Introduction}')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('This is teh text.')
  // Move off the word so the checker treats it as finished.
  await page.keyboard.press('Enter')

  const misspelled = editorContent(page).locator('.ol-cm-spelling-error', {
    hasText: /^teh$/,
  })
  await expect(misspelled).toBeVisible({ timeout: 30_000 })

  await misspelled.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add to dictionary' }).click()
  await expect(misspelled).toHaveCount(0)

  await page.goto('/settings')
  await expect(
    page
      .getByTestId('learned-word')
      .filter({ has: page.getByText('teh', { exact: true }) })
  ).toBeVisible()
})
