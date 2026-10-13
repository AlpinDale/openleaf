import { IncomingMessage, MessageType } from '@hocuspocus/server'
import {
  FORCED_CLOSE_REASONS,
  MAX_REALTIME_UPDATE_BYTES,
  PROJECT_DOCUMENT_NAME_RE,
} from '@openleaf/shared'
import type { Config } from '../config.js'

export type SocketAttachment = { id: string; admission: SocketAdmission }

/** Bounds raw frames before Hocuspocus can retain them behind a blocked lock. */
export class SocketAdmission {
  private readonly pending = new Map<
    Uint8Array,
    { routingKey: string; documentName: string; type: number }
  >()
  private pendingBytes = 0
  private at = Date.now()
  private messages: number
  private bytes: number

  constructor(private readonly config: Config) {
    this.messages = config.maxRealtimeMessagesPerMinute
    this.bytes = config.maxProjectStateBytes * 2
  }

  accept(frame: Uint8Array) {
    if (frame.byteLength > MAX_REALTIME_UPDATE_BYTES)
      throw { reason: FORCED_CLOSE_REASONS.updateTooLarge }
    const message = new IncomingMessage(frame)
    if (message.readVarUint() > 256)
      throw { reason: FORCED_CLOSE_REASONS.invalidUpdate }
    message.decoder.pos = 0
    const routingKey = message.readVarString()
    const separator = routingKey.indexOf('\0')
    const documentName =
      separator === -1 ? routingKey : routingKey.slice(0, separator)
    if (!PROJECT_DOCUMENT_NAME_RE.test(documentName))
      throw { reason: FORCED_CLOSE_REASONS.invalidUpdate }
    const type = message.readVarUint()
    if (type === MessageType.Auth && frame.byteLength > 4096)
      throw { reason: FORCED_CLOSE_REASONS.invalidUpdate }
    const now = Date.now()
    const elapsed = Math.max(0, now - this.at) / 60_000
    this.messages =
      Math.min(
        this.config.maxRealtimeMessagesPerMinute,
        this.messages + elapsed * this.config.maxRealtimeMessagesPerMinute
      ) - 1
    this.bytes =
      Math.min(
        this.config.maxProjectStateBytes * 2,
        this.bytes + elapsed * this.config.maxProjectStateBytes * 2
      ) - frame.byteLength
    this.at = now
    if (
      this.messages < 0 ||
      this.bytes < 0 ||
      this.pending.size >=
        Math.min(512, this.config.maxRealtimeMessagesPerMinute) ||
      this.pendingBytes + frame.byteLength >
        Math.min(this.config.maxProjectStateBytes, MAX_REALTIME_UPDATE_BYTES)
    ) {
      throw { reason: FORCED_CLOSE_REASONS.rateLimited }
    }
    this.pending.set(frame, { routingKey, documentName, type })
    this.pendingBytes += frame.byteLength
  }

  complete(frame: Uint8Array) {
    if (!this.pending.delete(frame)) return
    this.pendingBytes -= frame.byteLength
  }

  completeAuthentication(documentName: string) {
    for (const [frame, info] of this.pending) {
      if (info.type === MessageType.Auth && info.documentName === documentName)
        this.complete(frame)
    }
  }

  disconnect(routingKey: string) {
    // Called only after the connection's queued messages finish or are dropped.
    for (const [frame, info] of this.pending) {
      if (info.routingKey === routingKey) this.complete(frame)
    }
  }

  destroy() {
    this.pending.clear()
    this.pendingBytes = 0
  }
}
