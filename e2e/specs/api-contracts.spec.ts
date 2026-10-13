import { expect, test } from '@playwright/test'
import {
  CreateEntryBody,
  ImportProjectFileBody,
  ImportUrlBody,
  RenameEntryBody,
} from '../../packages/shared/src/api.js'
import {
  DEFAULT_USER_SETTINGS,
  parseUserSettings,
  UserSettingsSchema,
} from '../../packages/shared/src/settings.js'
import { ProjectEvent } from '../../packages/shared/src/ydoc.js'
import { createProject, registerUser } from './helpers.js'

const entryBodies = [
  { schema: CreateEntryBody, body: { parentId: 'parent', kind: 'doc' } },
  { schema: RenameEntryBody, body: {} },
  {
    schema: ImportUrlBody,
    body: { parentId: 'parent', url: 'https://example.com/main.tex' },
  },
  {
    schema: ImportProjectFileBody,
    body: {
      parentId: 'parent',
      sourceProjectId: 'source',
      sourceEntryId: 'entry',
    },
  },
]

test('entry request contracts enforce the existing filename rules', () => {
  for (const { schema, body } of entryBodies) {
    expect(schema.safeParse({ ...body, name: 'main.tex' }).success).toBe(true)
    for (const name of [
      '',
      '.',
      '..',
      '../main.tex',
      ' main.tex',
      'x\u0000.tex',
      'a'.repeat(151),
    ]) {
      expect(schema.safeParse({ ...body, name }).success).toBe(false)
    }
  }
})

test('entry contracts enforce UTF-8 basename limits without Unicode normalization', () => {
  for (const { schema, body } of entryBodies) {
    for (const name of [
      `${'界'.repeat(83)}.tex`,
      '界'.repeat(85),
      'é.tex',
      'e\u0301.tex',
      `${'😀'.repeat(62)}.tex`,
    ]) {
      expect(schema.safeParse({ ...body, name }).success).toBe(true)
    }
    for (const name of [
      `${'界'.repeat(84)}.tex`,
      `${'😀'.repeat(63)}.tex`,
      '\uD800.tex',
      '\uDC00.tex',
    ]) {
      expect(schema.safeParse({ ...body, name }).success).toBe(false)
    }
  }
})

test('tree entry creation accepts valid multibyte names and rejects unrepresentable basenames', async ({
  page,
}) => {
  await registerUser(page)
  const projectId = await createProject(page, 'blank')
  const treeResponse = await page.request.get(`/api/projects/${projectId}/tree`)
  expect(treeResponse.ok()).toBe(true)
  const { rootFolderId } = await treeResponse.json()
  const endpoint = `/api/projects/${projectId}/entries`
  for (const name of [`${'界'.repeat(83)}.tex`, 'é.tex', 'e\u0301.tex']) {
    const response = await page.request.post(endpoint, {
      data: { parentId: rootFolderId, kind: 'doc', name },
    })
    expect(response.status()).toBe(201)
  }
  for (const name of [`${'界'.repeat(84)}.tex`, '\uD800.tex', '\uDC00.tex']) {
    const response = await page.request.post(endpoint, {
      data: { parentId: rootFolderId, kind: 'doc', name },
    })
    expect(response.status()).toBe(400)
  }
  const updated = await page.request.get(`/api/projects/${projectId}/tree`)
  const { entries } = await updated.json()
  const names = entries.map((entry: { name: string }) => entry.name)
  expect(names).toEqual(
    expect.arrayContaining([`${'界'.repeat(83)}.tex`, 'é.tex', 'e\u0301.tex'])
  )
})

test('project events reject malformed payloads and retain all variants', () => {
  for (const payload of [
    null,
    [],
    {},
    { type: 'unknown' },
    { type: 'history.committed' },
    { type: 'compile.finished', userId: 7, buildId: null, status: 'success' },
  ]) {
    expect(ProjectEvent.safeParse(payload).success).toBe(false)
  }
  for (const payload of [
    { type: 'tree.changed' },
    { type: 'project.updated' },
    { type: 'comments.changed' },
    { type: 'history.committed', oid: 'commit' },
    {
      type: 'compile.finished',
      userId: 'user',
      buildId: null,
      status: 'success',
    },
  ]) {
    expect(ProjectEvent.parse(payload)).toEqual(payload)
  }
})

