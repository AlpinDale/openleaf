import type { Doc } from './doc'
import type { FileRef } from './file-ref'

export type Folder = {
  _id: string
  name: string
  docs: Doc[]
  folders: Folder[]
  fileRefs: FileRef[]
}
