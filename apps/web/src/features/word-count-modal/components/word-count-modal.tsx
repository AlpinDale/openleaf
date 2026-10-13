import { WordCount } from '@openleaf/shared'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'
import { useTranslation } from '@/i18n'
import LoadingSpinner from '@/shared/components/loading-spinner'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'

function WordCounts({
  projectId,
  docId,
}: {
  projectId: string
  docId: string | null
}) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['wordcount', projectId, docId],
    queryFn: ({ signal }) =>
      apiFetch(
        `/projects/${projectId}/wordcount${docId ? `?docId=${encodeURIComponent(docId)}` : ''}`,
        { schema: WordCount, signal }
      ),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  if (query.isPending) return <LoadingSpinner />
  if (query.error) {
    return (
      <div className="notification-list">
        <Notification
          type="error"
          content={query.error.message || t('generic_something_went_wrong')}
        />
      </div>
    )
  }
  const data = query.data
  const rows: [string, number][] = [
    [t('total_words'), data.textWords],
    [t('headers'), data.headers],
    [t('words_in_headers'), data.headWords],
    [t('words_outside_text'), data.outside],
    [t('floats_tables_figures'), data.elements],
    [t('math_inline'), data.mathInline],
    [t('math_display'), data.mathDisplay],
    [t('errors'), data.errors],
  ]
  return (
    <>
      <table className="table table-sm mb-3" data-testid="word-count-table">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" className="fw-normal text-end w-50">
                {label}:
              </th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.messages && (
        <details>
          <summary>{t('word_count_messages')}</summary>
          <pre className="small mb-0" style={{ whiteSpace: 'pre-wrap' }}>
            {data.messages}
          </pre>
        </details>
      )}
    </>
  )
}

/** texcount results for the main document (File → Word count). */
export function WordCountModal({
  show,
  onHide,
  projectId,
  docId,
}: {
  show: boolean
  onHide: () => void
  projectId: string
  docId: string | null
}) {
  const { t } = useTranslation()
  return (
    <OLModal
      show={show}
      onHide={onHide}
      id="word-count-modal"
      data-testid="word-count-modal"
    >
      <OLModalHeader>
        <OLModalTitle>{t('word_count')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {show && <WordCounts projectId={projectId} docId={docId} />}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onHide}>
          {t('close')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
