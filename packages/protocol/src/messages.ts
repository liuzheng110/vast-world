/**
 * 消息大小上限（字节）。超过此限制的入站消息一律拒绝。
 *
 * 见 ARCHITECTURE.md §9：网络 payload 设大小上限并做运行时校验。
 */
export const MAX_PAYLOAD_BYTES = 64 * 1024 // 64 KiB

/**
 * 客户端加入房间后必须在此时限内完成握手，否则服务端主动断开。
 *
 * 见 ARCHITECTURE.md §9：未完成握手的连接不得占用房间名额。
 */
export const HANDSHAKE_TIMEOUT_MS = 5_000

/**
 * WebSocket 关闭码（自定义区间 4000-4999）。
 *
 * 避开 Colyseus 内部占用的 4000（consented）/4002（with error）/4010（devmode restart）。
 * 公共码值一经发布不得复用（AGENTS.md §4）。
 */
export const CloseCode = {
  /** 握手协议版本不匹配 */
  PROTOCOL_MISMATCH: 4003,
  /** 超时未完成握手 */
  HANDSHAKE_TIMEOUT: 4004,
} as const

export type CloseCodeValue = (typeof CloseCode)[keyof typeof CloseCode]

/**
 * 频率限制默认值。
 */
export const RATE_LIMITS = {
  /** 每客户端每秒最大消息数 */
  maxMessagesPerSecond: 30,
  /** 每客户端每秒最大移动指令数 */
  maxMovesPerSecond: 20,
  /** 每客户端每秒最大聊天消息数 */
  maxChatsPerSecond: 3,
} as const

/**
 * 已知的客户端→服务端消息类型。
 *
 * 未知消息类型一律拒绝处理（ARCHITECTURE.md §9）。
 * 新增类型时追加到此联合，不得复用已发布的 type 字符串。
 */
export const ClientMessageType = {
  HANDSHAKE: 'handshake',
  MOVE: 'move',
  CHAT: 'chat',
  LEAVE: 'leave',
} as const

export type ClientMessageTypeValue = (typeof ClientMessageType)[keyof typeof ClientMessageType]

/**
 * 已知的服务端→客户端消息类型。
 */
export const ServerMessageType = {
  HANDSHAKE_ACK: 'handshake_ack',
  HANDSHAKE_ERROR: 'handshake_error',
  STATE_SYNC: 'state_sync',
  CHAT_BROADCAST: 'chat_broadcast',
  ERROR: 'error',
  KICK: 'kick',
} as const

export type ServerMessageTypeValue = (typeof ServerMessageType)[keyof typeof ServerMessageType]

/**
 * 服务端错误码。
 */
export const ServerError = {
  UNKNOWN_MESSAGE_TYPE: 'UNKNOWN_MESSAGE_TYPE',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  PAYLOAD_INVALID: 'PAYLOAD_INVALID',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  RATE_LIMITED: 'RATE_LIMITED',
  ROOM_FULL: 'ROOM_FULL',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ServerErrorValue = (typeof ServerError)[keyof typeof ServerError]

// ---------------------------------------------------------------------------
// 消息 envelope
// ---------------------------------------------------------------------------

/**
 * 客户端→服务端消息信封。
 * `type` 字段为协议约定，未知值被拒绝。
 */
export interface ClientEnvelope {
  type: string
  payload?: unknown
}

/**
 * 服务端→客户端消息信封。
 */
export interface ServerEnvelope<T = unknown> {
  type: ServerMessageTypeValue
  payload: T
}

// ---------------------------------------------------------------------------
// 具体消息 payload 类型
// ---------------------------------------------------------------------------

/** 客户端移动输入（见 ARCHITECTURE.md §6.1） */
export interface MoveInput {
  sequence: number
  clientTime: number
  axisX: number // -1..1
  axisY: number // -1..1
}

/** 客户端聊天消息 */
export interface ChatInput {
  text: string
}

/** 服务端聊天广播 */
export interface ChatBroadcast {
  playerId: string
  nickname: string
  text: string
  timestamp: number
}

/**
 * 校验 ClientEnvelope 的基本结构。
 * 不校验 payload 内容 —— 由具体处理器按消息类型校验。
 */
export function isValidEnvelope(value: unknown): value is ClientEnvelope {
  if (value === null || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj['type'] === 'string' && obj['type'].length > 0
}
