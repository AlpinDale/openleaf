import { memo } from 'react'
import withErrorBoundary from '../../../infrastructure/error-boundary'
import { ErrorBoundaryFallback } from '../../../shared/components/error-boundary-fallback'
import OpenLeafEditor from './openleaf-editor'

function SourceEditor() {
  return <OpenLeafEditor />
}

export default withErrorBoundary(memo(SourceEditor), () => (
  <ErrorBoundaryFallback />
))
