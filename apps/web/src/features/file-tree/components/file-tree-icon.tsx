import classnames from 'classnames'
import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import iconTypeFromName from '../util/icon-type-from-name'

function FileTreeIcon({
  isLinkedFile,
  name,
}: {
  name: string
  isLinkedFile?: boolean
}) {
  const { t } = useTranslation()

  const className = classnames('file-tree-icon', {
    'linked-file-icon': isLinkedFile,
  })

  return (
    <>
      <MaterialIcon
        unfilled
        type={iconTypeFromName(name)}
        className={className}
      />
      {isLinkedFile && (
        <MaterialIcon
          type="open_in_new"
          modifier="rotate-180"
          className="linked-file-highlight"
          accessibilityLabel={t('linked_file')}
        />
      )}
    </>
  )
}

export default FileTreeIcon
