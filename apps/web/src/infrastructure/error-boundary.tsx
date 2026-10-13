import type { ComponentType, ErrorInfo } from 'react'
import {
  type FallbackProps,
  withErrorBoundary as rebWithErrorBoundary,
} from 'react-error-boundary'
import { captureException } from './error-reporter'

function errorHandler(error: unknown, errorInfo: ErrorInfo) {
  captureException(error, {
    extra: {
      componentStack: errorInfo.componentStack,
    },
    tags: {
      handler: 'react-error-boundary',
    },
  })
}

function DefaultFallbackComponent() {
  return null
}

function withErrorBoundary(
  WrappedComponent: ComponentType<any>,
  FallbackComponent?: ComponentType<FallbackProps>
) {
  return rebWithErrorBoundary(WrappedComponent, {
    onError: errorHandler,
    FallbackComponent: FallbackComponent || DefaultFallbackComponent,
  })
}

export default withErrorBoundary
