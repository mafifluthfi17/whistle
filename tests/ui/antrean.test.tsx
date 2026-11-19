// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderUI, setOnline } from './helpers'

const auth = vi.hoisted(() => ({ value: { role: 'WAREHOUSE', userId: 'user-1' } }))
const syncNow = vi.hoisted(() => vi.fn())
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => auth.value }))
vi.mock('../../src/hooks/useSync', () => ({
  useSync: () => ({ syncNow, syncing: false, lastSyncAt: null, cachedAt: '2026-11-19T01:00:00Z', cacheCount: 1234, refreshCatalog: vi.fn(), othersOpen: 2 }),
}))

import Antrean from '../../src/pages/Antrean'
import { db } from '../../src/database/db'
import { outbox } from '../../src/services/catalog'

const payload = (over: Record<string, unknown> = {}) => ({
  dateIso: '2026-11-19T03:00:00.000Z', dateInput: '2026-11-19', reference: 'PO-9', party: 'PT A', notes: '',
  items: [{ sku: 'SKU-1', quantity: '5', unit_cost: '100' }], allowBackdate: false,
  names: { 'SKU-1': { name: 'Air Mineral', unit: 'PCS' } }, ...over,
})

async function seed(type: 'IN' | 'OUT' = 'IN', userId = 'user-1', over: Record<string, unknown> = {}) {
  return outbox.enqueue({ userId, type, payload: payload(type === 'OUT' ? { items: [{ sku: 'SKU-1', quantity: '5' }] } : over) as never })
}

beforeEach(async () => {
  await db.outbox.clear()
  syncNow.mockReset()
  auth.value = { role: 'WAREHOUSE', userId: 'user-1' }
  setOnline(true)
})

