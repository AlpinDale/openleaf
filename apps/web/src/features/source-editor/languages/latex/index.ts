import { latexIndentService } from './latex-indent-service'
import { shortcuts } from './shortcuts'
import { closeEnvironment } from './close-environment'
import { linting } from './linting'
import { LanguageSupport } from '@codemirror/language'
import { CompletionSource } from '@codemirror/autocomplete'
import { supportExtend } from '../../utils/autocomplete-helpers'
import { openAutocomplete } from './open-autocomplete'
import { metadata } from './metadata'
import {
  argumentCompletionSources,
  explicitCommandCompletionSource,
  inCommandCompletionSource,
  beginEnvironmentCompletionSource,
} from './complete'
import { documentCommands } from './document-commands'
import { documentOutline } from './document-outline'
import { LaTeXLanguage } from './latex-language'
import { documentEnvironments } from './document-environments'
import {
  figureModal,
  figureModalPasteHandler,
} from '../../extensions/figure-modal'

const completionSources: CompletionSource[] = [
  ...argumentCompletionSources,
  inCommandCompletionSource,
  explicitCommandCompletionSource,
  beginEnvironmentCompletionSource,
].map(supportExtend)

export const latex = () => {
  return new LanguageSupport(LaTeXLanguage, [
    shortcuts(),
    closeEnvironment(),
    documentOutline,
    documentCommands,
    documentEnvironments,
    latexIndentService(),
    linting(),
    metadata(),
    openAutocomplete(),
    ...completionSources.map(completionSource =>
      LaTeXLanguage.data.of({
        autocomplete: completionSource,
      })
    ),
    figureModal(),
    figureModalPasteHandler(),
  ])
}