for (const response of [
  {
    name: 'empty success',
    status: 204,
    body: '',
    message: 'The server returned an invalid response.',
  },
  {
    name: 'wrong success shape',
    status: 200,
    body: '{}',
    message: 'The server returned an invalid response.',
  },
  {
    name: 'malformed JSON',
    status: 200,
    body: '{',
    message: 'The server returned an unreadable response.',
  },
]) {
  test(`registration reports ${response.name} without exposing parser errors`, async ({
    page,
  }) => {
    await page.route('**/api/auth/register', route =>
      route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: response.body,
      })
    )
    await page.goto('/register')
    const form = page.getByTestId('register-form')
    await form.getByLabel('Name').fill('Contract Test')
    await form.getByLabel('Email').fill('contract@example.com')
    await form.getByLabel('Password').fill('contract-test-password')
    await form.getByRole('button', { name: 'Register' }).click()
    await expect(form).toContainText(response.message)
    await expect(form.getByRole('button', { name: 'Register' })).toBeEnabled()
  })
}

test('malformed HTTP error metadata falls back to the HTTP error', async ({
  page,
}) => {
  await page.route('**/api/auth/register', route =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: {}, message: { unexpected: true } },
      }),
    })
  )
  await page.goto('/register')
  const form = page.getByTestId('register-form')
  await form.getByLabel('Name').fill('Contract Test')
  await form.getByLabel('Email').fill('contract@example.com')
  await form.getByLabel('Password').fill('contract-test-password')
  await form.getByRole('button', { name: 'Register' }).click()
  await expect(form).toContainText(/Bad Request|Request failed \(400\)/)
  await expect(form.getByRole('button', { name: 'Register' })).toBeEnabled()
})

test('malformed upload conflict details display the API error', async ({
  page,
}) => {
  await registerUser(page)
  const projectId = await createProject(page, 'blank')
  await page.route(`**/api/projects/${projectId}/upload`, route =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'conflict',
          message: 'Upload rejected',
          conflicts: [null],
        },
      }),
    })
  )
  await page.getByTestId('file-tree-upload').click()
  const modal = page.getByTestId('upload-modal')
  await modal.getByTestId('upload-input').setInputFiles({
    name: 'contract.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('contract'),
  })
  await expect(modal).toContainText('Upload rejected')
})

test('settings response contracts reject corrupt data without changing storage defaults', () => {
  expect(UserSettingsSchema.parse(DEFAULT_USER_SETTINGS)).toEqual(
    DEFAULT_USER_SETTINGS
  )
  for (const payload of [
    undefined,
    null,
    {},
    { ...DEFAULT_USER_SETTINGS, fontSize: '12' },
  ]) {
    expect(UserSettingsSchema.safeParse(payload).success).toBe(false)
  }
  expect(parseUserSettings({ fontSize: '12' })).toEqual(DEFAULT_USER_SETTINGS)
})

test('registration rejects an identity response with missing settings', async ({
  page,
}) => {
  const user = {
    id: 'user',
    name: 'Contract Test',
    email: 'contract@example.com',
  }
  let signedIn = false
  await page.route('**/api/auth/register', route => {
    signedIn = true
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ user }),
    })
  })
  await page.route('**/api/auth/me', route =>
    route.fulfill({
      status: signedIn ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(
        signedIn
          ? { user, learnedWords: [] }
          : { error: { code: 'unauthorized', message: 'Not signed in' } }
      ),
    })
  )
  await page.goto('/register')
  const form = page.getByTestId('register-form')
  await form.getByLabel('Name').fill(user.name)
  await form.getByLabel('Email').fill(user.email)
  await form.getByLabel('Password').fill('contract-test-password')
  await form.getByRole('button', { name: 'Register' }).click()
  await expect(form).toContainText('The server returned an invalid response.')
})
