// Smoke test hasil deploy: node scripts/smoke.mjs <URL> [--supabase-url=<url>]
// Memeriksa HTTPS, judul, manifest, ikon PNG, service worker, dan isi bundle. Keluar dengan kode 1 jika ada yang gagal.
const args = process.argv.slice(2)
const base = (args.find((a) => !a.startsWith('--')) ?? '').replace(/\/?$/, '/')
const supabaseUrl = (args.find((a) => a.startsWith('--supabase-url='))?.split('=').slice(1).join('=') ?? process.env.SMOKE_SUPABASE_URL ?? '').trim()
if (!/^https?:\/\//.test(base)) {
  console.error('Pemakaian: node scripts/smoke.mjs https://host/path/ [--supabase-url=https://xxx.supabase.co]')
  process.exit(2)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const url = (p) => new URL(p, base).toString()
async function get(p, retries = 6) {
  let last
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url(p), { redirect: 'follow' })
      if (r.ok || r.status === 404) return r
      last = new Error(`HTTP ${r.status}`)
    } catch (e) {
      last = e
    }
    await new Promise((r) => setTimeout(r, 5000)) // Pages bisa butuh beberapa detik setelah deploy
  }
  throw last
}

check('Alamat memakai HTTPS (wajib untuk kamera dan PWA)', base.startsWith('https://'))

const home = await get('')
const html = await home.text()
check('Halaman utama dapat dibuka (200)', home.status === 200, `status ${home.status}`)
check('Judul halaman memuat WHISTLE', /<title>[^<]*WHISTLE[^<]*<\/title>/i.test(html))
check('Ada tautan manifest', /rel="manifest"/.test(html))
check('Ada meta theme-color', /name="theme-color"/.test(html))

const mres = await get('manifest.webmanifest')
let manifest = null
try { manifest = await mres.json() } catch { /* dicek di bawah */ }
check('manifest.webmanifest dapat dibaca', mres.status === 200 && manifest !== null)
if (manifest) {
  check('Manifest: nama WHISTLE', manifest.name === 'WHISTLE' && manifest.short_name === 'WHISTLE')
  check('Manifest: tagline pada deskripsi', /Smart Stock\. Accurate Value\. Total Control/.test(manifest.description ?? ''))
  check('Manifest: display standalone', manifest.display === 'standalone')
  check('Manifest: start_url dan scope di dalam path aplikasi', typeof manifest.start_url === 'string' && typeof manifest.scope === 'string' && new URL(manifest.start_url, url('manifest.webmanifest')).toString().startsWith(base))
  const icons = manifest.icons ?? []
  const has = (size, purpose) => icons.some((i) => i.sizes === size && i.type === 'image/png' && (purpose ? (i.purpose ?? '').includes(purpose) : true))
  check('Manifest: ikon 192x192 dan 512x512 PNG', has('192x192') && has('512x512'))
  check('Manifest: ikon maskable', has('512x512', 'maskable'))
  const PNG = [0x89, 0x50, 0x4e, 0x47]
  for (const i of icons) {
    const r = await get(new URL(i.src, url('manifest.webmanifest')).toString())
    const b = new Uint8Array(await r.arrayBuffer())
    const ok = r.status === 200 && PNG.every((x, k) => b[k] === x)
    // ukuran sebenarnya dibaca dari header IHDR
    const w = ok ? (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19] : 0
    const h = ok ? (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] : 0
    check(`Ikon ${i.src} adalah PNG ${i.sizes}`, ok && `${w}x${h}` === i.sizes, `${w}x${h}`)
  }
}

const sw = await get('sw.js')
const swText = sw.status === 200 ? await sw.text() : ''
check('Service worker sw.js tersedia', sw.status === 200 && /precacheAndRoute|workbox/.test(swText))
check('Service worker meng-cache app shell (index.html)', /index\.html/.test(swText))
check('Service worker tidak meng-cache API Supabase', !/supabase\.co/.test(swText))

const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1])
check('Halaman memuat skrip bundle', scripts.length > 0)
let bundle = ''
for (const s of scripts) bundle += await (await get(new URL(s, url('')).toString())).text()
if (supabaseUrl) {
  check('Bundle memuat URL Supabase dari Secrets (build tidak kosong)', bundle.includes(new URL(supabaseUrl).host), new URL(supabaseUrl).host)
} else {
  console.log('LEWAT  Pemeriksaan URL Supabase di bundle (tidak diberi --supabase-url)')
}
check('Bundle tidak memuat kata service_role', !/service_role/i.test(bundle))
check('Bundle memuat nama aplikasi dan tagline', bundle.includes('Smart Stock. Accurate Value. Total Control'))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} pemeriksaan lulus`)
process.exit(failed.length ? 1 : 0)
