import { type Client } from '@colyseus/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientMessageType,
  CloseCode,
  HANDSHAKE_TIMEOUT_MS,
  HandshakeError,
  PROTOCOL_VERSION,
  ServerError,
  ServerMessageType,
} from '@vastworld/protocol'
import { WorldRoom } from './world-room.js'

/**
 * 直接实例化 WorldRoom，模拟 Colyseus 生命周期调用。
 * 不走真实 WebSocket，只验证房间逻辑。
 *
 * 重点覆盖握手门禁（服务端权威）：
 * - onJoin 不创建玩家
 * - 未握手不得 move/chat、不接收广播
 * - 版本错误被拒绝并断开
 * - 超时未握手被断开
 */

interface FakeClientInternal {
  sessionId: string
  id: string
  state: number
  _joinedAt: number
  _enqueuedMessages: unknown[]
  raw: () => void
  send: (type: string, data: unknown) => void
  leave: ReturnType<typeof vi.fn>
  encode: undefined
  diff: undefined
  toJSON: () => unknown
  __sent: Array<{ type: string; data: unknown }>
}

function makeFakeClient(sessionId: string): Client {
  const sent: FakeClientInternal['__sent'] = []
  const client: FakeClientInternal = {
    sessionId,
    id: sessionId,
    state: 0,
    _joinedAt: 0,
    _enqueuedMessages: [],
    raw: () => {},
    send: (type: string, data: unknown) => {
      sent.push({ type, data })
    },
    leave: vi.fn().mockResolvedValue(undefined),
    encode: undefined,
    diff: undefined,
    toJSON: () => ({ sessionId }),
    __sent: sent,
  }
  return client as unknown as Client
}

function internals(client: Client): FakeClientInternal {
  return client as unknown as FakeClientInternal
}

function sentOf(client: Client): Array<{ type: string; data: unknown }> {
  return internals(client).__sent
}

function errorsOf(client: Client): string[] {
  return sentOf(client)
    .filter((s) => s.type === ServerMessageType.ERROR)
    .map((s) => (s.data as { error: string }).error)
}

function setupRoom(): WorldRoom {
  const room = new WorldRoom()
  ;(room as unknown as { roomId: string }).roomId = 'test-room'
  ;(room as unknown as { roomName: string }).roomName = 'world'
  // onCreate 是 public 方法（Colyseus Room 生命周期）
  room.onCreate()
  return room
}

function callHandleMessage(room: WorldRoom, client: Client, type: string, message: unknown): void {
  ;(room as unknown as { handleMessage: (c: Client, t: string, m: unknown) => void }).handleMessage(
    client,
    type,
    message,
  )
}

/** 加入 + 完成合法握手，返回已握手的客户端。 */
function joinAndHandshake(room: WorldRoom, sessionId: string): Client {
  const client = makeFakeClient(sessionId)
  room.onJoin(client, {})
  callHandleMessage(room, client, ClientMessageType.HANDSHAKE, {
    protocolVersion: PROTOCOL_VERSION,
    clientVersion: '0.0.0',
  })
  return client
}

