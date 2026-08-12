import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(here, 'screenshots')

function watchConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

const isIgnorable = (s: string): boolean => /favicon/i.test(s)

test.describe('VastWorld M0 Web 客户端', () => {
  test('两个独立浏览器会话均成功连接', async ({ browser }) => {
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()

    const errA = watchConsoleErrors(pageA)
    const errB = watchConsoleErrors(pageB)

    await pageA.goto('/')
    await pageB.goto('/')

    await expect(pageA.getByTestId('status-connected')).toBeVisible({ timeout: 30_000 })
    await expect(pageB.getByTestId('status-connected')).toBeVisible({ timeout: 30_000 })

    await expect(pageA.getByTestId('protocol-version')).toHaveText('1')
    await expect(pageB.getByTestId('protocol-version')).toHaveText('1')

    await expect(pageA.locator('#game-canvas')).toBeVisible()
    await expect(pageB.locator('#game-canvas')).toBeVisible()

    // 按一下 W，确认本地移动不报错
    await pageA.keyboard.down('KeyW')
    await pageA.waitForTimeout(400)
    await pageA.keyboard.up('KeyW')

    await pageA.screenshot({ path: join(SHOTS, 'browserA-connected.png') })
    await pageB.screenshot({ path: join(SHOTS, 'browserB-connected.png') })

    const realA = errA.filter((e) => !isIgnorable(e))
    const realB = errB.filter((e) => !isIgnorable(e))
    expect(realA, `browserA 控制台错误: ${realA.join(' | ')}`).toEqual([])
    expect(realB, `browserB 控制台错误: ${realB.join(' | ')}`).toEqual([])

    await ctxA.close()
    await ctxB.close()
  })

  test('错误协议版本显示刷新/升级提示', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/?expectedProto=999')
    await expect(page.getByTestId('version-mismatch')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('version-mismatch')).toContainText('协议')
    await page.screenshot({ path: join(SHOTS, 'wrong-version.png') })
    await ctx.close()
  })

  test('连接失败显示错误态', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/?server=ws://localhost:9999')
    await expect(page.getByTestId('status-error')).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: join(SHOTS, 'connection-error.png') })
    await ctx.close()
  })
})
