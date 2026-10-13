import { ToolbarButtonMenu } from './button-menu'
import MaterialIcon from '@/shared/components/material-icon'
import { useTranslation } from '@/i18n'
import { useCodeMirrorViewContext } from '../codemirror-context'
import {
  wrapInDisplayMath,
  wrapInInlineMath,
} from '../../extensions/toolbar/commands'
import { memo } from 'react'
import OLListGroupItem from '@/shared/components/ol/ol-list-group-item'

export const MathDropdown = memo(function MathDropdown() {
  const { t } = useTranslation()
  const view = useCodeMirrorViewContext()

  return (
    <ToolbarButtonMenu
      id="toolbar-math"
      label={t('toolbar_insert_math')}
      icon={<MaterialIcon type="calculate" />}
    >
      <OLListGroupItem
        aria-label={t('toolbar_insert_inline_math')}
        onClick={event => {
          event.preventDefault()
          wrapInInlineMath(view)
          view.focus()
        }}
      >
        <MaterialIcon type="123" />
        <span>{t('inline')}</span>
      </OLListGroupItem>
      <OLListGroupItem
        aria-label={t('toolbar_insert_display_math')}
        onClick={event => {
          event.preventDefault()
          wrapInDisplayMath(view)
          view.focus()
        }}
      >
        <MaterialIcon type="view_day" />
        <span>{t('display')}</span>
      </OLListGroupItem>
    </ToolbarButtonMenu>
  )
})
