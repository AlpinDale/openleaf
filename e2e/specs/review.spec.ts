import { expect, test } from '@playwright/test'
import {
  createProject,
  cursorToLineEnd,
  editorContent,
  registerUser,
  selectWordInEditor,
} from './helpers.js'

test('comments persist and tracked changes can be rejected', async ({
  page,
}) => {
  await registerUser(page)
  await createProject(page, 'blank')

  await cursorToLineEnd(page, '\\section{Introduction}')
  await page.keyboard.press('Enter')
  await page.keyboard.type('The quick brown fox.')

  // Comment on a selected word.
  await selectWordInEditor(page, 'quick')
  await page.locator('.ol-add-comment-button').click()
  const composer = page.getByTestId('comment-composer')
  await composer.getByRole('textbox').fill('Is this fast enough?')
  await composer.getByRole('button', { name: 'Comment', exact: true }).click()

  const commentCard = page.locator('.ol-review-card-comment', {
    hasText: 'Is this fast enough?',
  })
  const highlight = editorContent(page).locator('.ol-comment', {
    hasText: /^quick$/,
  })
  await expect(commentCard).toBeVisible()
  await expect(highlight).toBeVisible()

  // Both survive a reload.
  await page.reload()
  await expect(editorContent(page)).toContainText('The quick brown fox.')
  const reviewButton = page.getByTestId('review-button')
  if ((await reviewButton.getAttribute('aria-pressed')) !== 'true')
    await reviewButton.click()
  await expect(commentCard).toBeVisible()
  await expect(highlight).toBeVisible()

  // Track my changes, type a word, then reject it.
  await page
    .getByRole('combobox', { name: 'Track changes' })
    .selectOption({ label: 'On for me' })
  await expect(page.getByTestId('track-changes-badge')).toBeVisible()
  await cursorToLineEnd(page, 'The quick brown fox.')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type(' jumps')

  const insert = editorContent(page).locator('.ol-tc-insert', {
    hasText: 'jumps',
  })
  await expect(insert).toBeVisible()
  const changeCard = page.locator('.ol-review-card-change', {
    hasText: 'jumps',
  })
  await expect(changeCard).toBeVisible()

  await changeCard.getByRole('button', { name: 'Reject' }).click()
  await expect(editorContent(page)).not.toContainText('jumps')
  await expect(editorContent(page)).toContainText('The quick brown fox.')
  await expect(changeCard).toHaveCount(0)
})
