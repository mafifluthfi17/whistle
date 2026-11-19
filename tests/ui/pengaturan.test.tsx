// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderUI, textFile } from './helpers'

const svc = vi.hoisted(() => ({
  createBackup: vi.fn(), getRestorePoint: vi.fn(), listRestorePoints: vi.fn(),
  restoreDatabase: vi.fn(), validateBackup: vi.fn(), verifyIntegrity: vi.fn(),
}))
vi.mock('../../src/services/backup', () => svc)
const download = vi.hoisted(() => vi.fn())
vi.mock('../../src/utils/backupFile', async (orig) => ({ ...(await orig<typeof import('../../src/utils/backupFile')>()), downloadText: download }))

import Pengaturan from '../../src/pages/Pengaturan'

const backupText = (scope = 'FULL') =>
  JSON.stringify({ meta: { format: 'whistle-backup', version: 1, scope, created_at: '2026-11-19T01:00:00Z', note: 'uji', counts: { products: 3, inventory_transactions: 2 } }, tables: {} })

const check = (name: string, ok = true, extra: object = {}) => ({ name, label: name, ok, ...extra })
const okReport = { restorable: true, checks: [check('Checksum tabel'), check('Rantai saldo ledger')], missing_users: 0 }

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset())
  download.mockReset()
  svc.listRestorePoints.mockResolvedValue([])
})

async function pick(content: string, name = 'backup.json') {
  const input = screen.getByLabelText('Pilih file backup') as HTMLInputElement
  fireEvent.change(input, { target: { files: [textFile(content, name)] } })
  await screen.findByText(new RegExp(name.replace('.', '\\.')))
}

describe('Pengaturan: pernyataan jujur tentang backup', () => {
  it('menyatakan backup otomatis Supabase tidak aktif (Free Plan) dan backup Excel bukan pengganti', async () => {
    renderUI(<Pengaturan />)
    expect(screen.getByText(/Free Plan/)).toBeTruthy()
    expect(screen.getByText(/satu-satunya salinan/)).toBeTruthy()
    expect(await screen.findByText(/Belum ada titik pemulihan/)).toBeTruthy()
  })
})

