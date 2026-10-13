import { type BibEntry, extractBibEntries } from './bib-entries'
import { type DocMeta, extractMetaFromDoc } from './meta-handler'

export type MetadataRequest = {
  docs: { id: string; path: string; text: string }[]
  bibs: { path: string; text: string }[]
}

export type MetadataResponse = {
  docs: Record<string, DocMeta>
  bibEntries: BibEntry[]
}

self.addEventListener(
  'message',
  async (event: MessageEvent<MetadataRequest>) => {
    const { default: packageMapping } = await import('./package-mapping')
    const docs: Record<string, DocMeta> = {}
    for (const doc of event.data.docs) {
      docs[doc.id] = extractMetaFromDoc(doc.text.split('\n'), packageMapping)
    }
    const bibEntries = event.data.bibs.flatMap(bib =>
      extractBibEntries(bib.text)
    )
    self.postMessage({ docs, bibEntries } satisfies MetadataResponse)
  }
)
