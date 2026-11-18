import { describe, expect, it } from 'vitest'
import { APP_NAME, APP_TAGLINE } from '../src/utils/brand'
import { formatIDR } from '../src/utils/format'

describe('identitas aplikasi', () => {
  it('memakai nama dan tagline WHISTLE', () => {
    expect(APP_NAME).toBe('WHISTLE')
    expect(APP_TAGLINE).toBe('Smart Stock. Accurate Value. Total Control')
  })
})

describe('format', () => {
  it('memformat rupiah', () => {
    expect(formatIDR(1600000)).toContain('1.600.000')
  })
})
