import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform(v => v === 'true' || v === '1')

const dockerMemory = z
  .string()
  .trim()
  .refine(value => {
    const match = /^(\d+(?:\.\d+)?)([kmgtp]?)b?$/i.exec(value)
    if (!match) return false
    const exponent = match[2] ? 'kmgtp'.indexOf(match[2].toLowerCase()) + 1 : 0
    const bytes = Math.floor(Number(match[1]) * 1024 ** exponent)
    return Number.isSafeInteger(bytes) && bytes >= 6 * 1024 * 1024
  }, 'Must be a Docker memory limit of at least 6 MiB')

const dockerCpus = z
  .string()
  .trim()
  .refine(value => {
    const cpus = Number(value)
    return (
      /^\d+(?:\.\d+)?$/.test(value) &&
      cpus >= 0.01 &&
      Number.isSafeInteger(Math.round(cpus * 1_000_000_000))
    )
  }, 'Must be a Docker CPU limit of at least 0.01')

const httpUrl = z.url().pipe(
  z.string().refine(value => {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password
    )
  }, 'Must be an HTTP(S) URL without credentials')
)

const publicUrl = httpUrl.pipe(
  z
    .string()
    .refine(value => {
      const url = new URL(value)
      return url.pathname === '/' && !url.search && !url.hash
    }, 'Must be an origin without a path, query, or fragment')
    .transform(value => new URL(value).origin)
)

const EnvSchema = z.object({
  OPENLEAF_HOST: z.string().trim().min(1).default('127.0.0.1'),
  OPENLEAF_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  OPENLEAF_PUBLIC_URL: publicUrl.default('http://localhost:5173'),
  OPENLEAF_DATA_DIR: z.string().default('./data'),
  OPENLEAF_ALLOW_SIGNUP: bool.default(true),
  OPENLEAF_COMPILE_RUNNER: z.enum(['host', 'docker']).default('host'),
  OPENLEAF_TEXLIVE_IMAGES: z.string().default('texlive/texlive:latest'),
  OPENLEAF_COMPILE_TIMEOUT_SECONDS: z.coerce
    .number()
    .positive()
    .max(86400)
    .default(240),
  OPENLEAF_COMPILE_MEMORY: dockerMemory.default('4g'),
  OPENLEAF_COMPILE_CPUS: dockerCpus.default('2'),
  OPENLEAF_COMPILE_SCRATCH_MB: z.coerce
    .number()
    .int()
    .min(64)
    .max(16384)
    .default(1024),
  OPENLEAF_MAX_CONCURRENT_COMPILES: z.coerce
    .number()
    .int()
    .positive()
    .default(Math.max(1, Math.floor(os.availableParallelism() / 2))),
  OPENLEAF_MAX_UPLOAD_MB: z.coerce
    .number()
    .min(1 / (1024 * 1024))
    .default(50),
  OPENLEAF_MAX_PROJECT_STATE_MB: z.coerce
    .number()
    .min(1 / (1024 * 1024))
    .max(2048)
    .default(128),
  OPENLEAF_MAX_REALTIME_MESSAGES_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(6000),
  OPENLEAF_MAX_REALTIME_CONNECTIONS_PER_USER: z.coerce
    .number()
    .int()
    .positive()
    .default(32),
  OPENLEAF_MAX_CONCURRENT_GIT_OPERATIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(32)
    .default(4),
  OPENLEAF_GIT_MEMORY_MB: z.coerce
    .number()
    .int()
    .min(128)
    .max(4096)
    .default(512),
  OPENLEAF_WEB_DIST: z
    .string()
    .default(fileURLToPath(new URL('../../web/dist', import.meta.url))),
  OPENLEAF_TRUST_PROXY: bool.default(false),
  OPENLEAF_SUPPORT_URL: httpUrl.optional(),
  OPENLEAF_PANDOC: z.string().min(1).default('pandoc'),
  OPENLEAF_MAX_JSON_BODY_MB: z.coerce
    .number()
    .min(1 / (1024 * 1024))
    .default(10),
  OPENLEAF_REQUEST_TIMEOUT_SECONDS: z.coerce
    .number()
    .positive()
    .max(86400)
    .default(120),
})