describe('Antrean Offline', () => {
  it('kosong: pesan semua tersinkron; info cache dan catatan tidak dijamin', async () => {
    renderUI(<Antrean />)
    expect(await screen.findByText(/Tidak ada transaksi menunggu/)).toBeTruthy()
    expect(screen.getByText(/1\.234 barang/)).toBeTruthy()
    expect(screen.getByText(/tidak dijamin berhasil/)).toBeTruthy()
    expect(screen.getByText(/2 transaksi milik pengguna lain/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Sinkronkan sekarang' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('PENDING tampil sebagai belum resmi dengan tombol Batalkan; hanya milik pengguna ini', async () => {
    await seed('IN')
    await seed('IN', 'user-lain', { reference: 'MILIK-LAIN' })
    renderUI(<Antrean />)
    expect(await screen.findByText(/Barang Masuk · PO-9/)).toBeTruthy()
    expect(screen.queryByText(/MILIK-LAIN/)).toBeNull()
    expect(screen.getByText('PENDING')).toBeTruthy()
    expect(screen.getByText(/belum menjadi transaksi resmi dan belum mengubah saldo/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Perbaiki' })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sinkronkan sekarang' }))
    expect(syncNow).toHaveBeenCalledTimes(1)
  })

  it('tombol sinkronisasi nonaktif saat offline', async () => {
    await seed('IN')
    setOnline(false)
    renderUI(<Antrean />)
    await screen.findByText(/PO-9/)
    expect((screen.getByRole('button', { name: 'Sinkronkan sekarang' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Perbarui data barang' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('batalkan: konfirmasi ditolak = data tetap; diterima = data lokal dihapus', async () => {
    const t = await seed('IN')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderUI(<Antrean />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Batalkan' }))
    expect(await outbox.get(t.id)).toBeTruthy()
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Batalkan' }))
    await waitFor(async () => expect(await db.outbox.count()).toBe(0))
    expect(await screen.findByText(/dibatalkan dari antrean/)).toBeTruthy()
    confirm.mockRestore()
  })

  it('batalkan transaksi yang pernah dicoba kirim memberi peringatan mungkin sudah diposting', async () => {
    const t = await seed('IN')
    await outbox.markSyncing(t.id)
    await outbox.markPending(t.id, 'Failed to fetch')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderUI(<Antrean />)
    expect(await screen.findByText(/Percobaan terakhir: Failed to fetch/)).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Batalkan' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('mungkin sudah diposting'))
    confirm.mockRestore()
  })

  it('FAILED: penyebab tampil, Perbaiki -> ubah qty -> simpan -> kembali PENDING dengan data baru', async () => {
    const t = await seed('IN')
    await outbox.markSyncing(t.id)
    await outbox.markRejected(t.id, 'FAILED', 'validation', 'Harga beli tidak valid')
    renderUI(<Antrean />)
    const user = userEvent.setup()
    expect((await screen.findByRole('alert')).textContent).toContain('Harga beli tidak valid')
    await user.click(screen.getByRole('button', { name: 'Perbaiki' }))
    const dialog = await screen.findByRole('dialog', { name: 'Perbaiki transaksi' })
    const qty = within(dialog).getByLabelText('Quantity')
    await user.clear(qty)
    await user.type(qty, '7')
    await user.click(within(dialog).getByRole('button', { name: 'Simpan perbaikan' }))
    expect(await screen.findByText(/Perbaikan disimpan/)).toBeTruthy()
    await waitFor(async () => {
      const row = (await db.outbox.toArray())[0]
      expect(row.status).toBe('PENDING')
      expect(row.payload.items[0].quantity).toBe('7')
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('perbaikan dengan angka tidak valid ditolak dan data tidak berubah', async () => {
    const t = await seed('IN')
    await outbox.markSyncing(t.id)
    await outbox.markRejected(t.id, 'CONFLICT', 'insufficient', 'Stok tidak mencukupi')
    renderUI(<Antrean />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Perbaiki' }))
    const dialog = await screen.findByRole('dialog')
    const qty = within(dialog).getByLabelText('Quantity')
    await user.clear(qty)
    await user.type(qty, '1.23456')
    await user.click(within(dialog).getByRole('button', { name: 'Simpan perbaikan' }))
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/4/)
    expect((await db.outbox.toArray())[0].status).toBe('CONFLICT')
    expect((await db.outbox.toArray())[0].payload.items[0].quantity).toBe('5')
    await user.click(within(dialog).getByRole('button', { name: 'Tutup' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('persetujuan tanggal mundur di dialog Perbaiki hanya muncul untuk ADMIN', async () => {
    const t = await seed('IN')
    await outbox.markSyncing(t.id)
    await outbox.markRejected(t.id, 'FAILED', 'backdated', 'Transaksi bertanggal mundur perlu persetujuan ADMIN')
    const { unmount } = renderUI(<Antrean />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Perbaiki' }))
    expect(screen.queryByLabelText(/menyetujui transaksi bertanggal mundur/)).toBeNull()
    unmount()
    auth.value = { role: 'ADMIN', userId: 'user-1' }
    renderUI(<Antrean />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Perbaiki' }))
    expect(await screen.findByLabelText(/menyetujui transaksi bertanggal mundur/)).toBeTruthy()
  })

  it('SYNCING tidak dapat dibatalkan; SYNCED muncul di riwayat dengan nomor transaksi', async () => {
    const a = await seed('IN')
    await outbox.markSyncing(a.id)
    const b = await seed('OUT')
    await outbox.markSyncing(b.id)
    await outbox.markSynced(b.id, { transaction_id: 'x', transaction_number: 'OUT-261119-000003', type: 'OUT', status: 'POSTED', posting_sequence: 3, duplicate: false, items: [] } as never)
    renderUI(<Antrean />)
    expect(await screen.findByText('SYNCING')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Batalkan' })).toBeNull()
    expect(screen.getByText('OUT-261119-000003')).toBeTruthy()
    expect(screen.getByText(/Sudah tersinkron \(20 terakhir/)).toBeTruthy()
  })

  it('transaksi ditahan menampilkan alasan urutan', async () => {
    const t = await seed('IN')
    await outbox.setBlockedBy(t.id, 'id-sebelumnya')
    renderUI(<Antrean />)
    expect(await screen.findByText(/Ditahan karena transaksi sebelumnya/)).toBeTruthy()
  })
})
