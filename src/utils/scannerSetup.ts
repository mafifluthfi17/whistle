// Efek samping: memasang perbaikan UPC-E pada build ESM @zxing/library yang dipakai browser.
// (Dipisahkan dari scanner.ts agar pengujian di Node tidak memuat build ESM.)
import UPCEReader from '@zxing/library/esm/core/oned/UPCEReader'
import { patchUpcEReader } from './upcePatch'

patchUpcEReader(UPCEReader)
