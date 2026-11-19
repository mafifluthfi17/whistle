// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderUI, setOnline } from './helpers'

const sync = vi.hoisted(() => ({ counts: { PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0 } }))
vi.mock('../../src/hooks/useSync', () => ({ useSync: () => sync }))
const fetchDashboard = vi.hoisted(() => vi.fn())
vi.mock('../../src/services/reports', async (orig) => ({ ...(await orig<typeof import('../../src/services/reports')>()), fetchDashboard }))

import Dashboard from '../../src/pages/Dashboard'

const summary = (over: Record<string, unknown> = {}) => ({
  today: '2026-11-19', active_sku: 1234, total_qty: '5000.5000', total_value: '123456789.00', pending_count: 0,
  in_today: { qty: '10.0000', value: '1500000.00', count: 2 }, out_today: { qty: '4.0000', value: '600000.00', count: 1 },
  low_stock_count: 3, zero_stock_count: 0,
  recent: [{ id: 't1', transaction_date: '2026-11-19T03:00:00+00:00', transaction_number: 'IN-261119-000001', transaction_type: 'IN', status: 'POSTED', user_name: 'Budi', item_count: 2, total_value: '1500000.00' }],
  ...over,
})

beforeEach(() => {
  fetchDashboard.mockReset().mockResolvedValue(summary())
  sync.counts = { PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0 }
  setOnline(true)
})

describe('Dashboard', () => {
  it('menampilkan angka resmi dari server apa adanya (format Indonesia, Rupiah)', async () => {
    renderUI(<Dashboard onNavigate={vi.fn()} />)
    expect(await screen.findByText('1.234')).toBeTruthy()
    expect(screen.getByText(/Rp 123.456.789/)).toBeTruthy()
    expect(screen.getByText('IN-261119-000001')).toBeTruthy()
    expect(screen.getByText('Budi')).toBeTruthy()
    expect(screen.getByText(/tanggal 2026-11-19/)).toBeTruthy()
    expect(screen.getByText(/belum dibukukan: tidak termasuk saldo/)).toBeTruthy()
  })

  it('antrean lokal ditampilkan terpisah dan tidak masuk ke angka resmi', async () => {
    sync.counts = { PENDING: 2, SYNCING: 1, SYNCED: 0, FAILED: 1, CONFLICT: 1 }
    renderUI(<Dashboard onNavigate={vi.fn()} />)
    await screen.findByText('1.234')
    expect(screen.getByText('3 menunggu')).toBeTruthy()
    expect(screen.getByText(/2 perlu tindakan/)).toBeTruthy()
    expect(screen.getByText('1.234')).toBeTruthy() // SKU tidak berubah oleh antrean
  })

  it('PENDING di server diberi tanda dan penjelasan bukan saldo', async () => {
    fetchDashboard.mockResolvedValue(summary({ pending_count: 4 }))
    renderUI(<Dashboard onNavigate={vi.fn()} />)
    const card = (await screen.findByText('Transaksi menunggu posting')).parentElement!
    expect(card.textContent).toContain('4')
    expect(screen.getByText(/PENDING di server: belum dibukukan/)).toBeTruthy()
  })

  it('kartu Low/Zero stock dan "Buka antrean" menavigasi', async () => {
    const nav = vi.fn()
    renderUI(<Dashboard onNavigate={nav} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Low stock/ }))
    expect(nav).toHaveBeenLastCalledWith('laporan')
    await user.click(screen.getByRole('button', { name: 'Buka antrean' }))
    expect(nav).toHaveBeenLastCalledWith('antrean')
  })

  it('tanpa aktivitas: pesan kosong. Galat server: tampil dan tidak ada angka palsu', async () => {
    fetchDashboard.mockResolvedValueOnce(summary({ recent: [] }))
    const { unmount } = renderUI(<Dashboard onNavigate={vi.fn()} />)
    expect(await screen.findByText('Belum ada aktivitas.')).toBeTruthy()
    unmount()
    fetchDashboard.mockRejectedValue(new Error('Gagal terhubung ke server'))
    renderUI(<Dashboard onNavigate={vi.fn()} />)
    expect((await screen.findAllByText('Gagal terhubung ke server')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Total SKU aktif')).toBeNull()
  })

  it('"Muat ulang" mengambil data lagi; status koneksi mengikuti jaringan', async () => {
    setOnline(false)
    renderUI(<Dashboard onNavigate={vi.fn()} />)
    await screen.findByText('1.234')
    expect(screen.getAllByText('Offline').length).toBeGreaterThan(0)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Muat ulang' }))
    expect(fetchDashboard).toHaveBeenCalledTimes(2)
  })
})
