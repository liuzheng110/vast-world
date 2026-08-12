import type { ReactElement } from 'react'
import type { ConnState } from '../net/connection'

/**
 * 连接状态覆盖层：
 * - connecting：连接中
 * - version-mismatch：协议版本不匹配（刷新提示）
 * - error / disconnected / idle：连接失败或断开（重试提示）
 * connected：不渲染（游戏可见）
 */
export function StatusOverlay({
  state,
  onRetry,
}: {
  state: ConnState
  onRetry: () => void
}): ReactElement | null {
  if (state.status === 'connected') return null

  if (state.status === 'version-mismatch') {
    return (
      <div className="overlay" data-testid="version-mismatch">
        <div className="panel panel-error">
          <h2>协议版本不匹配</h2>
          <p>{state.error ?? '客户端与服务端协议版本不一致，请升级客户端。'}</p>
          <button type="button" onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </div>
      </div>
    )
  }

  if (state.status === 'connecting') {
    return (
      <div className="overlay">
        <div className="panel">
          <h2>正在连接 VastWorld…</h2>
          <p>正在与游戏服务建立 WebSocket 连接。</p>
        </div>
      </div>
    )
  }

  const title = state.status === 'disconnected' ? '连接已断开' : '无法连接服务'
  return (
    <div className="overlay">
      <div className="panel panel-error">
        <h2>{title}</h2>
        <p>{state.error ?? '游戏服务可能离线，或网络不可用。'}</p>
        <button type="button" onClick={onRetry}>
          重试连接
        </button>
      </div>
    </div>
  )
}
