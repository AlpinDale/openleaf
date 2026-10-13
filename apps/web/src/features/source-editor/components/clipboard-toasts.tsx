import { showToast } from '@/features/toasts'
import { useTranslation } from '@/i18n'
import { isMac } from '@/shared/utils/os'

const ClipboardPasteErrorToast = ({ shortcut }: { shortcut?: string }) => {
  const { t } = useTranslation()
  const resolvedShortcut = shortcut ?? (isMac ? '⌘V' : 'Ctrl+V')

  return (
    <>
      <p>
        <b>{t('use_the_shortcut_key_to_paste')}</b>
      </p>
      {t('your_browser_cant_access_the_clipboard_so_use_this_shortcut')}{' '}
      <b>{resolvedShortcut}</b>
      <br />
      {t('or_enable_clipboard_access_in_your_browser_settings')}
    </>
  )
}

export const showClipboardPasteErrorToast = (shortcut?: string) => {
  showToast({
    type: 'warning',
    content: <ClipboardPasteErrorToast shortcut={shortcut} />,
    delay: 6000,
  })
}
