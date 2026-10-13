import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = await buildApp(config)

let closing = false
async function shutdown(signal: string, exitCode = 0) {
  if (closing) return
  closing = true
  app.log.info({ signal }, 'shutting down')
  try {
    await app.close()
  } catch (err) {
    app.log.error({ err }, 'error during shutdown')
    exitCode = 1
  }
  process.exit(exitCode)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ host: config.host, port: config.port })
} catch (err) {
  app.log.error({ err }, 'failed to listen')
  await shutdown('startup', 1)
}
