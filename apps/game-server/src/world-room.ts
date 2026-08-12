import {
  ClientMessageType,
  CloseCode,
  HANDSHAKE_TIMEOUT_MS,
  HandshakeError,
  MAX_PAYLOAD_BYTES,
  RATE_LIMITS,
  ServerError,
  ServerMessageType,
  isValidEnvelope,
  validateHandshake,
  type ClientEnvelope,
  type HandshakeAckPayload,
  type HandshakeErrorPayload,
  type HandshakeResult,
  type ServerErrorValue,
  type ServerMessageTypeValue,
} from '@vastworld/protocol'
import {
  MAX_PLAYERS_PER_ROOM,
  RateLimiter,
  TICK_HZ,
  TICK_MS,
  WORLD_BOUNDS,
  applyMove,
  createPlayer,
  validateChatInput,
  validateMoveInput,
  type PlayerState,
} from '@vastworld/game-core'
import { type Client, Room } from '@colyseus/core'
import { serverVersionInfo } from './version.js'

/**
 * WorldRoom —— VastWorld 最小权威房间。
 *
 * 连接生命周期（服务端权威，见 ARCHITECTURE.md §6.4 / §9）：
 *
 * ```
 * onJoin ──► pending 会话（无玩家、无房间状态、无广播）
 *              │
 *              ├── handshake 通过 ──► 创建玩家 + HANDSHAKE_ACK ──► 允许 move/chat
 *              ├── handshake 失败 ──► HANDSHAKE_ERROR + 断开（CloseCode.PROTOCOL_MISMATCH）
 *              └── 超时未握手  ──► HANDSHAKE_ERROR + 断开（CloseCode.HANDSHAKE_TIMEOUT）
 * ```
 *
 * 关键不变式：
 * 1. 玩家只在 `protocolVersion` 校验通过后创建，`onJoin` 本身不创建任何游戏状态。
 * 2. 未握手会话发送 move/chat 一律返回 NOT_AUTHENTICATED，不改变任何房间状态。
 * 3. 未握手会话不出现在任何广播的接收方集合中（不"进入房间状态"）。
 * 4. 未握手会话在 HANDSHAKE_TIMEOUT_MS 后被断开，不长期占用房间名额。
 *
 * 注意：Colyseus 0.16 的 `onMessage(type, callback)` 用于注册特定 type 处理器，
 * 不能重写为 `(client, raw) => void`。我们使用通配符 "*" 捕获所有消息，
 * 在 onCreate 中注册。
 */
export class WorldRoom extends Room {
  static MAX_PLAYERS = MAX_PLAYERS_PER_ROOM
  static TICK_HZ = TICK_HZ

  /** 连接会话，sessionId → Session（包含未握手的 pending 会话） */
  private sessions = new Map<string, Session>()

  /** 已握手玩家的权威状态，sessionId → PlayerState */
  private players = new Map<string, PlayerState>()

  /** 是否已就绪 */
  ready = false

  override onCreate(): void {
    this.maxClients = WorldRoom.MAX_PLAYERS
    this.setPatchRate(null) // M0 不做 state patch，使用手动消息
    this.setSimulationInterval(this.tick.bind(this), TICK_MS)
    this.ready = true

    // 注册通配符消息处理器：所有消息都走这里
    this.onMessage('*', (client, type, message) => {
      this.handleMessage(client, String(type), message)
    })
  }

  /**
   * 建立连接会话，但**不创建玩家**。
   *
   * 玩家只有在握手（protocolVersion 校验）通过后才会被创建。
   */
  override onJoin(client: Client, _options: unknown): void {
    if (this.sessions.size >= WorldRoom.MAX_PLAYERS) {
      throw new Error(ServerError.ROOM_FULL)
    }

    const session: Session = {
      client,
      handshaken: false,
      limiters: {
        all: new RateLimiter(RATE_LIMITS.maxMessagesPerSecond),
        move: new RateLimiter(RATE_LIMITS.maxMovesPerSecond),
        chat: new RateLimiter(RATE_LIMITS.maxChatsPerSecond),
      },
      handshakeTimer: null,
    }
    this.sessions.set(client.sessionId, session)

    // 超时未握手的连接会被断开，避免占用房间名额
    const timer = setTimeout(() => {
      this.dropUnhandshaken(client.sessionId)
    }, HANDSHAKE_TIMEOUT_MS)
    timer.unref?.()
    session.handshakeTimer = timer
  }

