import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { pipeline } from 'node:stream/promises'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { badRequest, HttpError, tooLarge } from '../errors.js'

const blockList = new net.BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockList.addSubnet(address, prefix, 'ipv4')
}
blockList.addSubnet('::', 96, 'ipv6')
blockList.addSubnet('fc00::', 7, 'ipv6')
blockList.addSubnet('fe80::', 10, 'ipv6')
blockList.addSubnet('fec0::', 10, 'ipv6')
blockList.addSubnet('ff00::', 8, 'ipv6')

async function resolvePublicUrl(url: URL, signal: AbortSignal) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('Only http and https URLs can be imported')
  }
  if (url.username || url.password) {
    throw badRequest('URLs containing credentials cannot be imported')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: dns.LookupAddress[]
  const family = net.isIP(host)
  if (family) {
    addresses = [{ address: host, family }]
  } else {
    // DNS itself must obey the overall deadline, not only the HTTP request.
    const lookup = Promise.withResolvers<dns.LookupAddress[]>()
    const abort = () => lookup.reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    dns.promises.lookup(host, { all: true }).then(lookup.resolve, lookup.reject)
    try {
      addresses = await lookup.promise
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }
  signal.throwIfAborted()
  // BlockList also checks mapped IPv4 (including canonical hexadecimal IPv6)
  // against its IPv4 ranges; do not rely on a dotted-address regexp.
  if (
    !addresses.length ||
    addresses.some(a =>
      blockList.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4')
    )
  ) {
    throw badRequest('URL resolves to a private address')
  }
  return addresses[0]
}

const MAX_REDIRECTS = 5
const TIMEOUT_MS = 30_000

/** Pins each connection to a validated DNS result, including redirect hops. */
export async function fetchPublicUrl(
  rawUrl: string,
  maxBytes: number
): Promise<Buffer> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw badRequest('Invalid URL')
  }
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('URL fetch timed out')),
    TIMEOUT_MS
  )
  timer.unref()
  const { signal } = controller
  try {
    for (let hop = 0; ; hop++) {
      const address = await resolvePublicUrl(url, signal)
      const request = (url.protocol === 'https:' ? https : http).request(url, {
        method: 'GET',
        signal,
        agent: false,
        family: address.family,
        // Keep the URL host for Host/SNI/certificate verification, but never
        // resolve it again after the SSRF check (DNS rebinding).
        lookup: (_host, _options, callback) =>
          callback(null, address.address, address.family),
        headers: { 'accept-encoding': 'gzip, deflate, br' },
      })
      try {
        const received = Promise.withResolvers<http.IncomingMessage>()
        request.once('response', received.resolve)
        request.once('error', received.reject)
        request.end()
        const response = await received.promise
        const status = response.statusCode ?? 0
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.location
          response.destroy()
          if (!location) throw badRequest('Redirect without a location')
          if (hop >= MAX_REDIRECTS) throw badRequest('Too many redirects')
          url = new URL(location, url)
          continue
        }
        if (status < 200 || status >= 300) {
          response.destroy()
          throw badRequest(`URL returned HTTP ${status}`)
        }
        if (Number(response.headers['content-length']) > maxBytes) {
          response.destroy()
          throw tooLarge('The file at this URL is too large')
        }
        const encoding = response.headers['content-encoding']?.toLowerCase()
        const decoder =
          encoding === 'gzip'
            ? createGunzip()
            : encoding === 'deflate'
              ? createInflate()
              : encoding === 'br'
                ? createBrotliDecompress()
                : null
        if (encoding && encoding !== 'identity' && !decoder) {
          response.destroy()
          throw badRequest('Unsupported URL content encoding')
        }
        const body = decoder ?? response
        const decoding = decoder
          ? pipeline(response, decoder, { signal })
          : null
        // Attach a rejection handler before consuming the decoded stream.
        decoding?.catch(() => {})
        try {
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of body) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            size += bytes.byteLength
            if (size > maxBytes)
              throw tooLarge('The file at this URL is too large')
            chunks.push(bytes)
          }
          if (decoding) await decoding
          return Buffer.concat(chunks, size)
        } finally {
          body.destroy()
          response.destroy()
          await decoding?.catch(() => {})
        }
      } finally {
        request.destroy()
      }
    }
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw badRequest(`Could not fetch URL: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}