describe('cek integritas', () => {
  it('lulus: tanda hijau; gagal: pesan peringatan dan jumlah masalah', async () => {
    svc.verifyIntegrity.mockResolvedValueOnce({ ok: true, checked_at: '2026-11-19T01:00:00Z', checks: [check('Saldo vs ledger')], counts: { products: 4, transactions: 3, movements: 9, balances: 4 } })
    renderUI(<Pengaturan />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Periksa sekarang' }))
    expect(await screen.findByText(/Integritas SESUAI/)).toBeTruthy()
    expect(screen.getByText(/4 barang · 3 transaksi · 9 mutasi · 4 saldo/)).toBeTruthy()

    svc.verifyIntegrity.mockResolvedValueOnce({ ok: false, checks: [check('Saldo vs ledger', false, { count: 2 })] })
    await user.click(screen.getByRole('button', { name: 'Periksa sekarang' }))
    expect(await screen.findByText(/Ada pemeriksaan yang GAGAL/)).toBeTruthy()
    expect(screen.getByText(/\(2 masalah\)/)).toBeTruthy()
  })

  it('galat jaringan ditampilkan sebagai notifikasi', async () => {
    svc.verifyIntegrity.mockRejectedValue(new Error('Gagal terhubung'))
    renderUI(<Pengaturan />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Periksa sekarang' }))
    expect(await screen.findByText('Gagal terhubung')).toBeTruthy()
  })
})

describe('buat backup', () => {
  it('memanggil RPC dengan lingkup + catatan, mengunduh file, dan menampilkan SHA-256', async () => {
    svc.createBackup.mockResolvedValue(backupText('MASTER'))
    renderUI(<Pengaturan />)
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Jenis backup'), 'MASTER')
    await user.type(screen.getByLabelText(/Catatan/), ' sebelum opname ')
    await user.click(screen.getByRole('button', { name: 'Buat dan unduh backup' }))
    expect(await screen.findByText(/Backup MASTER dibuat dan diunduh/)).toBeTruthy()
    expect(svc.createBackup).toHaveBeenCalledWith('MASTER', 'sebelum opname')
    expect(download).toHaveBeenCalledWith(backupText('MASTER'), expect.stringMatching(/^WHISTLE_Backup_MASTER_\d{4}-\d{2}-\d{2}_\d{4}\.json$/))
    expect(screen.getByText(/SHA-256:/).textContent).toMatch(/[0-9a-f]{64}/)
    expect(screen.getByText(/products 3/)).toBeTruthy()
  })

  it('jenis arsip (TRANSACTIONS) diberi catatan tidak dapat dipulihkan sendiri', async () => {
    renderUI(<Pengaturan />)
    await userEvent.setup().selectOptions(screen.getByLabelText('Jenis backup'), 'TRANSACTIONS')
    expect(screen.getByText(/hanya untuk arsip/)).toBeTruthy()
  })

  it('kegagalan server: notifikasi galat, tidak ada unduhan', async () => {
    svc.createBackup.mockRejectedValue(new Error('Hanya ADMIN'))
    renderUI(<Pengaturan />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Buat dan unduh backup' }))
    expect(await screen.findByText('Hanya ADMIN')).toBeTruthy()
    expect(download).not.toHaveBeenCalled()
  })
})

describe('restore: alur bertahap', () => {
  it('file bukan JSON / bukan backup WHISTLE ditolak di klien tanpa memanggil server', async () => {
    renderUI(<Pengaturan />)
    fireEvent.change(screen.getByLabelText('Pilih file backup'), { target: { files: [textFile('bukan json', 'x.json')] } })
    expect((await screen.findByRole('alert')).textContent).toBe('File bukan JSON yang valid')
    expect(screen.queryByRole('button', { name: 'Validasi file' })).toBeNull()
    expect(svc.validateBackup).not.toHaveBeenCalled()
  })

  it('urutan wajib: pilih -> validasi -> ketik PULIHKAN -> pulihkan; tombol terkunci sebelum frasa tepat', async () => {
    svc.validateBackup.mockResolvedValue(okReport)
    svc.restoreDatabase.mockResolvedValue({
      scope: 'FULL', counts: { products: 3 }, remapped_transactions: 0, restore_point_id: 'abcdef12-0000-0000-0000-000000000000',
      post_check: { ok: true, checks: [check('Integritas pasca-restore')] },
    })
    renderUI(<Pengaturan />)
    const user = userEvent.setup()
    expect(screen.queryByRole('button', { name: 'Pulihkan sekarang' })).toBeNull() // belum ada file
    await pick(backupText())
    expect(screen.getByText(/catatan: uji/)).toBeTruthy()
    expect(screen.getByText(/products 3/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pulihkan sekarang' })).toBeNull() // belum divalidasi

    await user.click(screen.getByRole('button', { name: 'Validasi file' }))
    expect(await screen.findByText(/File lolos validasi/)).toBeTruthy()
    expect(svc.validateBackup).toHaveBeenCalledWith(backupText(), false)
    expect(screen.getByText(/MENGGANTI seluruh data persediaan/)).toBeTruthy()

    const run = screen.getByRole('button', { name: 'Pulihkan sekarang' }) as HTMLButtonElement
    expect(run.disabled).toBe(true)
    const phrase = screen.getByLabelText('Konfirmasi PULIHKAN')
    await user.type(phrase, 'pulihkan') // huruf kecil tidak cukup
    expect(run.disabled).toBe(true)
    await user.clear(phrase)
    await user.type(phrase, 'PULIHKAN')
    expect(run.disabled).toBe(false)
    expect(svc.restoreDatabase).not.toHaveBeenCalled()

    await user.click(run)
    expect(await screen.findByText(/Pemulihan FULL berhasil/)).toBeTruthy()
    expect(svc.restoreDatabase).toHaveBeenCalledWith(backupText(), 'PULIHKAN', false)
    expect(screen.getByText(/abcdef12/)).toBeTruthy()
    expect(screen.getByText('Integritas pasca-restore')).toBeTruthy()
  })

  it('file gagal validasi: tidak ada tombol pulihkan dan penyebab terlihat', async () => {
    svc.validateBackup.mockResolvedValue({ restorable: false, checks: [check('Checksum tabel', false, { count: 1, detail: 'products berbeda' })] })
    renderUI(<Pengaturan />)
    await pick(backupText())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Validasi file' }))
    expect(await screen.findByText(/TIDAK dapat dipulihkan/)).toBeTruthy()
    expect(screen.getByText('products berbeda')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pulihkan sekarang' })).toBeNull()
    expect(screen.queryByLabelText('Konfirmasi PULIHKAN')).toBeNull()
  })

  it('restore MASTER memakai teks yang tidak menakut-nakuti tetapi tetap meminta konfirmasi', async () => {
    svc.validateBackup.mockResolvedValue(okReport)
    renderUI(<Pengaturan />)
    await pick(backupText('MASTER'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Validasi file' }))
    expect(await screen.findByText(/Restore master memperbarui master barang/)).toBeTruthy()
    expect(screen.queryByText(/MENGGANTI seluruh/)).toBeNull()
    expect(screen.getByLabelText('Konfirmasi PULIHKAN')).toBeTruthy()
  })

  it('server menolak saat memulihkan: pesan "data tidak berubah" dan hasil sukses tidak muncul', async () => {
    svc.validateBackup.mockResolvedValue(okReport)
    svc.restoreDatabase.mockRejectedValue(new Error('Integritas pasca-restore gagal: saldo tidak cocok'))
    renderUI(<Pengaturan />)
    const user = userEvent.setup()
    await pick(backupText())
    await user.click(screen.getByRole('button', { name: 'Validasi file' }))
    await user.type(await screen.findByLabelText('Konfirmasi PULIHKAN'), 'PULIHKAN')
    await user.click(screen.getByRole('button', { name: 'Pulihkan sekarang' }))
    const alert = await screen.findByText(/Pemulihan dibatalkan dan data tidak berubah/)
    expect(alert.textContent).toMatch(/saldo tidak cocok/)
    expect(screen.queryByText(/Pemulihan FULL berhasil/)).toBeNull()
  })

  it('pengguna pembuat tidak ada: opsi pemetaan memicu validasi ulang dan diteruskan ke restore', async () => {
    svc.validateBackup
      .mockResolvedValueOnce({ restorable: false, checks: [check('Pengguna', false)], missing_users: 2 })
      .mockResolvedValueOnce({ ...okReport, missing_users: 2 })
    svc.restoreDatabase.mockResolvedValue({ scope: 'FULL', counts: { products: 3 }, remapped_transactions: 5, restore_point_id: '11111111-aaaa', post_check: { ok: true, checks: [] } })
    renderUI(<Pengaturan />)
    const user = userEvent.setup()
    await pick(backupText())
    await user.click(screen.getByRole('button', { name: 'Validasi file' }))
    await user.click(await screen.findByRole('checkbox'))
    await waitFor(() => expect(svc.validateBackup).toHaveBeenLastCalledWith(backupText(), true))
    await user.type(await screen.findByLabelText('Konfirmasi PULIHKAN'), 'PULIHKAN')
    await user.click(screen.getByRole('button', { name: 'Pulihkan sekarang' }))
    expect(await screen.findByText(/5 transaksi dipetakan ke ADMIN/)).toBeTruthy()
    expect(svc.restoreDatabase).toHaveBeenCalledWith(backupText(), 'PULIHKAN', true)
  })

  it('memilih file lain mengosongkan hasil validasi sebelumnya', async () => {
    svc.validateBackup.mockResolvedValue(okReport)
    renderUI(<Pengaturan />)
    await pick(backupText(), 'a.json')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Validasi file' }))
    await screen.findByText(/File lolos validasi/)
    fireEvent.change(screen.getByLabelText('Pilih file backup'), { target: { files: [textFile(backupText(), 'b.json')] } })
    await screen.findByText(/b\.json/)
    expect(screen.queryByText(/File lolos validasi/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pulihkan sekarang' })).toBeNull()
  })
})

describe('titik pemulihan', () => {
  it('menampilkan daftar dan mengunduh titik tertentu', async () => {
    svc.listRestorePoints.mockResolvedValue([
      { id: 'rp1', created_at: '2026-11-19T01:02:03+00:00', created_by_name: 'Admin', size_bytes: 2048, reason: 'sebelum restore FULL', counts: { products: 3, inventory_transactions: 2, other: 1 } },
    ])
    svc.getRestorePoint.mockResolvedValue('{"isi":1}')
    renderUI(<Pengaturan />)
    const user = userEvent.setup()
    expect(await screen.findByText(/sebelum restore FULL/)).toBeTruthy()
    expect(screen.getByText(/products 3 · inventory_transactions 2/)).toBeTruthy()
    expect(screen.queryByText(/other 1/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Unduh' }))
    expect(await screen.findByText(/Titik pemulihan diunduh/)).toBeTruthy()
    expect(svc.getRestorePoint).toHaveBeenCalledWith('rp1')
    expect(download).toHaveBeenCalledWith('{"isi":1}', 'WHISTLE_Titik_Pemulihan_2026-11-19-01-02-03.json')
  })
})
