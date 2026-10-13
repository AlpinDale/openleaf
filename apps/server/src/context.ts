import type { CompileService } from './compile/service.js'
import type { Config } from './config.js'
import type { Db } from './db/index.js'
import type { ExportService } from './export/service.js'
import type { HistoryService } from './history/service.js'
import type { Realtime } from './realtime/hocuspocus.js'

/** Process-wide services shared by route modules. */
export type AppContext = {
  config: Config
  db: Db
  realtime: Realtime
  compile: CompileService
  history: HistoryService
  exports: ExportService
}
