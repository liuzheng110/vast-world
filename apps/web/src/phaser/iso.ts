/** 等距（2.5D 菱形）投影与坐标换算。纯函数，无副作用，可单测。 */

export const TILE_W = 64
export const TILE_H = 32

export interface Point {
  x: number
  y: number
}

/**
 * 世界坐标 (wx, wy) → 等距屏幕坐标（菱形投影）。
 * wx 越大向右下，wy 越大向左下。
 */
export function isoToScreen(wx: number, wy: number): Point {
  return {
    x: (wx - wy) * (TILE_W / 2),
    y: (wx + wy) * (TILE_H / 2),
  }
}

/** 网格 (col, row) → 世界坐标（瓦片中心）。 */
export function tileToWorld(col: number, row: number, tileSize: number): Point {
  return { x: (col + 0.5) * tileSize, y: (row + 0.5) * tileSize }
}
