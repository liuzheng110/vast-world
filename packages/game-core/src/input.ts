import type { MoveInput } from './constants.js'

// ---------------------------------------------------------------------------
// 输入校验：纯函数校验（ARCHITECTURE.md §3 契约校验）
// 不依赖 zod 等第三方库，game-core 保持零运行时依赖
// ---------------------------------------------------------------------------

export interface ValidationResult<T> {
  success: boolean
  data?: T
  error?: string
}

function ok<T>(data: T): ValidationResult<T> {
  return { success: true, data }
}

function fail<T>(error: string): ValidationResult<T> {
  return { success: false, error }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 校验移动输入 */
export function validateMoveInput(data: unknown): ValidationResult<MoveInput> {
  if (data === null || typeof data !== 'object') return fail('MoveInput must be an object')
  const obj = data as Record<string, unknown>

  const { sequence, clientTime, axisX, axisY } = obj

  if (!Number.isInteger(sequence) || (sequence as number) < 0)
    return fail('sequence must be a non-negative integer')

  if (!isFiniteNumber(clientTime)) return fail('clientTime must be a finite number')

  if (!isFiniteNumber(axisX) || axisX < -1 || axisX > 1) return fail('axisX must be in [-1, 1]')

  if (!isFiniteNumber(axisY) || axisY < -1 || axisY > 1) return fail('axisY must be in [-1, 1]')

  return ok({
    sequence: sequence as number,
    clientTime: clientTime as number,
    axisX: axisX as number,
    axisY: axisY as number,
  })
}

/** 校验聊天输入 */
export function validateChatInput(data: unknown): ValidationResult<{ text: string }> {
  if (data === null || typeof data !== 'object') return fail('ChatInput must be an object')
  const obj = data as Record<string, unknown>
  const { text } = obj

  if (typeof text !== 'string' || text.length === 0 || text.length > 500)
    return fail('text must be a string of 1..500 chars')

  return ok({ text })
}

export const MOVE_INPUT_VALIDATORS = {
  move: (data: unknown) => validateMoveInput(data),
} as const

export type ValidatedMoveInput = MoveInput

// 重新导出 MoveInput 以便消费者从 input 模块获取
export type { MoveInput } from './constants.js'
