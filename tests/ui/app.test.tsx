// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderUI, setOnline } from './helpers'

const auth = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  signIn: vi.fn(),
  signOut: vi.fn(),
}))
const sync = vi.hoisted(() => ({ counts: { PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0 }, syncing: false }))
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => auth.value }))
vi.mock('../../src/hooks/useSync', () => ({ useSync: () => sync }))
// Halaman berat diganti penanda; yang diuji di sini hanya gerbang akses dan navigasi.
for (const [file, label] of [
  ['MasterBarang', 'HALAMAN-MASTER'], ['Dashboard', 'HALAMAN-DASHBOARD'], ['KartuStok', 'HALAMAN-KARTU'], ['Laporan', 'HALAMAN-LAPORAN'],
  ['Antrean', 'HALAMAN-ANTREAN'], ['Pengaturan', 'HALAMAN-PENGATURAN'], ['AuditTrail', 'HALAMAN-AUDIT'], ['ImportExport', 'HALAMAN-IMPORT'],
  ['TransactionPage', 'HALAMAN-TRANSAKSI'],
] as const) {
  vi.doMock(`../../src/pages/${file}`, () => ({ default: () => <div>{label}</div> }))
}

import { NAV, navFor } from '../../src/components/Layout'

const base = { loading: false, signedIn: true, isActive: true, role: 'ADMIN', fullName: 'Budi', configured: true, signIn: auth.signIn, signOut: auth.signOut }

async function loadApp() {
  vi.resetModules()
  return (await import('../../src/App')).default
}

beforeEach(() => {
  auth.signIn.mockReset()
  auth.signOut.mockReset().mockResolvedValue(undefined)
  auth.value = { ...base }
  sync.counts = { PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0 }
  window.location.hash = ''
  setOnline(true)
})

describe('menu menurut role (Bagian 19)', () => {
  const ids = (r: 'ADMIN' | 'WAREHOUSE' | 'VIEWER') => navFor(r).map((n) => n.id)
  it('ADMIN melihat semua menu', () => expect(ids('ADMIN')).toEqual(NAV.map((n) => n.id)))
  it('WAREHOUSE: transaksi dan antrean, tanpa import/audit/pengaturan', () => {
    expect(ids('WAREHOUSE')).toEqual(['dashboard', 'master', 'masuk', 'keluar', 'antrean', 'kartu', 'laporan'])
  })
  it('VIEWER: hanya baca', () => expect(ids('VIEWER')).toEqual(['dashboard', 'master', 'kartu', 'laporan']))
  it('tanpa role tidak ada menu', () => expect(navFor(null)).toEqual([]))
})

