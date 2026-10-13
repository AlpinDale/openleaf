import { expect, test } from '@playwright/test'
import {
  activeLine,
  createProject,
  cursorToLineEnd,
  editorLine,
  registerUser,
  waitForCompileIdle,
  waitForPdf,
} from './helpers.js'

test('compile errors show in the logs and the editor gutter', async ({
  page,
}) => {
  await registerUser(page)
  await createProject(page, 'blank')
  await waitForPdf(page)

  await cursorToLineEnd(page, '\\section{Introduction}')
  await page.keyboard.press('Enter')
  await page.keyboard.type('\\foo')
  await page.keyboard.press('Escape')
  await expect(editorLine(page, '\\foo')).toBeVisible()

  await waitForCompileIdle(page)
  await page.getByTestId('recompile-button').click()
  await waitForCompileIdle(page)

  // The logs button counts at least one error.
  const count = page.getByTestId('logs-count')
  await expect(count).toBeVisible()
  await expect
    .poll(async () => Number(await count.getAttribute('data-errors')))
    .toBeGreaterThanOrEqual(1)

  // The gutter shows an error marker level with the `\foo` line.
  const fooLine = editorLine(page, '\\foo')
  const marker = page.locator('.cm-gutter-lint .cm-lint-marker-error').first()
  await expect(marker).toBeVisible()
  await expect
    .poll(async () => {
      const [lineBox, markerBox] = await Promise.all([
        fooLine.boundingBox(),
        marker.boundingBox(),
      ])
      if (!lineBox || !markerBox) return Number.POSITIVE_INFINITY
      return Math.abs(
        lineBox.y + lineBox.height / 2 - (markerBox.y + markerBox.height / 2)
      )
    })
    .toBeLessThan(6)

  // Clicking the log entry's location focuses that line.
  await editorLine(page, '\\documentclass').click()
  await expect(activeLine(page)).toContainText('\\documentclass')
  await page.getByTestId('logs-button').click()
  const entry = page
    .locator('[data-testid="log-entry"][data-level="error"]')
    .first()
  await expect(entry).toContainText('Undefined control sequence')
  await entry.getByTestId('log-entry-go-to-code').click()
  await expect(activeLine(page)).toContainText('\\foo')
})
