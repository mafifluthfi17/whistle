// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UUID, renderUI, setOnline } from './helpers'

const auth = vi.hoisted(() => ({ value: { role: 'WAREHOUSE', userId: 'user-1' } }))
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => auth.value }))
vi.mock('../../src/hooks/useSync', () => ({
  useSync: () => ({ cachedAt: '2026-11-19T01:00:00Z', counts: { PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0 }, syncing: false }),
}))

const remote = vi.hoisted(() => ({
  searchProducts: vi.fn(),
  findProductByScan: vi.fn(),
  fetchStock: vi.fn(),
  postTransaction: vi.fn(),
  fetchAllStocked: vi.fn(),
}))
vi.mock('../../src/services/transactions', async (orig) => ({ ...(await orig<typeof import('../../src/services/transactions')>()), ...remote }))

import TransactionPage from '../../src/pages/TransactionPage'
import { db } from '../../src/database/db'
import { localCache, outbox } from '../../src/services/catalog'
import { PostFailure, type StockedProduct } from '../../src/services/transactions'

const product = (over: Partial<StockedProduct> = {}): StockedProduct => ({
  id: 'p1', sku: 'SKU-1', barcode: '8999', product_name: 'Air Mineral', category: 'Minuman', unit: 'PCS', is_active: true,
  quantity: '10', average_cost: '10000', inventory_value: '100000', ...over,
})

const posted = (n = 'IN-261119-000001') => ({
  transaction_id: 't1', transaction_number: n, type: 'IN', status: 'POSTED', posting_sequence: 7, duplicate: false,
  items: [{ sku: 'SKU-1', quantity: '50.0000', unit_cost: '12000.000000', total_value: '600000.00', average_cost_before: '10000.000000', average_cost_after: '10666.666667', balance_quantity: '150.0000', balance_value: '1600000.00' }],
})

beforeEach(async () => {
  Object.values(remote).forEach((m) => m.mockReset())
  remote.searchProducts.mockResolvedValue([product()])
  remote.fetchStock.mockImplementation(async (skus: string[]) => new Map(skus.map((s) => [s, product({ sku: s })])))
  await db.outbox.clear()
  await localCache.clear()
  auth.value = { role: 'WAREHOUSE', userId: 'user-1' }
  setOnline(true)
})

/** Cari barang dan tambahkan ke dokumen. */
async function addItem(user: ReturnType<typeof userEvent.setup>, term = 'air') {
  await user.type(screen.getByLabelText(/Tambah barang/), term)
  await user.click(await screen.findByRole('button', { name: /SKU-1/ }, { timeout: 3000 }))
}

