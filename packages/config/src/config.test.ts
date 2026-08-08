import { describe, expect, it } from 'vitest'
import eslintConfig from '../eslint.config.mjs'
import prettierConfig from '../prettier.config.mjs'
import vitestConfig from '../vitest.config.ts'

describe('@vastworld/config', () => {
  it('provides a non-empty ESLint flat config', () => {
    expect(Array.isArray(eslintConfig)).toBe(true)
    expect(eslintConfig.length).toBeGreaterThan(0)
  })

  it('provides a Prettier config matching repo style', () => {
    expect(prettierConfig.semi).toBe(false)
    expect(prettierConfig.singleQuote).toBe(true)
    expect(prettierConfig.tabWidth).toBe(2)
  })

  it('provides a base Vitest config', () => {
    expect(vitestConfig).toHaveProperty('test')
  })
})
