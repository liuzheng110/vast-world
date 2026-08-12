import { describe, expect, it } from 'vitest'
import {
  ClientMessageType,
  isValidEnvelope,
  MAX_PAYLOAD_BYTES,
  RATE_LIMITS,
  ServerError,
  ServerMessageType,
} from './messages.js'

describe('protocol messages', () => {
  it('isValidEnvelope accepts well-formed envelopes', () => {
    expect(isValidEnvelope({ type: 'move' })).toBe(true)
    expect(isValidEnvelope({ type: 'move', payload: { x: 1 } })).toBe(true)
  })

  it('isValidEnvelope rejects malformed values', () => {
    expect(isValidEnvelope(null)).toBe(false)
    expect(isValidEnvelope('hello')).toBe(false)
    expect(isValidEnvelope({})).toBe(false)
    expect(isValidEnvelope({ type: 123 })).toBe(false)
    expect(isValidEnvelope({ type: '' })).toBe(false)
    expect(isValidEnvelope({ payload: {} })).toBe(false)
  })

  it('exposes stable message type constants', () => {
    expect(ClientMessageType.HANDSHAKE).toBe('handshake')
    expect(ClientMessageType.MOVE).toBe('move')
    expect(ClientMessageType.CHAT).toBe('chat')
    expect(ClientMessageType.LEAVE).toBe('leave')
    expect(ServerMessageType.HANDSHAKE_ACK).toBe('handshake_ack')
    expect(ServerMessageType.HANDSHAKE_ERROR).toBe('handshake_error')
    expect(ServerMessageType.ERROR).toBe('error')
    expect(ServerMessageType.KICK).toBe('kick')
  })

  it('exposes stable error codes', () => {
    expect(ServerError.UNKNOWN_MESSAGE_TYPE).toBe('UNKNOWN_MESSAGE_TYPE')
    expect(ServerError.PAYLOAD_TOO_LARGE).toBe('PAYLOAD_TOO_LARGE')
    expect(ServerError.PAYLOAD_INVALID).toBe('PAYLOAD_INVALID')
    expect(ServerError.RATE_LIMITED).toBe('RATE_LIMITED')
    expect(ServerError.ROOM_FULL).toBe('ROOM_FULL')
  })

  it('has sane payload and rate limit constants', () => {
    expect(MAX_PAYLOAD_BYTES).toBeGreaterThan(1024)
    expect(MAX_PAYLOAD_BYTES).toBeLessThanOrEqual(1024 * 1024)
    expect(RATE_LIMITS.maxMessagesPerSecond).toBeGreaterThan(0)
    expect(RATE_LIMITS.maxMovesPerSecond).toBeGreaterThan(0)
    expect(RATE_LIMITS.maxChatsPerSecond).toBeGreaterThan(0)
  })
})
