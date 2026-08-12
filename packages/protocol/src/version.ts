/**
 * 协议版本号。破坏性变更时递增。
 *
 * 兼容策略（见 ARCHITECTURE.md §6.4）：
 * - 数据库向前兼容 → 服务端兼容新旧 → Web 发布 → 移除旧协议
 * - 握手时服务端检查 clientVersion 与 protocolVersion
 * - 不兼容客户端收到明确错误和刷新指引
 */
export const PROTOCOL_VERSION = 1 as const

/**
 * 应用版本号。与 Git tag / release 版本同步，由服务端在启动时注入。
 * 不等价于 protocolVersion —— 同一应用版本内协议可以保持兼容。
 */
export const APP_VERSION = '0.0.0' as const

/**
 * 服务端在握手响应中返回的版本信息。
 */
export interface ServerVersionInfo {
  /** 协议版本 */
  protocolVersion: typeof PROTOCOL_VERSION
  /** 应用 SemVer */
  appVersion: string
  /** Git commit SHA，用于可观测性和构建溯源 */
  commitSha: string
}

/**
 * 客户端握手时发送的版本信息。
 */
export interface ClientHandshake {
  /** 客户端声明的协议版本 */
  protocolVersion: number
  /** 客户端声明的应用版本（可选，用于日志） */
  clientVersion?: string
}

// ---------------------------------------------------------------------------
// 握手结果
// ---------------------------------------------------------------------------

/**
 * 握手错误码。公共 ID 发布后不可复用（ARCHITECTURE.md §6.4）。
 */
export const HandshakeError = {
  /** 协议版本不匹配 */
  PROTOCOL_MISMATCH: 'PROTOCOL_MISMATCH',
  /** 缺少协议版本字段 */
  MISSING_PROTOCOL_VERSION: 'MISSING_PROTOCOL_VERSION',
  /** 协议版本不是合法数字 */
  INVALID_PROTOCOL_VERSION: 'INVALID_PROTOCOL_VERSION',
  /** 加入连接后超时未发送握手 */
  HANDSHAKE_TIMEOUT: 'HANDSHAKE_TIMEOUT',
} as const

export type HandshakeErrorValue = (typeof HandshakeError)[keyof typeof HandshakeError]

export type HandshakeResult =
  | { ok: true; server: ServerVersionInfo }
  | { ok: false; reason: HandshakeErrorValue; message: string; expectedProtocolVersion: number }

/**
 * 服务端握手成功回执 payload（ServerMessageType.HANDSHAKE_ACK）。
 *
 * 收到此消息才代表握手完成：服务端此时才创建玩家并允许游戏消息。
 */
export interface HandshakeAckPayload {
  server: ServerVersionInfo
  playerId: string
}

/**
 * 服务端握手失败 payload（ServerMessageType.HANDSHAKE_ERROR）。
 */
export interface HandshakeErrorPayload {
  reason: HandshakeErrorValue
  message: string
  expectedProtocolVersion: number
}

/**
 * 校验客户端握手信息，返回握手结果。
 *
 * @param input 客户端发送的握手数据
 * @param server 服务端版本信息
 */
export function validateHandshake(input: unknown, server: ServerVersionInfo): HandshakeResult {
  if (input === null || typeof input !== 'object') {
    return {
      ok: false,
      reason: HandshakeError.MISSING_PROTOCOL_VERSION,
      message: 'Handshake payload must be an object.',
      expectedProtocolVersion: server.protocolVersion,
    }
  }

  const obj = input as Record<string, unknown>
  const raw = obj['protocolVersion']

  if (raw === undefined || raw === null) {
    return {
      ok: false,
      reason: HandshakeError.MISSING_PROTOCOL_VERSION,
      message: 'Missing "protocolVersion" in handshake.',
      expectedProtocolVersion: server.protocolVersion,
    }
  }

  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return {
      ok: false,
      reason: HandshakeError.INVALID_PROTOCOL_VERSION,
      message: '"protocolVersion" must be a finite number.',
      expectedProtocolVersion: server.protocolVersion,
    }
  }

  if (raw !== server.protocolVersion) {
    return {
      ok: false,
      reason: HandshakeError.PROTOCOL_MISMATCH,
      message: `Protocol version mismatch: client=${raw}, server=${server.protocolVersion}. Please refresh.`,
      expectedProtocolVersion: server.protocolVersion,
    }
  }

  return { ok: true, server }
}
