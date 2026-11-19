import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserCodeReader, BrowserMultiFormatReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { describeCameraError, type CameraError } from '../utils/scanLogic'
import { buildScanHints, formatName, rearCameraConstraints } from '../utils/scanner'
import '../utils/scannerSetup' // memperbaiki pembaca UPC-E bawaan ZXing yang rusak

interface Props {
  /** Dipanggil setiap kode baru terbaca (kode yang sama dalam 1,5 detik diabaikan). */
  onDetected: (text: string, format: string) => void
  /** Mulai otomatis saat tampil (mis. kembali dari layar hasil scan). */
  autoStart?: boolean
  /** Dipanggil bila kamera tidak dapat dipakai, agar induk menampilkan input manual. */
  onCameraError?: (e: CameraError) => void
}

type State = 'idle' | 'starting' | 'scanning' | 'error'

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    osc.frequency.value = 880
    osc.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.08)
    osc.onended = () => void ctx.close()
  } catch {
    /* bunyi bersifat opsional */
  }
}

function stopStream(video: HTMLVideoElement | null) {
  const stream = video?.srcObject as MediaStream | null | undefined
  stream?.getTracks().forEach((t) => t.stop())
  if (video) video.srcObject = null
}

export default function BarcodeScanner({ onDetected, autoStart = false, onCameraError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const lastRef = useRef<{ text: string; at: number }>({ text: '', at: 0 })
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected

  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<CameraError | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  const stop = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    stopStream(videoRef.current)
    setTorchOn(false)
    setTorchSupported(false)
    setState((s) => (s === 'error' ? s : 'idle'))
  }, [])

  const start = useCallback(
    async (chosenDevice?: string) => {
      controlsRef.current?.stop()
      controlsRef.current = null
      setError(null)
      setState('starting')

      const env = {
        secure: typeof window !== 'undefined' && window.isSecureContext,
        hasMediaDevices: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
      }
      if (!env.secure || !env.hasMediaDevices) {
        const e = describeCameraError(null, env)
        setError(e)
        setState('error')
        onCameraError?.(e)
        return
      }

      const reader = new BrowserMultiFormatReader(buildScanHints() as never, {
        delayBetweenScanAttempts: 120,
        delayBetweenScanSuccess: 600,
      })
      const callback = (result: { getText(): string; getBarcodeFormat(): number } | undefined) => {
        if (!result) return
        const text = result.getText()
        const now = Date.now()
        if (text === lastRef.current.text && now - lastRef.current.at < 1500) return
        lastRef.current = { text, at: now }
        navigator.vibrate?.(60)
        beep()
        onDetectedRef.current(text, formatName(result.getBarcodeFormat()))
      }

      try {
        let controls: IScannerControls
        try {
          controls = await reader.decodeFromConstraints(rearCameraConstraints(chosenDevice), videoRef.current ?? undefined, callback)
        } catch (e) {
          // Kamera belakang tidak tersedia (mis. laptop): coba kamera apa pun
          if (describeCameraError(e, { secure: true, hasMediaDevices: true }).kind !== 'constraint') throw e
          controls = await reader.decodeFromConstraints({ audio: false, video: true }, videoRef.current ?? undefined, callback)
        }
        controlsRef.current = controls
        setTorchSupported(typeof controls.switchTorch === 'function')
        setState('scanning')
        // Daftar kamera baru tersedia (dengan label) setelah izin diberikan
        BrowserCodeReader.listVideoInputDevices()
          .then((list) => setDevices(list))
          .catch(() => {})
      } catch (e) {
        stopStream(videoRef.current)
        const err = describeCameraError(e, env)
        setError(err)
        setState('error')
        onCameraError?.(err)
      }
    },
    [onCameraError],
  )

  // Matikan kamera saat komponen dilepas
  useEffect(() => {
    return () => {
      controlsRef.current?.stop()
      controlsRef.current = null
      stopStream(videoRef.current)
    }
  }, [])

  useEffect(() => {
    if (autoStart) void start()
    // hanya saat pertama tampil
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleTorch() {
    const c = controlsRef.current
    if (!c?.switchTorch) return
    try {
      await c.switchTorch(!torchOn)
      setTorchOn(!torchOn)
    } catch {
      setTorchSupported(false)
    }
  }

  const btn = 'rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-50'
  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline aria-label="Pratinjau kamera" />
        {state !== 'scanning' && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white/90">
            {state === 'starting' ? 'Membuka kamera…' : state === 'error' ? 'Kamera tidak aktif' : 'Tekan Mulai Scan untuk membuka kamera'}
          </div>
        )}
        {state === 'scanning' && (
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" aria-hidden="true" />
        )}
      </div>

      {error && (
        <p role="alert" className="rounded bg-red-100 p-3 text-sm text-red-800">
          {error.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {state === 'scanning' ? (
          <button type="button" className={`${btn} bg-red-700 text-white`} onClick={stop}>
            Hentikan Scan
          </button>
        ) : (
          <button type="button" className={`${btn} bg-[#0b1f4d] text-white`} disabled={state === 'starting'} onClick={() => void start(deviceId || undefined)}>
            {state === 'starting' ? 'Membuka…' : state === 'error' ? 'Coba Lagi' : 'Mulai Scan'}
          </button>
        )}
        {state === 'scanning' && torchSupported && (
          <button type="button" className={`${btn} border border-slate-300 bg-white`} onClick={() => void toggleTorch()} aria-pressed={torchOn}>
            {torchOn ? 'Matikan Senter' : 'Nyalakan Senter'}
          </button>
        )}
        {devices.length > 1 && (
          <select
            className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            value={deviceId}
            aria-label="Pilih kamera"
            onChange={(e) => {
              setDeviceId(e.target.value)
              if (state === 'scanning') void start(e.target.value || undefined)
            }}
          >
            <option value="">Kamera belakang (default)</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Kamera ${i + 1}`}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="text-xs text-slate-500">Mendukung EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, dan QR Code.</p>
    </div>
  )
}
