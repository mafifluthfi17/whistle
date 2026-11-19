// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderUI } from './helpers'

const auth = vi.hoisted(() => ({ value: { role: 'ADMIN' } }))
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => auth.value }))
const svc = vi.hoisted(() => ({
  listProducts: vi.fn(), listCategories: vi.fn(), createProduct: vi.fn(), updateProduct: vi.fn(),
  setProductActive: vi.fn(), deleteProduct: vi.fn(),
}))
vi.mock('../../src/services/products', async (orig) => ({ ...(await orig<typeof import('../../src/services/products')>()), ...svc }))

import MasterBarang from '../../src/pages/MasterBarang'

const prod = (over: Record<string, unknown> = {}) => ({
  id: 'p1', sku: 'SKU-001', barcode: '8991234', product_name: 'Air Mineral 600ml', category: 'Minuman', brand: 'Aqua', unit: 'PCS',
  location: 'A-01', minimum_stock: '12', is_active: true, ...over,
})

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset())
  svc.listProducts.mockResolvedValue({ rows: [prod(), prod({ id: 'p2', sku: 'SKU-002', barcode: null, product_name: 'Teh', category: null, is_active: false })], total: 2 })
  svc.listCategories.mockResolvedValue(['Minuman', 'Snack'])
  auth.value = { role: 'ADMIN' }
})

