// Adapted from Overleaf services/web/frontend/js/features/dictionary/components/{dictionary-modal,dictionary-modal-content}.tsx (AGPL-3.0).
// OpenLeaf adds a field for adding words.
import { type FormEvent, useState } from 'react'
import { addLearnedWord, removeLearnedWord, useMe } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { getEditorView } from '@/features/editor/editor-bridge'
import {
  closeDictionaryModal,
  useSettingsModalStore,
} from '@/features/settings/settings-modal-store'
import {
  addLearnedWord as addLearnedWordSpec,
  learnedWords as editorLearnedWords,
} from '@/features/source-editor/extensions/spelling/learned-words'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

/** Tells the open editor's spell checker, so underlines update immediately. */
function learnInEditor(word: string) {
  const view = getEditorView()
  if (view) view.dispatch(addLearnedWordSpec(word))
  else editorLearnedWords.global.add(word)
}

function unlearnInEditor(word: string) {
  // Handled by the spelling extension's `dictionary` plugin when an editor
  // is mounted; keep the shared set right when none is.
  editorLearnedWords.global.delete(word)
  window.dispatchEvent(
    new CustomEvent('editor:remove-learned-word', { detail: word })
  )
}

function DictionaryModalContent() {
  const { t } = useTranslation()
  const words = useMe().data?.learnedWords ?? []
  const [newWord, setNewWord] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleRemove = async (word: string) => {
    setError(null)
    try {
      await removeLearnedWord(word)
      unlearnInEditor(word)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault()
    const word = newWord.trim()
    if (!word || busy) return
    setError(null)
    setBusy(true)
    try {
      await addLearnedWord(word)
      learnInEditor(word)
      setNewWord('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <OLModalHeader>
        <OLModalTitle>{t('edit_dictionary')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {error && (
          <div className="notification-list">
            <Notification type="error" content={error} />
          </div>
        )}
        <form className="dictionary-add-form" onSubmit={handleAdd}>
          <OLFormControl
            size="sm"
            value={newWord}
            onChange={event => setNewWord(event.target.value)}
            placeholder={t('add_word_to_dictionary')}
            aria-label={t('add_word_to_dictionary')}
            data-testid="dictionary-add-input"
          />
          <OLButton
            type="submit"
            variant="secondary"
            size="sm"
            disabled={!newWord.trim() || /\s/.test(newWord.trim()) || busy}
          >
            {t('add')}
          </OLButton>
        </form>
        {words.length > 0 ? (
          <ul className="list-unstyled dictionary-entries-list">
            {[...words]
              .sort((a, b) => a.localeCompare(b))
              .map(word => (
                <li
                  key={word}
                  className="dictionary-entry"
                  data-testid="dictionary-entry"
                >
                  <span className="dictionary-entry-name" translate="no">
                    {word}
                  </span>
                  <OLTooltip
                    id={`tooltip-remove-learned-word-${word}`}
                    description={t('edit_dictionary_remove')}
                    overlayProps={{ delay: 0 }}
                  >
                    <OLIconButton
                      variant="danger"
                      size="sm"
                      onClick={() => handleRemove(word)}
                      icon="delete"
                      accessibilityLabel={t('edit_dictionary_remove')}
                    />
                  </OLTooltip>
                </li>
              ))}
          </ul>
        ) : (
          <p className="dictionary-empty-body text-center">
            <i>{t('edit_dictionary_empty')}</i>
          </p>
        )}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={closeDictionaryModal}>
          {t('close')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

/** Spelling → Dictionary → Edit: the user's learned words. */
export function DictionaryModal() {
  const show = useSettingsModalStore(s => s.dictionaryShown)
  return (
    <OLModal
      animation
      show={show}
      onHide={closeDictionaryModal}
      id="dictionary-modal"
      data-testid="dictionary-modal"
      size="sm"
      themed
    >
      {show && <DictionaryModalContent />}
    </OLModal>
  )
}
