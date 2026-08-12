import { useEffect, useState } from 'react'
import { getState, subscribe, type ConnState } from './connection'

/** 订阅连接状态的单例，供 React 组件渲染 HUD / 覆盖层。 */
export function useConnection(): ConnState {
  const [state, setState] = useState<ConnState>(() => getState())
  useEffect(() => subscribe(setState), [])
  return state
}
