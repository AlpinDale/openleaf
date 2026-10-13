import { type ProjectDetails, SPELL_LANGUAGES } from '@openleaf/shared'
import type { Me } from '@/api/auth'
import { setMeta } from '@/utils/meta'

const editorThemes = Object.keys(
  import.meta.glob('/src/features/source-editor/themes/cm6/*.json')
).map(path => ({ name: path.replace(/^.*\/(.*)\.json$/, '$1') }))

/**
 * Sets the page metadata the ported Overleaf editor reads via `getMeta`.
 * Runs during render, before the (lazy) editor modules evaluate.
 */
export function setEditorMeta(project: ProjectDetails, me: Me) {
  setMeta({
    'ol-user_id': me.user.id,
    'ol-baseAssetPath': `${location.origin}/`,
    'ol-dictionariesRoot': '/dictionaries/',
    'ol-mathJaxPath': '/vendor/mathjax/tex-svg.js',
    'ol-learnedWords': me.learnedWords,
    'ol-languages': SPELL_LANGUAGES.map(language => ({
      code: language.code,
      name: language.name,
      dic: language.code,
    })),
    'ol-editorThemes': editorThemes,
    'ol-legacyEditorThemes': [],
    'ol-ExposedSettings': {
      hasLinkedProjectFileFeature: true,
      hasLinkedProjectOutputFileFeature: false,
      hasLinkUrlFeature: true,
      maxUploadSize: project.limits.maxUploadBytes,
    },
    'ol-no-single-dollar': false,
    'ol-symbolPaletteAvailable': true,
  })
}
