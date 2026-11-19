import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockedProduct } from '../src/services/transactions'

const remote = vi.hoisted(() => ({
  searchProducts: vi.fn(),
  findProductByScan: vi.fn(),
  fetchStock: vi.fn(),
  fetchAllStocked: vi.fn(),
}))

vi.mock('../src/services/transactions', async (orig) => ({ ...(await orig<typeof import('../src/services/transactions')>()), ...remote }))

import { isNetworkError, localCache, lookupCatalog, refreshCache, searchCatalog, stockCatalog } from '../src/services/catalog'
import { pwaOptions } from '../pwa.config'

function setOnline(value: boolean) {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: value }, configurable: true })
}

const product = (sku: string, over: Partial<StockedProduct> = {}): StockedProduct => ({
  id: `id-${sku}`, sku, barcode: null, product_name: `Barang ${sku}`, category: 'Umum', unit: 'PCS', is_active: true,
  quantity: '10', average_cost: '100', inventory_value: '1000', ...over,
})

beforeEach(async () => {
  Object.values(remote).forEach((m) => m.mockReset())
  await localCache.replaceAll(
    [{ sku: 'LOC-1', barcode: '8999', name: 'Barang Lokal', category: null, unit: 'PCS', active: true }],
    [{ sku: 'LOC-1', qty: '7', averageCost: '50', value: '350', updatedAt: '2026-11-19T00:00:00Z' }],
  )
  setOnline(true)
})
afterEach(() => setOnline(true))

describe('isNetworkError', () => {
  it('mengenali kegagalan fetch dan TypeError, bukan penolakan server', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new Error('NetworkError when attempting to fetch resource'))).toBe(true)
    expect(isNetworkError(new Error('Load failed'))).toBe(true)
    expect(isNetworkError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isNetworkError({ code: 'WS001', message: 'Stok tidak mencukupi' })).toBe(false)
    expect(isNetworkError(new Error('Supabase belum dikonfigurasi'))).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})

describe('katalog yang sadar offline', () => {
  it('online: memakai server dan tidak menyentuh cache', async () => {
    remote.searchProducts.mockResolvedValue([product('SRV-1')])
    const r = await searchCatalog('srv')
    expect(r.source).toBe('server')
    expect(r.value.map((p) => p.sku)).toEqual(['SRV-1'])
  })

  it('offline: langsung memakai cache tanpa memanggil server', async () => {
    setOnline(false)
    const r = await searchCatalog('lokal')
    expect(r.source).toBe('cache')
    expect(r.value[0]).toMatchObject({ sku: 'LOC-1', quantity: '7', average_cost: '50' })
    expect(remote.searchProducts).not.toHaveBeenCalled()

    const scan = await lookupCatalog('8999')
    expect(scan.source).toBe('cache')
    expect(scan.value).toMatchObject({ kind: 'found', product: { sku: 'LOC-1' } })
    expect(remote.findProductByScan).not.toHaveBeenCalled()

    const stock = await stockCatalog(['LOC-1'])
    expect(stock.source).toBe('cache')
    expect(stock.value.get('LOC-1')).toMatchObject({ quantity: '7' })
    expect(remote.fetchStock).not.toHaveBeenCalled()
  })

  it('terlihat online tetapi jaringan gagal: jatuh ke cache', async () => {
    remote.searchProducts.mockRejectedValue(new TypeError('Failed to fetch'))
    remote.findProductByScan.mockRejectedValue(new TypeError('Failed to fetch'))
    remote.fetchStock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await searchCatalog('lokal')).source).toBe('cache')
    expect((await lookupCatalog('LOC-1')).source).toBe('cache')
    expect((await stockCatalog(['LOC-1'])).source).toBe('cache')
  })

  it('penolakan server (bukan jaringan) tidak disamarkan dengan cache', async () => {
    remote.searchProducts.mockRejectedValue(Object.assign(new Error('permission denied'), { code: '42501' }))
    await expect(searchCatalog('lokal')).rejects.toThrow(/permission denied/)
  })

  it('barang yang tidak ada di cache dilaporkan tidak ditemukan saat offline', async () => {
    setOnline(false)
    expect((await lookupCatalog('TIDAK-ADA')).value).toEqual({ kind: 'none', scanned: 'TIDAK-ADA' })
    expect((await searchCatalog('zzz')).value).toEqual([])
  })
})

describe('penyegaran cache dari server', () => {
  it('mengganti seluruh isi cache dan mencatat waktunya', async () => {
    remote.fetchAllStocked.mockResolvedValue([
      product('NEW-1', { barcode: '123', quantity: '5', average_cost: '20.5', inventory_value: '102.5' }),
      product('NEW-2', { is_active: false }),
    ])
    expect(await refreshCache()).toBe(2)
    expect(await localCache.count()).toBe(2)
    expect((await localCache.findByScan('LOC-1')).kind).toBe('none') // data lama diganti
    expect((await localCache.findByScan('123'))).toMatchObject({ kind: 'found', product: { sku: 'NEW-1', quantity: '5', average_cost: '20.5' } })
    expect((await localCache.findByScan('NEW-2')).kind).toBe('inactive')
    expect(await localCache.cachedAt()).not.toBeNull()
  })

  it('gagal mengambil dari server: cache lama tetap utuh', async () => {
    remote.fetchAllStocked.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(refreshCache()).rejects.toThrow()
    expect(await localCache.count()).toBe(1)
    expect((await localCache.findByScan('LOC-1')).kind).toBe('found')
  })
})

describe('konfigurasi PWA: service worker hanya untuk app shell dan aset', () => {
  const o = pwaOptions('/whistle/')

  it('tidak ada runtimeCaching sehingga panggilan API tidak pernah di-cache', () => {
    expect(o.workbox?.runtimeCaching).toBeUndefined()
  })

  it('hanya aset statis yang di-precache', () => {
    const patterns = (o.workbox?.globPatterns ?? []).join(' ')
    for (const ext of ['js', 'css', 'html', 'png', 'svg', 'webmanifest']) expect(patterns).toContain(ext)
    expect(patterns).not.toMatch(/json|api|supabase/)
  })

  it('app shell dapat dibuka saat offline pada path GitHub Pages', () => {
    expect(o.workbox?.navigateFallback).toBe('/whistle/index.html')
    expect(o.workbox?.cleanupOutdatedCaches).toBe(true)
    expect(o.registerType).toBe('autoUpdate')
  })

  it('manifest memakai identitas WHISTLE dan dapat dipasang (start_url, scope, ikon)', () => {
    const m = o.manifest as { name: string; short_name: string; description: string; start_url: string; scope: string; display: string; icons: { sizes: string }[] }
    expect(m).toMatchObject({ name: 'WHISTLE', short_name: 'WHISTLE', description: 'Smart Stock. Accurate Value. Total Control', start_url: '/whistle/', scope: '/whistle/', display: 'standalone' })
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  })
})
