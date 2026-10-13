import { describe, expect, it } from 'vitest'
import { as, createTestApp, registerUser } from './helpers.js'

const { app } = await createTestApp({ OPENLEAF_MAX_JSON_BODY_MB: '0.001' })
const user = await registerUser(app)
const req = as(app, user)

describe('browser request boundaries', () => {
  it.each(['https://evil.example', 'http://untrusted.127.0.0.1:3000', 'null'])(
    'rejects a mutating request with Origin %s before changing settings',
    async origin => {
      const response = await req({
        method: 'PATCH',
        url: '/api/users/me',
        headers: { origin },
        payload: { name: 'Changed cross-origin' },
      })
      expect(response.statusCode).toBe(403)
      expect(
        (await req({ method: 'GET', url: '/api/auth/me' })).json().user.name
      ).toBe('Test User')
    }
  )

  it('accepts the configured browser origin and clients without Origin', async () => {
    const response = await req({
      method: 'PATCH',
      url: '/api/users/me',
      headers: { origin: 'http://127.0.0.1:3000' },
      payload: { name: 'Same origin' },
    })
    expect(response.statusCode).toBe(200)
    expect(
      (await req({ method: 'GET', url: '/api/auth/me' })).json().user.name
    ).toBe('Same origin')
  })

  it('rejects cross-site fetch metadata even when Origin is absent', async () => {
    const response = await req({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      },
      payload: {},
    })
    expect(response.statusCode).toBe(403)
    expect((await req({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(
      200
    )
  })

  it('rejects cross-origin multipart requests before parsing the upload', async () => {
    const response = await req({
      method: 'POST',
      url: '/api/projects/import',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'multipart/form-data',
      },
      payload: 'not parsed',
    })
    expect(response.statusCode).toBe(403)
  })

  it('bounds JSON request bodies with the configured limit', async () => {
    const response = await req({
      method: 'PATCH',
      url: '/api/users/me',
      payload: { name: 'x'.repeat(2000) },
    })
    expect(response.statusCode).toBe(413)
    expect(response.json().error.code).toBe('too_large')
  })
})