describe('Barang Masuk: alur online', () => {
  it('cari -> isi -> pratinjau (perkiraan) -> posting -> hasil resmi dari server', async () => {
    remote.postTransaction.mockResolvedValue(posted())
    const user = userEvent.setup()
    renderUI(<TransactionPage type="IN" />)
    await user.type(screen.getByLabelText('No. dokumen'), 'PO-1')
    await user.type(screen.getByLabelText('Supplier'), 'PT Pemasok')
    await addItem(user)
    await user.type(screen.getByLabelText(/Quantity/), '50')
    await user.type(screen.getByLabelText(/Harga beli per unit/), '12000')
    await user.click(screen.getByRole('button', { name: 'Pratinjau' }))

    expect(await screen.findByRole('heading', { name: 'Pratinjau Barang Masuk' })).toBeTruthy()
    expect(screen.getAllByText(/600\.000/).length).toBeGreaterThan(0) // perkiraan 50 x 12.000
    expect(screen.getByText(/hanya perkiraan/i)).toBeTruthy()
    expect(remote.postTransaction).not.toHaveBeenCalled() // belum diposting

    await user.click(screen.getByRole('button', { name: /Posting Barang Masuk/ }))
    expect(await screen.findByText(/berhasil diposting/i)).toBeTruthy()
    expect(remote.postTransaction).toHaveBeenCalledTimes(1)
    expect(remote.postTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'IN', reference: 'PO-1', party: 'PT Pemasok', allowBackdate: false,
        clientTransactionId: expect.stringMatching(UUID),
        items: [{ sku: 'SKU-1', quantity: '50', unit_cost: '12000' }],
      }),
    )
    // angka resmi tampil dari server
    expect(screen.getByText('IN-261119-000001')).toBeTruthy()
    expect(screen.getAllByText(/10\.666,666667/).length).toBeGreaterThan(0)
    expect(await db.outbox.count()).toBe(0) // tidak masuk antrean
  })

  it('validasi: dokumen kosong dan angka tidak valid ditandai, tidak ada yang dikirim', async () => {
    const user = userEvent.setup()
    renderUI(<TransactionPage type="IN" />)
    await user.click(screen.getByRole('button', { name: 'Pratinjau' }))
    expect((await screen.findAllByRole('alert')).some((a) => /minimal satu barang/i.test(a.textContent ?? ''))).toBe(true)

    await addItem(user)
    await user.type(screen.getByLabelText(/Quantity/), '1.00001')
    await user.click(screen.getByRole('button', { name: 'Pratinjau' }))
    expect(await screen.findByText(/maksimal 4/)).toBeTruthy()
    expect(screen.getByText(/Harga beli wajib/)).toBeTruthy()
    expect(remote.postTransaction).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: /Pratinjau Barang/ })).toBeNull()
  })

  it('SKU yang sama tidak ditambahkan dua kali', async () => {
    const user = userEvent.setup()
    renderUI(<TransactionPage type="IN" />)
    await addItem(user)
    await user.type(screen.getByLabelText(/Tambah barang/), 'air')
    await user.click(await screen.findByRole('button', { name: /SKU-1/ }))
    expect(await screen.findByText(/sudah ada di daftar/)).toBeTruthy()
    expect(screen.getAllByLabelText(/Quantity/)).toHaveLength(1)
  })

  it('"Transaksi baru" mengosongkan form dan memakai kunci idempotensi baru', async () => {
    remote.postTransaction.mockResolvedValue(posted())
    const user = userEvent.setup()
    renderUI(<TransactionPage type="IN" />)
    const post = async () => {
      await addItem(user)
      await user.type(screen.getByLabelText(/Quantity/), '5')
      await user.type(screen.getByLabelText(/Harga beli per unit/), '100')
      await user.click(screen.getByRole('button', { name: 'Pratinjau' }))
      await user.click(await screen.findByRole('button', { name: /Posting Barang Masuk/ }))
      await screen.findByText(/berhasil diposting/i)
    }
    await post()
    await user.click(screen.getByRole('button', { name: 'Transaksi baru' }))
    await post()
    const ids = remote.postTransaction.mock.calls.map((c) => c[0].clientTransactionId)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})

