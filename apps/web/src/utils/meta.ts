import type { SpellCheckLanguage } from '@ol-types/project-settings'

export interface Meta {
  'ol-user_id'?: string
  'ol-baseAssetPath'?: string
  'ol-dictionariesRoot'?: string
  'ol-mathJaxPath'?: string
  'ol-learnedWords'?: string[]
  'ol-languages'?: SpellCheckLanguage[]
  'ol-editorThemes'?: { name: string }[]
  'ol-legacyEditorThemes'?: { name: string }[]
  'ol-ExposedSettings': {
    hasLinkedProjectFileFeature: boolean
    hasLinkedProjectOutputFileFeature: boolean
    hasLinkUrlFeature: boolean
    maxUploadSize: number
  }
  'ol-no-single-dollar'?: boolean
  'ol-symbolPaletteAvailable'?: boolean
  [key: string]: unknown
}

declare global {
  interface Window {
    __OPENLEAF_META__?: Meta
  }
}

export function getMeta<K extends keyof Meta>(key: K): Meta[K] {
  return window.__OPENLEAF_META__?.[key]
}

export function setMeta(values: Partial<Meta>) {
  window.__OPENLEAF_META__ = { ...window.__OPENLEAF_META__, ...values } as Meta
}

export default getMeta
