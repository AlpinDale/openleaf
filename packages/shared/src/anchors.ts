import * as Y from 'yjs'

export function encodeAnchor(
  ytext: Y.Text,
  index: number,
  assoc: number
): Uint8Array {
  return Y.encodeRelativePosition(
    Y.createRelativePositionFromTypeIndex(ytext, index, assoc)
  )
}

export function resolveAnchor(ydoc: Y.Doc, bytes: Uint8Array): number | null {
  return (
    Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(bytes),
      ydoc
    )?.index ?? null
  )
}
