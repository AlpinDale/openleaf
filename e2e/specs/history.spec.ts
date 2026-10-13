import { expect, test } from '@playwright/test'
import {
  createProject,
  cursorToLineEnd,
  editorContent,
  registerUser,
} from './helpers.js'

test('restoring a previous version reverts the editor text', async ({
  page,
}) => {
  await registerUser(page)
  await createProject(page, 'blank')
  await expect(editorContent(page)).toContainText('\\section{Introduction}')

  await cursorToLineEnd(page, '\\section{Introduction}')
  await page.keyboard.press('Enter')
  await page.keyboard.type('A sentence that history will undo.')
  await expect(editorContent(page)).toContainText(
    'A sentence that history will undo.'
  )

  // Opening History flushes the pending edit into a new version.
  await page.getByTestId('history-button').click()
  await expect(page.getByTestId('history-view')).toBeVisible()
  const versions = page.getByTestId('history-version')
  await expect(versions).toHaveCount(2)

  // Newest first: the last entry is the project's initial version.
  await versions.last().click()
  await expect(versions.last()).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('history-restore-version').click()
  await page.getByTestId('history-restore-confirm').click()

  await expect(page.getByTestId('history-view')).toBeHidden()
  await expect(editorContent(page)).toContainText('\\section{Introduction}')
  await expect(editorContent(page)).not.toContainText(
    'A sentence that history will undo.'
  )

  // The restore itself is recorded as the newest version.
  await page.getByTestId('history-button').click()
  await expect(versions).toHaveCount(3)
})
