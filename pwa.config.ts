import type { VitePWAOptions } from 'vite-plugin-pwa'

/**
 * Konfigurasi PWA. Service worker HANYA men-cache application shell dan aset (JS, CSS, HTML, ikon,
 * manifest) agar aplikasi dapat dibuka saat offline. Service worker bukan database transaksi:
 * tidak ada runtimeCaching, sehingga panggilan ke Supabase tidak pernah disimpan atau disajikan dari cache.
 * Data offline ada di IndexedDB (Dexie), bukan di Cache Storage.
 */
export function pwaOptions(base: string): Partial<VitePWAOptions> {
  return {
    registerType: 'autoUpdate',
    includeAssets: ['icon.svg'],
    manifest: {
      name: 'WHISTLE',
      short_name: 'WHISTLE',
      description: 'Smart Stock. Accurate Value. Total Control',
      lang: 'id',
      start_url: base,
      scope: base,
      display: 'standalone',
      background_color: '#0f172a',
      theme_color: '#0f172a',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
      // buka halaman mana pun saat offline dengan memuat app shell
      navigateFallback: `${base}index.html`,
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
    },
  }
}
