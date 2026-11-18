# WHISTLE

**Warehouse Inventory, Stock Tracking & Ledger Engine**

*Smart Stock. Accurate Value. Total Control*

Aplikasi inventori gudang hybrid cloud-local (PWA Android dan desktop) dengan metode Perpetual Moving Weighted Average. Supabase adalah sumber kebenaran; IndexedDB (Dexie) untuk cache dan antrean offline.

## Menjalankan

```bash
npm install
cp .env.example .env.local   # isi URL dan anon key Supabase
npm run dev
```

Perintah lain: `npm run typecheck`, `npm test`, `npm run build`.

## Deployment

GitHub Actions membangun dan men-deploy ke GitHub Pages saat push ke `main`. Atur `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` di GitHub Secrets. Jangan pernah memasukkan Service Role Key ke repository.

Status: FASE 1 (scaffold dan arsitektur).
