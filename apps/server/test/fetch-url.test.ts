import dns from 'node:dns'
import http from 'node:http'
import { gzipSync } from 'node:zlib'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { fetchPublicUrl } from '../src/tree/fetch-url.js'

describe('public URL fetching', () => {
  const server = http.createServer((request, response) => {
    switch (request.url) {
      case '/private-redirect':
        response.writeHead(302, { location: 'http://127.0.0.1/secret' })
        response.end()
        break
      case '/invalid-redirect':
        response.writeHead(302, { location: 'http://[' })
        response.end()
        break
      case '/loop':
        response.writeHead(302, { location: '/loop' })
        response.end()
        break
      case '/compressed':
        response.writeHead(200, { 'content-encoding': 'gzip' })
        response.end(gzipSync('x'.repeat(1024)))
        break
      case '/large':
        response.writeHead(200)
        response.write('12345')
        response.end('67890')
        break
      case '/declared-large':
        response.writeHead(200, { 'content-length': '1000' })
        response.end('small')
        break
      case '/not-modified':
        response.writeHead(304)
        response.end()
        break
      default:
        response.end('public bytes')
    }
  })
  let localUrl: string
  beforeAll(async () => {
    const listening = Promise.withResolvers<void>()
    server.listen(0, '127.0.0.1', listening.resolve)
    await listening.promise
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('No test address')
    localUrl = `http://127.0.0.1:${address.port}`
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
  afterAll(async () => {
    server.closeAllConnections()
    const closed = Promise.withResolvers<void>()
    server.close(error => (error ? closed.reject(error) : closed.resolve()))
    await closed.promise
  })

  function dnsAnswers(...answers: dns.LookupAddress[][]) {
    let call = 0
    // The production call always sets all:true; Node's last overload omits
    // that option, so preserve its overloaded type for the spy.
    return vi
      .spyOn(dns.promises, 'lookup')
      .mockImplementation((() =>
        Promise.resolve(
          answers[Math.min(call++, answers.length - 1)]
        )) as unknown as typeof dns.promises.lookup)
  }

  // Only the transport destination is redirected to the fixture. Production
  // URL validation and the supplied pinned DNS lookup still run unchanged.
  function routeToFixture() {
    const pins: string[] = []
    const original = http.request
    const transport = vi
      .spyOn(http, 'request')
      .mockImplementation((url, options, callback) => {
        const input = new URL(url)
        options.lookup?.(
          'download.example',
          { family: 4, hints: 0, all: false },
          (error, address) => {
            if (error) throw error
            if (typeof address !== 'string')
              throw new Error('Expected one pinned address')
            pins.push(address)
          }
        )
        return original(
          new URL(input.pathname, localUrl),
          {
            ...options,
            lookup: undefined,
            family: 4,
          },
          callback
        )
      })
    return { transport, pins }
  }

  it.each([
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[ff02::1]/',
    'http://[fec0::1]/',
    'http://240.0.0.1/',
    'http://198.18.0.1/',
  ])('rejects nonpublic literal addresses: %s', async url => {
    await expect(fetchPublicUrl(url, 100)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('pins the validated lookup instead of resolving the hostname again', async () => {
    const lookup = dnsAnswers(
      [{ address: '203.0.113.10', family: 4 }],
      [{ address: '127.0.0.1', family: 4 }]
    )
    const { pins } = routeToFixture()
    expect(
      (await fetchPublicUrl('http://download.example/file', 100)).toString()
    ).toBe('public bytes')
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(pins).toEqual(['203.0.113.10'])
  })

  it('rejects a DNS answer containing any private address', async () => {
    dnsAnswers([
      { address: '203.0.113.10', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ])
    await expect(
      fetchPublicUrl('http://download.example/file', 100)
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it.each(['private-redirect', 'invalid-redirect', 'loop', 'not-modified'])(
    'rejects unsafe or invalid responses: %s',
    async path => {
      dnsAnswers([{ address: '203.0.113.10', family: 4 }])
      const { transport } = routeToFixture()
      await expect(
        fetchPublicUrl(`http://download.example/${path}`, 100)
      ).rejects.toMatchObject({ statusCode: 400 })
      if (path === 'loop') expect(transport).toHaveBeenCalledTimes(6)
      if (path === 'private-redirect')
        expect(transport).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['large', 'declared-large', 'compressed'])(
    'caps declared, streamed and decompressed bytes: %s',
    async path => {
      dnsAnswers([{ address: '203.0.113.10', family: 4 }])
      routeToFixture()
      await expect(
        fetchPublicUrl(`http://download.example/${path}`, 8)
      ).rejects.toMatchObject({ statusCode: 413 })
    }
  )

  it('applies the overall deadline to a stalled DNS lookup', async () => {
    vi.useFakeTimers()
    vi.spyOn(dns.promises, 'lookup').mockImplementation(
      () => Promise.withResolvers<dns.LookupAddress>().promise
    )
    const rejected = expect(
      fetchPublicUrl('http://download.example/file', 100)
    ).rejects.toMatchObject({ statusCode: 400 })
    await vi.advanceTimersByTimeAsync(30_000)
    await rejected
  })

  it.each(['file:///etc/passwd', 'http://user:secret@download.example/file'])(
    'rejects protocols and credentials before transport: %s',
    async url => {
      const transport = vi.spyOn(http, 'request')
      await expect(fetchPublicUrl(url, 100)).rejects.toMatchObject({
        statusCode: 400,
      })
      expect(transport).not.toHaveBeenCalled()
    }
  )
})
