import { describe, expect, it } from 'vitest'
import { validateChatInput, validateMoveInput } from './input.js'

describe('validateMoveInput', () => {
  it('accepts valid input', () => {
    const result = validateMoveInput({
      sequence: 1,
      clientTime: 1000,
      axisX: 0.5,
      axisY: -0.3,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data?.axisX).toBe(0.5)
    }
  })

  it('rejects non-object', () => {
    expect(validateMoveInput(null).success).toBe(false)
    expect(validateMoveInput('hello').success).toBe(false)
    expect(validateMoveInput(42).success).toBe(false)
  })

  it('rejects non-integer sequence', () => {
    expect(validateMoveInput({ sequence: 1.5, clientTime: 0, axisX: 0, axisY: 0 }).success).toBe(
      false,
    )
  })

  it('rejects negative sequence', () => {
    expect(validateMoveInput({ sequence: -1, clientTime: 0, axisX: 0, axisY: 0 }).success).toBe(
      false,
    )
  })

  it('rejects out-of-range axis', () => {
    expect(validateMoveInput({ sequence: 1, clientTime: 0, axisX: 2, axisY: 0 }).success).toBe(
      false,
    )
    expect(validateMoveInput({ sequence: 1, clientTime: 0, axisX: 0, axisY: -2 }).success).toBe(
      false,
    )
  })

  it('rejects NaN values', () => {
    expect(
      validateMoveInput({ sequence: 1, clientTime: Number.NaN, axisX: 0, axisY: 0 }).success,
    ).toBe(false)
  })

  it('rejects missing fields', () => {
    expect(validateMoveInput({ sequence: 1, clientTime: 0, axisX: 0 }).success).toBe(false)
  })
})

describe('validateChatInput', () => {
  it('accepts valid text', () => {
    const result = validateChatInput({ text: 'hello world' })
    expect(result.success).toBe(true)
  })

  it('rejects empty text', () => {
    expect(validateChatInput({ text: '' }).success).toBe(false)
  })

  it('rejects too long text', () => {
    expect(validateChatInput({ text: 'a'.repeat(501) }).success).toBe(false)
  })

  it('accepts exactly 500 chars', () => {
    expect(validateChatInput({ text: 'a'.repeat(500) }).success).toBe(true)
  })

  it('rejects non-string text', () => {
    expect(validateChatInput({ text: 123 }).success).toBe(false)
  })

  it('rejects non-object', () => {
    expect(validateChatInput(null).success).toBe(false)
    expect(validateChatInput('hello').success).toBe(false)
  })
})
