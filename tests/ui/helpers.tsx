import 'fake-indexeddb/auto'
import { cleanup, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach } from 'vitest'
import { ToastProvider } from '../../src/components/Toast'

afterEach(() => {
  cleanup()
  setOnline(true)
})

/** Atur status koneksi seperti browser (navigator.onLine + event). */
export function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

/** Render dengan penyedia notifikasi (toast) yang sungguhan. */
export function renderUI(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** File uji dengan isi teks (jsdom belum punya File.text/arrayBuffer pada semua versi). */
export function textFile(content: string, name = 'backup.json', type = 'application/json'): File {
  const f = new File([content], name, { type })
  Object.defineProperty(f, 'text', { value: async () => content })
  return f
}

export function binaryFile(data: Uint8Array, name: string): File {
  const f = new File([data as BlobPart], name)
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  Object.defineProperty(f, 'arrayBuffer', { value: async () => ab })
  return f
}
