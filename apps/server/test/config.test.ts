import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { loadConfig } from '../src/config.js'

describe('deployment URLs', () => {
  it.each([
    'not a URL',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://admin:secret@example.com',
    'https://example.com/openleaf',
    'https://example.com/?secret=token',
    'https://example.com/#fragment',
  ])('rejects unsupported public URL %s at startup', url => {
    expect(() => loadConfig({ OPENLEAF_PUBLIC_URL: url })).toThrow(ZodError)
  })

  it('normalizes the public origin used for CSRF and secure cookies', () => {
    const config = loadConfig({
      OPENLEAF_PUBLIC_URL: 'https://LEAF.example:443/',
    })
    expect(config.publicUrl).toBe('https://leaf.example')
    expect(config.secureCookies).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:password@example.com',
  ])('rejects unsafe support links %s', url => {
    expect(() => loadConfig({ OPENLEAF_SUPPORT_URL: url })).toThrow(ZodError)
  })

  it('requires an explicit browser-facing origin in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ZodError)
  })

  it('rejects the unsandboxed host runner in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        OPENLEAF_PUBLIC_URL: 'https://leaf.example',
        OPENLEAF_COMPILE_RUNNER: 'host',
      })
    ).toThrow(ZodError)
  })
})

describe('compile resource configuration', () => {
  it.each(['0', '0g', '5m', '-1g', 'unlimited', 'Infinity'])(
    'rejects invalid or unlimited memory %s',
    value => {
      expect(() => loadConfig({ OPENLEAF_COMPILE_MEMORY: value })).toThrow(
        ZodError
      )
    }
  )

  it.each(['0', '-1', '0.001', 'NaN', 'Infinity', 'unlimited'])(
    'rejects invalid or unbounded CPU allocation %s',
    value => {
      expect(() => loadConfig({ OPENLEAF_COMPILE_CPUS: value })).toThrow(
        ZodError
      )
    }
  )
})