describe('Barang Keluar: stok dan penolakan', () => {
  it('melebihi stok tersedia (data server) diblokir sebelum posting', async () => {
    const user = userEvent.setup()
    renderUI(<TransactionPage type="OUT" />)
    await addItem(user)
    expect(screen.getByText(/Stok tersedia:/).textContent).toMatch(/10/)
    expect(screen.getByText(/Average cost:/).textContent).toMatch(/10\.000/)
    await user.type(screen.getByLabelText(/Quantity/), '11')
    await user.click(screen.getByRole('button', { name: 'Pratinjau' }))
    expect(await screen.findByText(/Melebihi stok tersedia \(10\)/)).toBeTruthy()
    expect(await screen.findByText(/Stok tidak mencukupi untuk sebagian barang/)).toBeTruthy() // notifikasi
    expect(remote.postTransaction).not.toHaveBeenCalled()
  })

  it('server menolak "stok tidak mencukupi": notifikasi jelas, kembali ke form, tidak masuk antrean', async () => {
    remote.postTransaction.mockRejectedValue(new PostFailure({ kind: 'insufficient', message: 'Stok tidak mencukupi untuk SKU SKU-1: tersedia 5.0000, diminta 8' }))
    const user = userEvent.setup()
    renderUI(<TransactionPage type="OUT" />)
    await addItem(user)
    await user.type(screen.getByLabelText(/Quantity/), '8')
    await user.click(screen.getByRole('button', { name: 'Pratinjau' }))
    await user.click(await screen.findByRole('button', { name: /Posting Barang Keluar/ }))
    expect(await screen.findByText(/tersedia 5\.0000, diminta 8/)).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Pratinjau' })).toBeTruthy() // kembali ke form
    expect(await db.outbox.count()).toBe(0)
  })

  it('SKU tidak ditemukan saat mengetik manual memberi notifikasi', async () => {
    remote.findProductByScan.mockResolvedValue({ kind: 'none', scanned: 'ZZZ' })
    const user = userEvent.setup()
    renderUI(<TransactionPage type="OUT" />)
    await user.type(screen.getByLabelText(/Tambah barang/), 'ZZZ{Enter}')
    expect(await screen.findByText(/"ZZZ" tidak ditemukan/)).toBeTruthy()
  })
})

