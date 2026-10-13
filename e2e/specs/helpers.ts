import { randomUUID } from 'node:crypto'
import { expect, type Locator, type Page } from '@playwright/test'

export interface TestUser {
  name: string
  email: string
  password: string
}

/** Registers a fresh user through the UI and lands on the dashboard. */
export async function registerUser(page: Page): Promise<TestUser> {
  const id = randomUUID().slice(0, 8)
  const user = {
    name: `E2E User ${id}`,
    email: `e2e-${id}@example.com`,
    password: `password-${id}`,
  }
  await page.goto('/register')
  const form = page.getByTestId('register-form')
  await form.getByLabel('Name').fill(user.name)
  await form.getByLabel('Email').fill(user.email)
  await form.getByLabel('Password').fill(user.password)
  await form.getByRole('button', { name: 'Register' }).click()
  await expect(page.getByTestId('new-project-menu')).toBeVisible()
  return user
}

/**
 * Creates a project from the dashboard's "New project" menu and waits until
 * the editor shows `main.tex`. Returns the project id.
 */
export async function createProject(
  page: Page,
  template: 'blank' | 'example',
  name = `Project ${randomUUID().slice(0, 8)}`
): Promise<string> {
  await page.getByTestId('new-project-menu').click()
  await page.getByTestId(`new-project-${template}`).click()
  const modal = page.getByTestId('new-project-modal')
  await modal.getByLabel('Project name').fill(name)
  await modal.getByRole('button', { name: 'Create' }).click()
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/)
  await expect(editorContent(page)).toContainText('\\documentclass')
  const match = /\/project\/([0-9a-f-]{36})$/.exec(page.url())
  if (!match) throw new Error(`unexpected editor URL ${page.url()}`)
  return match[1]
}

export function editorContent(page: Page): Locator {
  return page.locator('.cm-editor .cm-content').first()
}

/** The editor line holding the cursor. */
export function activeLine(page: Page): Locator {
  return editorContent(page).locator('.cm-line.cm-activeLine')
}
/** The CodeMirror line element whose text contains `text`. */
export function editorLine(page: Page, text: string): Locator {
  return editorContent(page).locator('.cm-line', { hasText: text }).first()
}

/** Places the cursor at the end of the line containing `text`. */
export async function cursorToLineEnd(page: Page, text: string) {
  await editorLine(page, text).click()
  await page.keyboard.press('End')
}

/** Selects `word` on the (first) editor line containing it. */
export async function selectWordInEditor(page: Page, word: string) {
  const line = editorLine(page, word)
  await line.click()
  await page.keyboard.press('Home')
  const text = (await line.textContent()) ?? ''
  const index = text.indexOf(word)
  if (index < 0) throw new Error(`"${word}" not on line "${text}"`)
  for (let i = 0; i < index; i++) await page.keyboard.press('ArrowRight')
  for (let i = 0; i < word.length; i++)
    await page.keyboard.press('Shift+ArrowRight')
}

/** The first rendered page canvas in the PDF panel. */
export function pdfCanvas(page: Page): Locator {
  return page.getByTestId('pdf-panel').locator('.pdfViewer canvas').first()
}

export async function waitForPdf(page: Page) {
  await expect(pdfCanvas(page)).toBeVisible({ timeout: 60_000 })
}

/** Waits until the current compile has finished (status is no longer busy). */
export async function waitForCompileIdle(page: Page) {
  await expect(page.getByTestId('recompile-button')).toBeEnabled({
    timeout: 60_000,
  })
  await expect(page.getByTestId('compile-status-text')).not.toHaveAttribute(
    'data-status',
    'compiling',
    { timeout: 60_000 }
  )
}
