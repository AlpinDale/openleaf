import { memo } from 'react'
import { dismissToast, useToastStore } from '@/features/toasts'
import { OLToast } from '@/shared/components/ol/ol-toast'
import { OLToastContainer } from '@/shared/components/ol/ol-toast-container'

const DEFAULT_DELAY = { error: 10_000, other: 6000 }

export const GlobalToasts = memo(function GlobalToasts() {
  const toasts = useToastStore(state => state.toasts)
  return (
    <OLToastContainer className="global-toasts">
      {toasts.map(({ id, type, content, title, delay }) => {
        const hideAfter =
          delay === undefined
            ? type === 'error'
              ? DEFAULT_DELAY.error
              : DEFAULT_DELAY.other
            : delay
        return (
          <OLToast
            key={id}
            type={type}
            title={title}
            content={content}
            isDismissible
            autoHide={hideAfter !== null}
            delay={hideAfter ?? undefined}
            onDismiss={() => dismissToast(id)}
          />
        )
      })}
    </OLToastContainer>
  )
})