describe('gerbang akses App', () => {
  it('memuat: tampil "Memuat…" dengan nama aplikasi', async () => {
    auth.value = { ...base, loading: true }
    const App = await loadApp()
    renderUI(<App />)
    expect(screen.getByText('Memuat…')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'WHISTLE' })).toBeTruthy()
  })

  it('belum masuk: layar login memuat nama, kepanjangan, dan tagline', async () => {
    auth.value = { ...base, signedIn: false }
    const App = await loadApp()
    renderUI(<App />)
    expect(screen.getByRole('heading', { name: 'WHISTLE' })).toBeTruthy()
    expect(screen.getByText('Warehouse Inventory, Stock Tracking & Ledger Engine')).toBeTruthy()
    expect(screen.getByText('Smart Stock. Accurate Value. Total Control')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeTruthy()
  })

  it('akun dinonaktifkan: ditolak dengan pesan, tombol keluar berfungsi', async () => {
    auth.value = { ...base, isActive: false }
    const App = await loadApp()
    renderUI(<App />)
    expect(screen.getByText(/dinonaktifkan/)).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Keluar' }))
    expect(auth.signOut).toHaveBeenCalledTimes(1)
  })

  it('akun tanpa role: ditolak', async () => {
    auth.value = { ...base, role: null }
    const App = await loadApp()
    renderUI(<App />)
    expect(screen.getByText(/belum memiliki role/)).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('halaman awal = menu pertama; navigasi mengganti halaman', async () => {
    const App = await loadApp()
    renderUI(<App />)
    expect(await screen.findByText('HALAMAN-DASHBOARD')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Audit Trail' }))
    expect(await screen.findByText('HALAMAN-AUDIT')).toBeTruthy()
    expect(window.location.hash).toMatch(/audit/)
  })

  it('VIEWER yang membuka rute ADMIN (#/audit) dialihkan ke menu pertamanya', async () => {
    auth.value = { ...base, role: 'VIEWER' }
    window.location.hash = '#/audit'
    const App = await loadApp()
    renderUI(<App />)
    expect(await screen.findByText('HALAMAN-DASHBOARD')).toBeTruthy()
    expect(screen.queryByText('HALAMAN-AUDIT')).toBeNull()
    const labels = screen.getAllByRole('button').map((b) => b.textContent)
    expect(labels).not.toContain('Audit Trail')
    expect(labels).not.toContain('Pengaturan')
    expect(labels).not.toContain('Barang Masuk')
  })

  it('WAREHOUSE tidak melihat Import/Export tetapi melihat Barang Masuk', async () => {
    auth.value = { ...base, role: 'WAREHOUSE' }
    const App = await loadApp()
    renderUI(<App />)
    await screen.findByText('HALAMAN-DASHBOARD')
    const labels = screen.getAllByRole('button').map((b) => b.textContent)
    expect(labels).toContain('Barang Masuk')
    expect(labels).not.toContain('Import/Export')
  })

  it('Import/Export (lazy) terbuka untuk ADMIN', async () => {
    window.location.hash = '#/import'
    const App = await loadApp()
    renderUI(<App />)
    expect(await screen.findByText('HALAMAN-IMPORT', {}, { timeout: 5000 })).toBeTruthy()
  })
})

describe('header: status koneksi, sinkronisasi, logout', () => {
  it('Online/Offline mengikuti jaringan; badge antrean dan "perlu tindakan"', async () => {
    sync.counts = { PENDING: 2, SYNCING: 0, SYNCED: 0, FAILED: 1, CONFLICT: 1 }
    const App = await loadApp()
    renderUI(<App />)
    expect(await screen.findByText('Online')).toBeTruthy()
    expect(screen.getByText('2 perlu tindakan')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Antrean Offline/ }).textContent).toContain('4')
    setOnline(false)
    await waitFor(() => expect(screen.getByText('Offline')).toBeTruthy())
  })

  it('logout dengan antrean tersisa meminta konfirmasi; batal = tetap masuk', async () => {
    sync.counts = { PENDING: 3, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0 }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const App = await loadApp()
    renderUI(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Keluar' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('3 transaksi offline'))
    expect(auth.signOut).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Keluar' }))
    expect(auth.signOut).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })

  it('logout tanpa antrean langsung keluar tanpa konfirmasi', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const App = await loadApp()
    renderUI(<App />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Keluar' }))
    expect(confirm).not.toHaveBeenCalled()
    expect(auth.signOut).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })
})

describe('layar login', () => {
  it('kredensial dikirim (email dipangkas); galat ditampilkan; tombol nonaktif bila belum dikonfigurasi', async () => {
    auth.value = { ...base, signedIn: false }
    auth.signIn.mockResolvedValue('Email atau password salah')
    const App = await loadApp()
    const { unmount } = renderUI(<App />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), '  a@b.co ')
    await user.type(screen.getByLabelText('Password'), 'rahasia')
    await user.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(auth.signIn).toHaveBeenCalledWith('a@b.co', 'rahasia')
    expect((await screen.findByRole('alert')).textContent).toBe('Email atau password salah')
    unmount()

    auth.value = { ...base, signedIn: false, configured: false }
    const App2 = await loadApp()
    renderUI(<App2 />)
    expect((screen.getByRole('button', { name: 'Masuk' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Supabase belum dikonfigurasi/)).toBeTruthy()
  })
})