describe('WorldRoom', () => {
  let room: WorldRoom

  beforeEach(() => {
    room = setupRoom()
  })

  afterEach(() => {
    room.onDispose()
    vi.useRealTimers()
  })

  it('initializes with correct state', () => {
    expect(room.ready).toBe(true)
    expect(room.playerCount).toBe(0)
    expect(room.sessionCount).toBe(0)
    expect(room.maxClients).toBe(WorldRoom.MAX_PLAYERS)
  })

  // -------------------------------------------------------------------------
  // 握手门禁
  // -------------------------------------------------------------------------

  it('onJoin does NOT create a player and sends nothing before handshake', () => {
    const client = makeFakeClient('sess-1')
    room.onJoin(client, {})

    expect(room.sessionCount).toBe(1)
    expect(room.playerCount).toBe(0)
    expect(room.isHandshaken('sess-1')).toBe(false)
    expect(sentOf(client)).toHaveLength(0)
  })

  it('creates the player only after a valid handshake', () => {
    const client = joinAndHandshake(room, 'sess-2')

    expect(room.playerCount).toBe(1)
    expect(room.isHandshaken('sess-2')).toBe(true)

    const acks = sentOf(client).filter((s) => s.type === ServerMessageType.HANDSHAKE_ACK)
    expect(acks).toHaveLength(1)
    expect((acks[0]?.data as { playerId: string }).playerId).toBe('sess-2')
    expect((acks[0]?.data as { server: { protocolVersion: number } }).server.protocolVersion).toBe(
      PROTOCOL_VERSION,
    )
  })

  it('rejects move before handshake with NOT_AUTHENTICATED and creates no player', () => {
    const client = makeFakeClient('sess-3')
    room.onJoin(client, {})

    callHandleMessage(room, client, ClientMessageType.MOVE, {
      sequence: 1,
      clientTime: Date.now(),
      axisX: 1,
      axisY: 0,
    })

    expect(errorsOf(client)).toEqual([ServerError.NOT_AUTHENTICATED])
    expect(room.playerCount).toBe(0)
  })

  it('rejects chat before handshake with NOT_AUTHENTICATED', () => {
    const client = makeFakeClient('sess-4')
    room.onJoin(client, {})

    callHandleMessage(room, client, ClientMessageType.CHAT, { text: 'hello' })

    expect(errorsOf(client)).toEqual([ServerError.NOT_AUTHENTICATED])
    expect(room.playerCount).toBe(0)
  })

  it('rejects unknown message type before handshake with NOT_AUTHENTICATED', () => {
    const client = makeFakeClient('sess-5')
    room.onJoin(client, {})

    callHandleMessage(room, client, 'totally-unknown-type', {})

    expect(errorsOf(client)).toEqual([ServerError.NOT_AUTHENTICATED])
  })

  it('rejects a mismatched protocol version and disconnects the client', () => {
    const client = makeFakeClient('sess-6')
    room.onJoin(client, {})

    callHandleMessage(room, client, ClientMessageType.HANDSHAKE, { protocolVersion: 999 })

    const handshakeErrors = sentOf(client).filter(
      (s) => s.type === ServerMessageType.HANDSHAKE_ERROR,
    )
    expect(handshakeErrors).toHaveLength(1)
    expect((handshakeErrors[0]?.data as { reason: string }).reason).toBe(
      HandshakeError.PROTOCOL_MISMATCH,
    )
    expect(room.playerCount).toBe(0)
    expect(room.isHandshaken('sess-6')).toBe(false)
    expect(internals(client).leave).toHaveBeenCalledWith(CloseCode.PROTOCOL_MISMATCH)
  })

  it('rejects a handshake without protocolVersion', () => {
    const client = makeFakeClient('sess-7')
    room.onJoin(client, {})

    callHandleMessage(room, client, ClientMessageType.HANDSHAKE, { clientVersion: '0.0.0' })

    const handshakeErrors = sentOf(client).filter(
      (s) => s.type === ServerMessageType.HANDSHAKE_ERROR,
    )
    expect(handshakeErrors).toHaveLength(1)
    expect((handshakeErrors[0]?.data as { reason: string }).reason).toBe(
      HandshakeError.MISSING_PROTOCOL_VERSION,
    )
    expect(room.playerCount).toBe(0)
  })

  it('disconnects a session that never handshakes within the timeout', () => {
    vi.useFakeTimers()
    const timedOutRoom = setupRoom()
    const client = makeFakeClient('sess-8')
    timedOutRoom.onJoin(client, {})

    vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS + 1)

    const handshakeErrors = sentOf(client).filter(
      (s) => s.type === ServerMessageType.HANDSHAKE_ERROR,
    )
    expect(handshakeErrors).toHaveLength(1)
    expect((handshakeErrors[0]?.data as { reason: string }).reason).toBe(
      HandshakeError.HANDSHAKE_TIMEOUT,
    )
    expect(internals(client).leave).toHaveBeenCalledWith(CloseCode.HANDSHAKE_TIMEOUT)
    expect(timedOutRoom.playerCount).toBe(0)
    timedOutRoom.onDispose()
  })

  it('does not disconnect a session that handshakes in time', () => {
    vi.useFakeTimers()
    const timedRoom = setupRoom()
    const client = joinAndHandshake(timedRoom, 'sess-9')

    vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS * 3)

    expect(sentOf(client).filter((s) => s.type === ServerMessageType.HANDSHAKE_ERROR)).toHaveLength(
      0,
    )
    expect(internals(client).leave).not.toHaveBeenCalled()
    expect(timedRoom.playerCount).toBe(1)
    timedRoom.onDispose()
  })

  it('is idempotent for a repeated valid handshake', () => {
    const client = joinAndHandshake(room, 'sess-10')
    callHandleMessage(room, client, ClientMessageType.HANDSHAKE, {
      protocolVersion: PROTOCOL_VERSION,
    })

    expect(room.playerCount).toBe(1)
    expect(sentOf(client).filter((s) => s.type === ServerMessageType.HANDSHAKE_ACK)).toHaveLength(2)
  })

  // -------------------------------------------------------------------------
  // 握手后的正常流程
  // -------------------------------------------------------------------------

  it('onLeave removes both session and player', () => {
    const client = joinAndHandshake(room, 'sess-11')
    expect(room.playerCount).toBe(1)

    room.onLeave(client, false)
    expect(room.playerCount).toBe(0)
    expect(room.sessionCount).toBe(0)
  })

  it('handles a valid move message after handshake', () => {
    const client = joinAndHandshake(room, 'sess-12')

    callHandleMessage(room, client, ClientMessageType.MOVE, {
      sequence: 1,
      clientTime: Date.now(),
      axisX: 1,
      axisY: 0,
    })

    expect(errorsOf(client)).toEqual([])
    expect(room.playerCount).toBe(1)
  })

  it('rejects invalid move payload with axisX out of range', () => {
    const client = joinAndHandshake(room, 'sess-13')

    callHandleMessage(room, client, ClientMessageType.MOVE, {
      sequence: 1,
      clientTime: 0,
      axisX: 5,
      axisY: 0,
    })

    expect(errorsOf(client)).toEqual([ServerError.PAYLOAD_INVALID])
  })

  it('rejects unknown message type after handshake', () => {
    const client = joinAndHandshake(room, 'sess-14')

    callHandleMessage(room, client, 'totally-unknown-type', {})

    expect(errorsOf(client)).toEqual([ServerError.UNKNOWN_MESSAGE_TYPE])
  })

  it('rejects oversized payload', () => {
    const client = joinAndHandshake(room, 'sess-15')

    const huge = 'x'.repeat(100 * 1024)
    callHandleMessage(room, client, ClientMessageType.CHAT, { text: huge })

    expect(errorsOf(client)).toEqual([ServerError.PAYLOAD_TOO_LARGE])
  })

  it('broadcasts chat only to handshaken sessions', () => {
    const speaker = joinAndHandshake(room, 'sess-16')
    const listener = joinAndHandshake(room, 'sess-17')

    const pending = makeFakeClient('sess-18')
    room.onJoin(pending, {})

    callHandleMessage(room, speaker, ClientMessageType.CHAT, { text: 'hello world' })

    const received = sentOf(listener).filter((s) => s.type === ServerMessageType.CHAT_BROADCAST)
    expect(received).toHaveLength(1)
    expect((received[0]?.data as { text: string }).text).toBe('hello world')

    // 未握手会话不属于房间状态，不应收到任何广播
    expect(sentOf(pending)).toHaveLength(0)
  })

  it('rate limits chat flooding after handshake', () => {
    const client = joinAndHandshake(room, 'sess-19')

    for (let i = 0; i < 10; i += 1) {
      callHandleMessage(room, client, ClientMessageType.CHAT, { text: `spam-${i}` })
    }

    expect(errorsOf(client)).toContain(ServerError.RATE_LIMITED)
  })

  it('leave message triggers client.leave even before handshake', () => {
    const client = makeFakeClient('sess-20')
    room.onJoin(client, {})

    callHandleMessage(room, client, ClientMessageType.LEAVE, {})

    expect(internals(client).leave).toHaveBeenCalled()
  })

  it('rejects messages from an unknown session', () => {
    const stranger = makeFakeClient('sess-ghost')

    callHandleMessage(room, stranger, ClientMessageType.HANDSHAKE, {
      protocolVersion: PROTOCOL_VERSION,
    })

    expect(errorsOf(stranger)).toEqual([ServerError.NOT_AUTHENTICATED])
    expect(room.playerCount).toBe(0)
  })
})
