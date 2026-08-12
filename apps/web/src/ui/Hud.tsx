import type { ReactElement } from 'react'
import type { ConnState } from '../net/connection'

const STATUS_LABEL: Record<ConnState['status'], string> = {
  idle: '空闲',
  connecting: '连接中…',
  connected: '已连接',
  'version-mismatch': '版本不匹配',
  error: '连接错误',
  disconnected: '已断开',
}

/** 左上角状态面板：协议版本 / 应用版本 / 提交 SHA / 连接状态。 */
export function Hud({ state }: { state: ConnState }): ReactElement {
  return (
    <div className="hud" data-testid="hud">
      <div className="hud-row">
        <span className="hud-label">状态</span>
        <span className="hud-value" data-testid={`status-${state.status}`}>
          {STATUS_LABEL[state.status]}
        </span>
      </div>
      <div className="hud-row">
        <span className="hud-label">协议版本</span>
        <span className="hud-value" data-testid="protocol-version">
          {state.server ? String(state.server.protocolVersion) : '—'}
        </span>
      </div>
      <div className="hud-row">
        <span className="hud-label">应用版本</span>
        <span className="hud-value" data-testid="app-version">
          {state.server ? state.server.appVersion : '—'}
        </span>
      </div>
      <div className="hud-row">
        <span className="hud-label">提交 SHA</span>
        <span className="hud-value" data-testid="commit-sha" title={state.server?.commitSha}>
          {state.server ? state.server.commitSha : '—'}
        </span>
      </div>
      <div className="hud-row hud-hint">WASD / 方向键移动 · 滚轮缩放</div>
    </div>
  )
}
