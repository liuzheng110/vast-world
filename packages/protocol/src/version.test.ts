import { describe, expect, it } from 'vitest'
import {
  HandshakeError,
  PROTOCOL_VERSION,
  validateHandshake,
  type ServerVersionInfo,
} from './version.js'

const server: ServerVersionInfo = {
  protocolVersion: PROTOCOL_VERSION,
  appVersion: '0.0.0',
  commitSha: 'abc1234',
}

describe('validateHandshake', () => {
  it('accepts a matching protocol version', () => {
    const result = validateHandshake(
      { protocolVersion: PROTOCOL_VERSION, clientVersion: '0.0.0' },
      server,
    )
    expect(result.ok).toBe(true)
  })

  it('rejects mismatched protocol version', () => {
    const result = validateHandshake({ protocolVersion: 999 }, server)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe(HandshakeError.PROTOCOL_MISMATCH)
      expect(result.expectedProtocolVersion).toBe(PROTOCOL_VERSION)
      expect(result.message).toContain('999')
    }
  })

  it('rejects missing protocolVersion', () => {
    const result = validateHandshake({ clientVersion: '0.0.0' }, server)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe(HandshakeError.MISSING_PROTOCOL_VERSION)
    }
  })

  it('rejects non-number protocolVersion', () => {
    const result = validateHandshake({ protocolVersion: '1' }, server)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe(HandshakeError.INVALID_PROTOCOL_VERSION)
    }
  })

  it('rejects null payload', () => {
    const result = validateHandshake(null, server)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe(HandshakeError.MISSING_PROTOCOL_VERSION)
    }
  })

  it('rejects NaN protocolVersion', () => {
    const result = validateHandshake({ protocolVersion: Number.NaN }, server)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe(HandshakeError.INVALID_PROTOCOL_VERSION)
    }
  })

  it('rejects Infinity protocolVersion', () => {
    const result = validateHandshake({ protocolVersion: Number.POSITIVE_INFINITY }, server)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe(HandshakeError.INVALID_PROTOCOL_VERSION)
    }
  })
})
