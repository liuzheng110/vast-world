import { Client, Room } from 'colyseus.js'
import {
  APP_VERSION,
  ClientMessageType,
  HandshakeError,
  PROTOCOL_VERSION,
  ServerMessageType,
  type HandshakeAckPayload,
  type HandshakeErrorPayload,
  type ServerVersionInfo,
} from '@vastworld/protocol'

/**
 * M0 WebSocket 连接层（单例）。
 *
 * 连接流程（与服务端 world-room 对齐，服务端权威）：
 * 1. joinOrCreate('world') 建立连接。此时服务端只有一个 pending 会话：
 *    没有玩家、不在房间状态里、收不到任何广播。
 * 2. 客户端立即发送 handshake（含 protocolVersion）。
 * 3. 服务端校验 protocolVersion：
 *    - 通过 → 创建玩家并回 HANDSHAKE_ACK → status='connected'，此后才允许 move/chat。
 *    - 失败 → 回 HANDSHAKE_ERROR 并断开 → status='version-mismatch'，显示刷新/升级提示。
 *    - 超时未握手 → 服务端回 HANDSHAKE_ERROR(HANDSHAKE_TIMEOUT) 并断开。
 *
 * 也就是说：拿不到 HANDSHAKE_ACK 就永远进不了 'connected'，任何游戏命令都不会发出。
 *
 * 测试钩子（仅用于 E2E，不影响生产）：
 * - ?server=ws://host:port  覆盖连接端点（验证连接失败态）。
 * - ?expectedProto=N        覆盖客户端期望协议版本（验证版本不匹配页）。
 */

export type ConnStatus =
  'idle' | 'connecting' | 'connected' | 'version-mismatch' | 'error' | 'disconnected'

export interface ConnState {
  status: ConnStatus
  server: ServerVersionInfo | null
  playerId: string | null
  error: string | null
  expectedProtocolVersion: number
}

type Listener = (state: ConnState) => void

const listeners = new Set<Listener>()

let state: ConnState = {
  status: 'idle',
  server: null,
  playerId: null,
  error: null,
  expectedProtocolVersion: PROTOCOL_VERSION,
}

function emit(): void {
  for (const listener of listeners) listener(state)
}

export function getState(): ConnState {
  return state
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  listener(state)
  return () => {
    listeners.delete(listener)
  }
}

let endpointOverride: string | null = null
let expectedOverride: number | null = null

export function setEndpoint(url: string): void {
  endpointOverride = url
}

export function setExpectedProtocolVersion(version: number): void {
  expectedOverride = version
  state = { ...state, expectedProtocolVersion: version }
  emit()
}

function resolveEndpoint(): string {
  if (endpointOverride) return endpointOverride
  const fromEnv = import.meta.env.VITE_GAME_SERVER_URL
  if (fromEnv) return fromEnv
  const host = typeof location !== 'undefined' ? location.hostname : 'localhost'
  return `ws://${host}:2567`
}

let client: Client | null = null
let room: Room | null = null
let moveSeq = 0

export function connect(): void {
  if (state.status === 'connecting' || state.status === 'connected') return

  const expected = expectedOverride ?? PROTOCOL_VERSION
  const endpoint = resolveEndpoint()

  state = { ...state, status: 'connecting', error: null }
  emit()

  void (async () => {
    try {
      client = new Client(endpoint)
      room = await client.joinOrCreate('world', {})

      room.onMessage(ServerMessageType.HANDSHAKE_ACK, (payload: unknown) => {
        const data = payload as HandshakeAckPayload
        if (data.server.protocolVersion !== expected) {
          state = {
            ...state,
            status: 'version-mismatch',
            server: data.server,
            error: `协议版本不匹配：客户端期望 ${expected}，服务端为 ${data.server.protocolVersion}。请刷新页面或升级客户端。`,
          }
          emit()
          return
        }
        state = {
          ...state,
          status: 'connected',
          server: data.server,
          playerId: data.playerId,
          error: null,
        }
        emit()
      })

      room.onMessage(ServerMessageType.HANDSHAKE_ERROR, (payload: unknown) => {
        const data = payload as HandshakeErrorPayload
        // 超时属于连接问题而非版本问题，不应引导用户去升级客户端
        const status: ConnStatus =
          data.reason === HandshakeError.HANDSHAKE_TIMEOUT ? 'error' : 'version-mismatch'
        state = { ...state, status, error: data.message }
        emit()
      })

      room.onMessage(ServerMessageType.ERROR, (payload: unknown) => {
        const data = payload as { error: string }
        if (state.status === 'connected') {
          state = { ...state, error: data.error }
          emit()
        }
      })

      room.onLeave(() => {
        // 握手失败/超时已经给出了更准确的状态，别被断线覆盖掉
        if (state.status !== 'version-mismatch' && state.status !== 'error') {
          state = { ...state, status: 'disconnected', error: null }
          emit()
        }
      })

      room.onError((code: number, message?: string) => {
        state = { ...state, status: 'error', error: `连接错误 ${code}: ${message ?? '未知错误'}` }
        emit()
      })

      // 必须主动握手：服务端在校验通过前不会创建玩家，也不会接受 move/chat
      room.send(ClientMessageType.HANDSHAKE, {
        protocolVersion: expected,
        clientVersion: APP_VERSION,
      })
    } catch (err) {
      state = {
        ...state,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }
      emit()
    }
  })()
}

/** 仅在已握手（connected）时向服务端发送移动输入。 */
export function sendMove(axisX: number, axisY: number): void {
  if (!room || state.status !== 'connected') return
  moveSeq += 1
  room.send(ClientMessageType.MOVE, {
    sequence: moveSeq,
    clientTime: Date.now(),
    axisX,
    axisY,
  })
}

export function disconnect(): void {
  try {
    room?.leave()
  } catch {
    // 忽略离开异常
  }
  room = null
  client = null
  state = { ...state, status: 'idle', error: null }
  emit()
}