  override onLeave(client: Client, _consented: boolean): void {
    const session = this.sessions.get(client.sessionId)
    if (session) clearHandshakeTimer(session)
    this.sessions.delete(client.sessionId)
    this.players.delete(client.sessionId)
  }

  override onDispose(): void {
    for (const session of this.sessions.values()) clearHandshakeTimer(session)
    this.sessions.clear()
    this.players.clear()
    // 不传回调即清除模拟循环，避免房间销毁后仍有 timer 存活
    this.setSimulationInterval()
    this.ready = false
  }

  // -----------------------------------------------------------------------
  // 消息分发
  // -----------------------------------------------------------------------

  /**
   * 统一处理所有入站消息。
   * 通配符 "*" 捕获后，我们手动做 envelope 校验、握手门禁和分发。
   */
  private handleMessage(client: Client, type: string, message: unknown): void {
    // 0. 必须存在会话（onJoin 已建立）
    const session = this.sessions.get(client.sessionId)
    if (!session) {
      this.sendError(client, ServerError.NOT_AUTHENTICATED)
      return
    }

    // 1. 拒绝过大 payload
    const size = estimatePayloadSize(message)
    if (size > MAX_PAYLOAD_BYTES) {
      this.sendError(client, ServerError.PAYLOAD_TOO_LARGE)
      return
    }

    // 2. 组合 envelope（type 来自 Colyseus 路由，message 是 payload）
    const envelope: ClientEnvelope = { type, payload: message }

    // 3. 校验 envelope 基本结构
    if (!isValidEnvelope(envelope)) {
      this.sendError(client, ServerError.PAYLOAD_INVALID)
      return
    }

    // 4. 频率限制（总消息数）——握手同样计数，防止握手风暴
    const now = Date.now()
    if (!session.limiters.all.tryConsume(now)) {
      this.sendError(client, ServerError.RATE_LIMITED)
      return
    }

    // 5. 握手与主动离开在握手门禁之前处理
    if (envelope.type === ClientMessageType.HANDSHAKE) {
      this.handleHandshake(session, envelope.payload)
      return
    }
    if (envelope.type === ClientMessageType.LEAVE) {
      void client.leave()
      return
    }

    // 6. 握手门禁：未完成握手的连接不得触碰任何游戏状态
    if (!session.handshaken) {
      this.sendError(client, ServerError.NOT_AUTHENTICATED)
      return
    }

    // 7. 按类型分发
    switch (envelope.type) {
      case ClientMessageType.MOVE:
        if (!session.limiters.move.tryConsume(now)) {
          this.sendError(client, ServerError.RATE_LIMITED)
          return
        }
        this.handleMove(client, envelope.payload)
        break
      case ClientMessageType.CHAT:
        if (!session.limiters.chat.tryConsume(now)) {
          this.sendError(client, ServerError.RATE_LIMITED)
          return
        }
        this.handleChat(client, envelope.payload)
        break
      default:
        // 未知消息类型一律拒绝
        this.sendError(client, ServerError.UNKNOWN_MESSAGE_TYPE)
    }
  }