describe('mode offline dan antrean', () => {
  it('offline: dokumen masuk antrean PENDING (belum resmi), tidak memanggil server', async () => {
    await localCache.replaceAll(
      [{ sku: 'SKU-1', barcode: '8999', name: 'Air Mineral', category: null, unit: 'PCS', active: true }],
      [{ sku: 'SKU-1', qty: '10', averageCost: '10000', value: '100000', updatedAt: '2026-11-19T00:00:00Z' }],
    )
    setOnline(false)
    const user = userEvent.setup()
    renderUI(<TransactionPage type="IN" />)
    expect(screen.getByText(/Mode offline/)).toBeTruthy()
    await addItem(user)
    await user.type(screen.getByLabelText(/Quantity/), '5')
    await user.type(screen.getByLabelText(/Harga beli per unit/), '100')
    await user.click(screen.getByRole('button', { name: 'Pratinjau' }))
    await user.click(await screen.findByRole('button', { name: /Posting Barang Masuk/ }))

    expect(await screen.findByText(/tersimpan di antrean offline/)).toBeTruthy()
    expect(screen.getAllByText(/belum/i).length).toBeGreaterThan(0)
    expect(remote.postTransaction).not.toHaveBeenCalled()
    expect(remote.searchProducts).not.toHaveBeenCalled() // pencarian dari cache
    const q = await outbox.listAll()
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ userId: 'user-1', type: 'IN', status: 'PENDING', skus: ['SKU-1'] })
    expect(q[0].payload.items).toEqual([{ sku: 'SKU-1', quantity: '5', unit_cost: '100' }])
    expect(q[0].clientTransactionId).toMatch(UUID)
  })

  it('jaringan putus saat mengirim: diantre dengan client_transaction_id yang SAMA dengan percobaan online', async () => {
    remote.postTransaction.mockRejectedValue(new PostFailure({ kind: 'offline', message: 'Failed to fetch' }))
    const user = userEvent.setup()
    renderUI(<TransactionPage type="IN" />)
    await addItem(user)
    await user.type(screen.getByLabelText(/Quantity/), '2')
    await user.type(screen.getByLabelText(/Harga beli per unit/), '50')
    await user.click(screen.getByRole('button', { name: 'Pratinjau' }))
    await user.click(await screen.findByRole('button', { name: /Posting Barang Masuk/ }))
    expect(await screen.findByText(/tersimpan di antrean offline/)).toBeTruthy()
    const attempted = remote.postTransaction.mock.calls[0][0].clientTransactionId
    const q = await outbox.listAll()
    expect(q).toHaveLength(1)
    expect(q[0].clientTransactionId).toBe(attempted) // retry nanti idempoten (server mungkin sudah memproses)
  })

  it('masih ada antrean untuk SKU yang sama: dokumen baru ikut antrean agar urutan terjaga', async () => {
    await outbox.enqueue({
      userId: 'user-1', type: 'IN',
      payload: { dateIso: new Date().toISOString(), dateInput: '2026-11-19', reference: 'LAMA', party: '', notes: '', items: [{ sku: 'SKU-1', quantity: '4', unit_cost: '10' }], allowBackdate: false, names: { 'SKU-1': { name: 'Air', unit: 'PCS' } } },
    })
    const user = userEvent.setup()
    renderUI(<TransactionPage type="OUT" />)
    await addItem(user)
    await user.type(screen.getByLabelText(/Quantity/), '12') // stok server 10 + antrean masuk 4 = 14 (proyeksi)
    await user.click(screen.getByRole('button', { name: 'Pratinjau' }))
    await user.click(await screen.findByRole('button', { name: /Posting Barang Keluar/ }))
    expect(await screen.findByText(/tersimpan di antrean offline/)).toBeTruthy()
    expect(remote.postTransaction).not.toHaveBeenCalled()
    expect(await db.outbox.count()).toBe(2)
  })

  it('offline: stok kurang menurut cache hanya peringatan, transaksi tetap dapat disimpan (server yang memutuskan)', async () => {
    await localCache.replaceAll(
      [{ sku: 'SKU-1', barcode: null, name: 'Air Mineral', category: null, unit: 'PCS', active: true }],
      [{ sku: 'SKU-1', qty: '3', averageCost: '100', value: '300', updatedAt: '2026-11-19T00:00:00Z' }],
    )
    setOnline(false)
    const user = userEvent.setup()
    renderUI(<TransactionPage type="OUT" />)
    await addItem(user)
    await user.type(screen.getByLabelText(/Quantity/), '8')
    await user.click(screen.getByRole('button', { name: 'Pratinjau' }))
    expect(await screen.findByRole('heading', { name: 'Pratinjau Barang Keluar' })).toBeTruthy() // tidak diblokir
    expect(await screen.findByText(/server akan memvalidasi saat sinkronisasi/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Posting Barang Keluar/ }))
    expect(await screen.findByText(/tersimpan di antrean offline/)).toBeTruthy()
    expect((await outbox.listAll())[0].payload.items).toEqual([{ sku: 'SKU-1', quantity: '8' }])
  })

  it('tanggal mundur: kotak persetujuan hanya untuk ADMIN', async () => {
    const user = userEvent.setup()
    const { unmount } = renderUI(<TransactionPage type="IN" />)
    const dateInput = screen.getByLabelText('Tanggal') as HTMLInputElement
    await user.clear(dateInput)
    await user.type(dateInput, '2020-01-15')
    expect(await screen.findByText(/perlu persetujuan ADMIN/)).toBeTruthy()
    expect(screen.queryByLabelText(/menyetujui transaksi bertanggal mundur/)).toBeNull()
    unmount()

    auth.value = { role: 'ADMIN', userId: 'admin-1' }
    renderUI(<TransactionPage type="IN" />)
    const d2 = screen.getByLabelText('Tanggal') as HTMLInputElement
    await user.clear(d2)
    await user.type(d2, '2020-01-15')
    expect(await screen.findByLabelText(/menyetujui transaksi bertanggal mundur/)).toBeTruthy()
  })
})

describe('daftar barang di dokumen', () => {
  it('hapus baris mengosongkan dokumen', async () => {
    const user = userEvent.setup()
    renderUI(<TransactionPage type="IN" />)
    await addItem(user)
    const card = screen.getByText('SKU-1').closest('div')!.parentElement!.parentElement!
    await user.click(within(card).getByRole('button', { name: 'Hapus' }))
    expect(screen.queryByLabelText(/Quantity/)).toBeNull()
    expect(screen.getByText(/Belum ada barang/)).toBeTruthy()
  })
})
