import { removeLearnedWord, useCurrentMe } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { showToast } from '@/features/toasts'
import { useTranslation } from '@/i18n'
import OLIconButton from '@/shared/components/ol/ol-icon-button'

export function LearnedWordsSection() {
  const { t } = useTranslation()
  const { learnedWords } = useCurrentMe()

  const onRemove = async (word: string) => {
    try {
      await removeLearnedWord(word)
    } catch (err) {
      showToast({ type: 'error', content: errorMessage(err) })
    }
  }

  return (
    <section data-testid="learned-words-section">
      <h2 className="h4">{t('dictionary')}</h2>
      {learnedWords.length === 0 ? (
        <p className="text-muted">{t('no_learned_words')}</p>
      ) : (
        <ul className="list-group openleaf-learned-words">
          {[...learnedWords].sort().map(word => (
            <li
              key={word}
              className="list-group-item d-flex align-items-center justify-content-between"
              data-testid="learned-word"
            >
              <span>{word}</span>
              <OLIconButton
                variant="ghost"
                size="sm"
                icon="close"
                accessibilityLabel={t('remove_word', { word })}
                onClick={() => onRemove(word)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