  /**
   * 握手：校验 protocolVersion。
   *
   * - 失败：回 HANDSHAKE_ERROR 并断开连接，绝不创建玩家。
   * - 成功且首次：创建玩家，回 HANDSHAKE_ACK。
   * - 成功且重复：幂等重发 HANDSHAKE_ACK，不重建玩家、不重置位置。
   */
  private handleHandshake(session: Session, payload: unknown): void {
    const client = session.client
    const result: HandshakeResult = validateHandshake(payload, serverVersionInfo)

    if (!result.ok) {
      clearHandshakeTimer(session)
      this.sendHandshakeError(client, {
        reason: result.reason,
        message: result.message,
        expectedProtocolVersion: result.expectedProtocolVersion,
      })
      // 版本不匹配的客户端不允许留在房间里
      void client.leave(CloseCode.PROTOCOL_MISMATCH)
      return
    }

    clearHandshakeTimer(session)

    if (!session.handshaken) {
      const spawn = {
        x: (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2,
        y: (WORLD_BOUNDS.minY + WORLD_BOUNDS.maxY) / 2,
      }
      this.players.set(
        client.sessionId,
        createPlayer(client.sessionId, `Player-${client.sessionId.slice(0, 6)}`, spawn),
      )
      session.handshaken = true
    }

    const ack: HandshakeAckPayload = {
      server: serverVersionInfo,
      playerId: client.sessionId,
    }
    client.send(ServerMessageType.HANDSHAKE_ACK, ack)
  }

  /** 超时未握手：告知原因并断开。 */
  private dropUnhandshaken(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.handshaken) return

    clearHandshakeTimer(session)
    this.sendHandshakeError(session.client, {
      reason: HandshakeError.HANDSHAKE_TIMEOUT,
      message: `Handshake not received within ${HANDSHAKE_TIMEOUT_MS}ms.`,
      expectedProtocolVersion: serverVersionInfo.protocolVersion,
    })
    void session.client.leave(CloseCode.HANDSHAKE_TIMEOUT)
  }

  private handleMove(client: Client, payload: unknown): void {
    const player = this.players.get(client.sessionId)
    if (!player) {
      this.sendError(client, ServerError.NOT_AUTHENTICATED)
      return
    }
    const result = validateMoveInput(payload)
    if (!result.success || !result.data) {
      this.sendError(client, ServerError.PAYLOAD_INVALID)
      return
    }
    applyMove(player, result.data)
  }

  private handleChat(client: Client, payload: unknown): void {
    const player = this.players.get(client.sessionId)
    if (!player) {
      this.sendError(client, ServerError.NOT_AUTHENTICATED)
      return
    }
    const result = validateChatInput(payload)
    if (!result.success || !result.data) {
      this.sendError(client, ServerError.PAYLOAD_INVALID)
      return
    }
    this.broadcastToPlayers(ServerMessageType.CHAT_BROADCAST, {
      playerId: player.id,
      nickname: player.nickname,
      text: result.data.text,
      timestamp: Date.now(),
    })
  }

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  private tick(): void {
    // M0 tick：不做额外模拟（移动已在 handleMove 中即时应用）
    // 后续 M2 可在此处做碰撞检测、怪物 AI 等
  }

  // -----------------------------------------------------------------------
  // 辅助
  // -----------------------------------------------------------------------

  /**
   * 只向已握手的会话广播。
   *
   * 不使用 `Room.broadcast`：它会把消息发给房间内所有连接，包括尚未通过
   * 协议版本校验的 pending 会话，等价于让未握手客户端"进入房间状态"。
   */
  private broadcastToPlayers(type: ServerMessageTypeValue, payload: unknown): void {
    for (const session of this.sessions.values()) {
      if (!session.handshaken) continue
      session.client.send(type, payload)
    }
  }

  private sendError(client: Client, error: ServerErrorValue): void {
    client.send(ServerMessageType.ERROR, { error })
  }

  private sendHandshakeError(client: Client, payload: HandshakeErrorPayload): void {
    client.send(ServerMessageType.HANDSHAKE_ERROR, payload)
  }

  /** 已握手玩家数量（不含 pending 会话）。 */
  get playerCount(): number {
    return this.players.size
  }

  /** 连接会话总数（含未握手的 pending 会话）。 */
  get sessionCount(): number {
    return this.sessions.size
  }

  /** 指定会话是否已完成握手。 */
  isHandshaken(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.handshaken ?? false
  }
}

/** 单个连接会话的服务端视图。 */
interface Session {
  client: Client
  /** protocolVersion 校验是否已通过 */
  handshaken: boolean
  limiters: { all: RateLimiter; move: RateLimiter; chat: RateLimiter }
  handshakeTimer: ReturnType<typeof setTimeout> | null
}

function clearHandshakeTimer(session: Session): void {
  if (session.handshakeTimer === null) return
  clearTimeout(session.handshakeTimer)
  session.handshakeTimer = null
}

/** 估算 payload 的序列化字节数。 */
function estimatePayloadSize(value: unknown): number {
  if (typeof value === 'string') return value.length * 3 // UTF-8 最坏 3 字节/字符
  if (value === null || value === undefined) return 4
  try {
    return JSON.stringify(value).length
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}
