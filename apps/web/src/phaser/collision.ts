import { isObstacle, type GameMap } from './mapgen'

/** 纯碰撞与移动解算（客户端本地预测）。无远程状态依赖，可单测。 */

export interface Vec2 {
  x: number
  y: number
}

/** 以半径覆盖的瓦片中是否存在障碍（含越界）。 */
export function isBlockedAt(world: Vec2, map: GameMap, radius: number): boolean {
  const minC = Math.floor((world.x - radius) / map.tileSize)
  const maxC = Math.floor((world.x + radius) / map.tileSize)
  const minR = Math.floor((world.y - radius) / map.tileSize)
  const maxR = Math.floor((world.y + radius) / map.tileSize)

  for (let c = minC; c <= maxC; c++) {
    for (let r = minR; r <= maxR; r++) {
      if (isObstacle(map, c, r)) return true
    }
  }
  return false
}

/**
 * 根据输入轴推进位置，做逐轴解算 + 世界边界钳制（不修改入参）。
 * 对角线输入会被归一化，避免斜向更快。
 */
export function resolveMove(
  pos: Vec2,
  axisX: number,
  axisY: number,
  map: GameMap,
  speed: number,
  dt: number,
  radius: number,
): Vec2 {
  const len = Math.hypot(axisX, axisY)
  const nx = len > 1 ? axisX / len : axisX
  const ny = len > 1 ? axisY / len : axisY

  const stepX = nx * speed * dt
  const stepY = ny * speed * dt

  let x = pos.x
  let y = pos.y

  const tryX = x + stepX
  if (!isBlockedAt({ x: tryX, y }, map, radius)) x = tryX

  const tryY = y + stepY
  if (!isBlockedAt({ x, y: tryY }, map, radius)) y = tryY

  x = Math.max(map.world.minX + radius, Math.min(map.world.maxX - radius, x))
  y = Math.max(map.world.minY + radius, Math.min(map.world.maxY - radius, y))

  return { x, y }
}