describe('Master Barang', () => {
  it('daftar tampil; "-" untuk kosong; nonaktif diberi label; jumlah dan halaman', async () => {
    renderUI(<MasterBarang />)
    expect(await screen.findByText('SKU-001')).toBeTruthy()
    expect(screen.getByText('Air Mineral 600ml')).toBeTruthy()
    expect(within(screen.getByText('SKU-002').closest('tr')!).getByText('Nonaktif')).toBeTruthy()
    expect(screen.getByText(/2 barang · halaman 1 dari 1/)).toBeTruthy()
    const row2 = screen.getByText('SKU-002').closest('tr')!
    expect(within(row2).getAllByText('-').length).toBeGreaterThanOrEqual(2)
  })

  it('VIEWER/WAREHOUSE: tidak ada tambah/edit/nonaktifkan/hapus', async () => {
    auth.value = { role: 'VIEWER' }
    renderUI(<MasterBarang />)
    await screen.findByText('SKU-001')
    expect(screen.queryByRole('button', { name: /Tambah Barang/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull()
  })

  it('cari (debounce) dan filter mengirim parameter ke layanan dan kembali ke halaman 1', async () => {
    renderUI(<MasterBarang />)
    const user = userEvent.setup()
    await screen.findByText('SKU-001')
    await user.type(screen.getByLabelText('Cari barang'), 'aqua')
    await waitFor(() => expect(svc.listProducts).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'aqua', page: 1 })), { timeout: 3000 })
    await user.selectOptions(screen.getByLabelText('Filter kategori'), 'Snack')
    await user.selectOptions(screen.getByLabelText('Filter status'), 'inactive')
    await waitFor(() => expect(svc.listProducts).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'Snack', status: 'inactive', search: 'aqua' })))
  })

  it('paginasi: total 45 = 3 halaman; Berikutnya meminta halaman 2', async () => {
    svc.listProducts.mockResolvedValue({ rows: [prod()], total: 45 })
    renderUI(<MasterBarang />)
    const user = userEvent.setup()
    await screen.findByText(/halaman 1 dari 3/)
    expect((screen.getByRole('button', { name: 'Sebelumnya' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Berikutnya' }))
    await waitFor(() => expect(svc.listProducts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 20 })))
    expect(await screen.findByText(/halaman 2 dari 3/)).toBeTruthy()
  })

  it('kosong: pesan tidak ada barang; galat server ditampilkan', async () => {
    svc.listProducts.mockResolvedValueOnce({ rows: [], total: 0 })
    const { unmount } = renderUI(<MasterBarang />)
    expect(await screen.findByText(/Tidak ada barang yang cocok/)).toBeTruthy()
    unmount()
    svc.listProducts.mockRejectedValue(new Error('Koneksi gagal'))
    renderUI(<MasterBarang />)
    expect((await screen.findByRole('alert')).textContent).toBe('Koneksi gagal')
  })

  it('tambah barang: validasi wajib isi, lalu simpan dengan nilai dipangkas dan kosong = null', async () => {
    svc.createProduct.mockResolvedValue(undefined)
    renderUI(<MasterBarang />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Tambah Barang/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Tambah barang' })
    await user.click(within(dlg).getByRole('button', { name: 'Simpan' }))
    expect(within(dlg).getByRole('alert').textContent).toBe('SKU wajib diisi')
    await user.type(within(dlg).getByLabelText(/SKU/), '  NEW-1 ')
    await user.click(within(dlg).getByRole('button', { name: 'Simpan' }))
    expect(within(dlg).getByRole('alert').textContent).toBe('Nama barang wajib diisi')
    await user.type(within(dlg).getByLabelText(/Nama barang/), 'Kopi')
    await user.clear(within(dlg).getByLabelText('Minimum stok'))
    await user.type(within(dlg).getByLabelText('Minimum stok'), '-3')
    await user.click(within(dlg).getByRole('button', { name: 'Simpan' }))
    // validasi bawaan browser (min=0) menahan pengiriman: tidak ada panggilan ke server
    expect(svc.createProduct).not.toHaveBeenCalled()
    await user.clear(within(dlg).getByLabelText('Minimum stok'))
    await user.type(within(dlg).getByLabelText('Minimum stok'), '5')
    await user.type(within(dlg).getByLabelText('Barcode'), '   ')
    await user.click(within(dlg).getByRole('button', { name: 'Simpan' }))
    expect(await screen.findByText('Barang ditambahkan')).toBeTruthy()
    expect(svc.createProduct).toHaveBeenCalledWith({
      sku: 'NEW-1', barcode: null, product_name: 'Kopi', category: null, brand: null, unit: 'PCS', location: null, minimum_stock: 5, is_active: true,
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('SKU/barcode ganda ditolak server: pesan tampil dan formulir tetap terbuka', async () => {
    svc.createProduct.mockRejectedValue(new Error('SKU sudah dipakai barang lain'))
    renderUI(<MasterBarang />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Tambah Barang/ }))
    const dlg = await screen.findByRole('dialog')
    await user.type(within(dlg).getByLabelText(/SKU/), 'SKU-001')
    await user.type(within(dlg).getByLabelText(/Nama barang/), 'Dobel')
    await user.click(within(dlg).getByRole('button', { name: 'Simpan' }))
    expect(await screen.findByText('SKU sudah dipakai barang lain')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('edit: formulir terisi data barang dan memanggil updateProduct dengan id', async () => {
    svc.updateProduct.mockResolvedValue(undefined)
    renderUI(<MasterBarang />)
    const user = userEvent.setup()
    await screen.findByText('SKU-001')
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Edit barang' })
    expect((within(dlg).getByLabelText(/SKU/) as HTMLInputElement).value).toBe('SKU-001')
    expect((within(dlg).getByLabelText('Minimum stok') as HTMLInputElement).value).toBe('12')
    const name = within(dlg).getByLabelText(/Nama barang/)
    await user.clear(name)
    await user.type(name, 'Air Mineral 1L')
    await user.click(within(dlg).getByRole('button', { name: 'Simpan' }))
    expect(await screen.findByText('Barang diperbarui')).toBeTruthy()
    expect(svc.updateProduct).toHaveBeenCalledWith('p1', expect.objectContaining({ sku: 'SKU-001', product_name: 'Air Mineral 1L', minimum_stock: 12 }))
  })

  it('nonaktifkan/aktifkan membalik status; hapus meminta konfirmasi', async () => {
    svc.setProductActive.mockResolvedValue(undefined)
    svc.deleteProduct.mockResolvedValue(undefined)
    renderUI(<MasterBarang />)
    const user = userEvent.setup()
    await screen.findByText('SKU-001')
    await user.click(screen.getByRole('button', { name: 'Nonaktifkan' }))
    expect(svc.setProductActive).toHaveBeenCalledWith('p1', false)
    await user.click(screen.getByRole('button', { name: 'Aktifkan' }))
    expect(svc.setProductActive).toHaveBeenCalledWith('p2', true)

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(screen.getAllByRole('button', { name: 'Hapus' })[0])
    expect(svc.deleteProduct).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await user.click(screen.getAllByRole('button', { name: 'Hapus' })[0])
    expect(svc.deleteProduct).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('SKU-001 dihapus')).toBeTruthy()
    confirm.mockRestore()
  })

  it('hapus barang berhistori ditolak server: pesan galat, tidak ada klaim sukses', async () => {
    svc.deleteProduct.mockRejectedValue(new Error('Barang sudah punya histori transaksi'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderUI(<MasterBarang />)
    await screen.findByText('SKU-001')
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Hapus' })[0])
    expect(await screen.findByText('Barang sudah punya histori transaksi')).toBeTruthy()
    expect(screen.queryByText(/dihapus$/)).toBeNull()
  })
})
