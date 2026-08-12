import { useEffect, useRef } from 'react'
import { connect, setEndpoint, setExpectedProtocolVersion } from './net/connection'
import { useConnection } from './net/useConnection'
import { Hud } from './ui/Hud'
import { StatusOverlay } from './ui/StatusOverlay'
import { mountPhaser } from './phaser/mountPhaser'
import type { ReactElement } from 'react'

export function App(): ReactElement {
  const state = useConnection()
  const phaserRef = useRef<HTMLDivElement>(null)

  // 连接：读取测试钩子参数后发起连接（仅一次）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const server = params.get('server')
    const expectedProto = params.get('expectedProto')
    if (server) setEndpoint(server)
    if (expectedProto !== null) setExpectedProtocolVersion(Number(expectedProto))
    connect()
  }, [])

  // 挂载 Phaser 到 #game-root
  useEffect(() => {
    if (!phaserRef.current) return
    const game = mountPhaser(phaserRef.current)
    return () => {
      game.destroy(true)
    }
  }, [])

  return (
    <div className="app">
      <div id="game-root" ref={phaserRef} />
      <Hud state={state} />
      <StatusOverlay state={state} onRetry={connect} />
    </div>
  )
}
