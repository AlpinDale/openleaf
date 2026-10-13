import classNames from 'classnames'
import { memo } from 'react'
import { useEditorStore } from '@/features/editor/editor-store'
import { useTranslation } from '@/i18n'
import OLButton from '@/shared/components/ol/ol-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { isMac } from '@/shared/utils/os'
import { useCompileStore } from '../compile-store'

/** Recompile button in the editor toolbar while the PDF is in a separate tab. */
function DetachCompileButtonWrapper() {
  const { t } = useTranslation()
  const detached = useEditorStore(s => s.layout === 'detached')
  const compiling = useCompileStore(s => s.status === 'compiling')
  const compile = useCompileStore(s => s.compile)
  if (!detached) return null

  return (
    <div className="detach-compile-button-container ms-1">
      <OLTooltip
        id="detach-compile"
        description={
          <>
            {t('recompile_pdf')}{' '}
            <span className="keyboard-shortcut">
              ({isMac ? 'Cmd' : 'Ctrl'} + Enter)
            </span>
          </>
        }
        tooltipProps={{ className: 'keyboard-tooltip' }}
        overlayProps={{ delay: { show: 500, hide: 0 } }}
      >
        <OLButton
          variant="primary"
          onClick={() => void compile()}
          disabled={compiling}
          className={classNames('detach-compile-button', {
            'detach-compile-button-disabled': compiling,
          })}
          size="sm"
          isLoading={compiling}
          loadingLabel={t('compiling')}
        >
          {t('recompile')}
        </OLButton>
      </OLTooltip>
    </div>
  )
}

export default memo(DetachCompileButtonWrapper)
