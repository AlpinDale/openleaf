// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { openURL } from '@/features/source-editor/utils/url'

afterEach(() => vi.restoreAllMocks())

it('opens HTTP links without exposing the editor as an opener', () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  openURL('https://example.com/latex')
  expect(open).toHaveBeenCalledWith(
    new URL('https://example.com/latex'),
    '_blank',
    'noopener,noreferrer'
  )
})

it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>'])(
  'does not open document links with unsafe protocols: %s',
  url => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    expect(() => openURL(url)).toThrow('Not opening URL with protocol')
    expect(open).not.toHaveBeenCalled()
  }
)
