import fs from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import {
  createProject,
  cursorToLineEnd,
  editorContent,
  registerUser,
} from './helpers.js'

const FIRST_EDIT = 'The first edit of this project.'
const SECOND_EDIT = 'The second edit of this project.'

/** Types `text` on a new line after `afterLine`, then records a version. */
async function editAndOpenHistory(page: Page, afterLine: string, text: string) {
  await cursorToLineEnd(page, afterLine)
  await page.keyboard.press('Enter')
  await page.keyboard.type(text)
  await expect(editorContent(page)).toContainText(text)
  // Opening History flushes the pending edit into a new version.
  await page.getByTestId('history-button').click()
  await expect(page.getByTestId('history-view')).toBeVisible()
}

async function versionAction(page: Page, index: number, action: string) {
  const version = page.getByTestId('history-version').nth(index)
  await version.getByTestId('history-version-actions').click()
  await version.getByTestId(action).click()
}

test('labels tab, comparing two versions and downloading a version', async ({
  page,
}) => {
  await registerUser(page)
  await createProject(page, 'blank')

  await editAndOpenHistory(page, '\\section{Introduction}', FIRST_EDIT)
  const versions = page.getByTestId('history-version')
  await expect(versions).toHaveCount(2)
  await page.getByTestId('history-back-to-editor').click()

  await editAndOpenHistory(page, FIRST_EDIT, SECOND_EDIT)
  // Newest first: second edit, first edit, project creation.
  await expect(versions).toHaveCount(3)

  // Label the first edit from its ⋮ menu.
  await versionAction(page, 1, 'history-version-add-label')
  const labelDialog = page.getByRole('dialog')
  await labelDialog.getByLabel('Label').fill('First draft')
  await labelDialog.getByRole('button', { name: 'Add label' }).click()
  await expect(labelDialog).toBeHidden()
  await expect(versions.nth(1).getByTestId('history-label-badge')).toHaveText(
    /First draft/
  )

  // The Labels tab lists only the labelled version.
  await page.getByTestId('history-tab-labels').click()
  await expect(page.getByRole('radio', { name: 'Labels' })).toBeChecked()
  await expect(versions).toHaveCount(1)
  await expect(versions.first()).toContainText('First draft')
  await page.getByTestId('history-tab-all').click()
  await expect(versions).toHaveCount(3)

  // Compare the project's creation with the first edit.
  await versionAction(page, 2, 'history-compare-from')
  await expect(page.getByTestId('history-comparing')).toBeVisible()
  await versionAction(page, 1, 'history-compare-up-to')
  await expect(versions.nth(2)).toHaveAttribute('data-compare-from', 'true')
  await expect(versions.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(versions.nth(0)).toHaveAttribute('aria-pressed', 'false')

  const diff = page.getByTestId('history-diff')
  await expect(diff.locator('.cm-changedLine')).toHaveText([FIRST_EDIT])
  await expect(diff.locator('.cm-deletedLine')).toHaveCount(0)
  await expect(diff).not.toContainText(SECOND_EDIT)

  // "Download this version" returns the version as a zip.
  const downloadPromise = page.waitForEvent('download')
  await versionAction(page, 1, 'history-version-download')
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.zip$/)
  const bytes = await fs.readFile(await download.path())
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004')
  expect(bytes.includes('main.tex')).toBe(true)
})