const ProductionEnvSchema = EnvSchema.extend({
  OPENLEAF_PUBLIC_URL: publicUrl,
  OPENLEAF_ALLOW_SIGNUP: bool.default(false),
  OPENLEAF_COMPILE_RUNNER: z.literal('docker').default('docker'),
})

export type Config = Readonly<{
  host: string
  port: number
  publicUrl: string
  dataDir: string
  allowSignup: boolean
  compileRunner: 'host' | 'docker'
  texliveImages: readonly string[]
  compileTimeoutMs: number
  compileMemory: string
  compileCpus: string
  compileScratchMb: number
  maxConcurrentCompiles: number
  maxUploadBytes: number
  maxProjectStateBytes: number
  maxRealtimeMessagesPerMinute: number
  maxRealtimeConnectionsPerUser: number
  maxConcurrentGitOperations: number
  gitMemoryBytes: number
  maxJsonBodyBytes: number
  requestTimeoutMs: number
  webDist: string
  trustProxy: boolean
  secureCookies: boolean
  /** "Contact us" link shown in the Help menu; `null` hides it. */
  supportUrl: string | null
  /** pandoc executable used for Word/Markdown/HTML exports. */
  pandocPath: string
}>

export function loadConfig(
  env: Record<string, string | undefined> = process.env
): Config {
  const schema = env.NODE_ENV === 'production' ? ProductionEnvSchema : EnvSchema
  const e = schema.parse(
    Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''))
  )
  const images = e.OPENLEAF_TEXLIVE_IMAGES.split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (images.length === 0) throw new Error('OPENLEAF_TEXLIVE_IMAGES is empty')
  const publicUrl = e.OPENLEAF_PUBLIC_URL
  return Object.freeze({
    host: e.OPENLEAF_HOST,
    port: e.OPENLEAF_PORT,
    publicUrl,
    dataDir: path.resolve(e.OPENLEAF_DATA_DIR),
    allowSignup: e.OPENLEAF_ALLOW_SIGNUP,
    compileRunner: e.OPENLEAF_COMPILE_RUNNER,
    texliveImages: Object.freeze(images),
    compileTimeoutMs: Math.ceil(e.OPENLEAF_COMPILE_TIMEOUT_SECONDS * 1000),
    compileMemory: e.OPENLEAF_COMPILE_MEMORY,
    compileCpus: e.OPENLEAF_COMPILE_CPUS,
    compileScratchMb: e.OPENLEAF_COMPILE_SCRATCH_MB,
    maxConcurrentCompiles: e.OPENLEAF_MAX_CONCURRENT_COMPILES,
    maxUploadBytes: Math.floor(e.OPENLEAF_MAX_UPLOAD_MB * 1024 * 1024),
    maxProjectStateBytes: Math.floor(
      e.OPENLEAF_MAX_PROJECT_STATE_MB * 1024 * 1024
    ),
    maxRealtimeMessagesPerMinute: e.OPENLEAF_MAX_REALTIME_MESSAGES_PER_MINUTE,
    maxRealtimeConnectionsPerUser: e.OPENLEAF_MAX_REALTIME_CONNECTIONS_PER_USER,
    maxConcurrentGitOperations: e.OPENLEAF_MAX_CONCURRENT_GIT_OPERATIONS,
    gitMemoryBytes: e.OPENLEAF_GIT_MEMORY_MB * 1024 * 1024,
    maxJsonBodyBytes: Math.floor(e.OPENLEAF_MAX_JSON_BODY_MB * 1024 * 1024),
    requestTimeoutMs: Math.ceil(e.OPENLEAF_REQUEST_TIMEOUT_SECONDS * 1000),
    webDist: path.resolve(e.OPENLEAF_WEB_DIST),
    trustProxy: e.OPENLEAF_TRUST_PROXY,
    secureCookies: publicUrl.startsWith('https://'),
    supportUrl: e.OPENLEAF_SUPPORT_URL ?? null,
    pandocPath: e.OPENLEAF_PANDOC,
  })
}
