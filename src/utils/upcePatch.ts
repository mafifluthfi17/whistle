import { BarcodeFormat, ChecksumException, FormatException, NotFoundException, Result, ResultPoint } from '@zxing/library'
import { convertUpcEToUpcA } from './scanLogic'

/**
 * Perbaikan untuk UPCEReader di @zxing/library 0.23 (ditandai @experimental dan rusak):
 *  - decodeMiddle menjumlah string pada objek StringBuilder dan tidak mengembalikan {rowOffset, resultString}
 *    seperti yang diharapkan UPCEANReader.decodeRow
 *  - determineNumSysAndCheckDigit memakai ('0' + numSys) yang menghasilkan "00", bukan "0"
 *  - convertUPCEtoUPCA tidak punya `break`, sehingga cek digit selalu gagal
 *  - UPCEANReader.decodeRow memakai penjaga akhir statis 3 modul, padahal UPC-E berakhir dengan 6 modul
 * Akibatnya UPC-E tidak pernah terbaca. Fungsi ini menimpa bagian-bagian itu pada kelas yang diberikan.
 *
 * Kelas diterima sebagai parameter agar patch yang sama dapat diuji pada build CJS (Node/Vitest)
 * dan dipasang pada build ESM (browser).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function patchUpcEReader(Cls: any): void {
  if (Cls.__whistleUpcePatched) return

  Cls.determineNumSysAndCheckDigit = (digits: string, lgPatternFound: number): string => {
    for (let numSys = 0; numSys <= 1; numSys++) {
      for (let d = 0; d < 10; d++) {
        if (lgPatternFound === Cls.NUMSYS_AND_CHECK_DIGIT_PATTERNS[numSys][d]) return `${numSys}${digits}${d}`
      }
    }
    throw NotFoundException.getNotFoundInstance()
  }

  Cls.convertUPCEtoUPCA = (upce: string): string => convertUpcEToUpcA(upce) ?? upce

  Cls.prototype.decodeMiddle = function (row: any, startRange: number[], _resultString: string) {
    const counters = new Int32Array(4)
    const end: number = row.getSize()
    let rowOffset = startRange[1]
    let lgPatternFound = 0
    let digits = ''
    for (let x = 0; x < 6 && rowOffset < end; x++) {
      const bestMatch: number = Cls.decodeDigit(row, counters, rowOffset, Cls.L_AND_G_PATTERNS)
      digits += String.fromCharCode(48 + (bestMatch % 10))
      for (const c of counters) rowOffset += c
      if (bestMatch >= 10) lgPatternFound |= 1 << (5 - x)
    }
    return { rowOffset, resultString: Cls.determineNumSysAndCheckDigit(digits, lgPatternFound) }
  }

  Cls.prototype.checkChecksum = function (s: string): boolean {
    return Object.getPrototypeOf(Cls).checkChecksum(Cls.convertUPCEtoUPCA(s))
  }

  // decodeRow bawaan memakai penjaga akhir 3 modul; UPC-E memerlukan 6 modul (instance.decodeEnd).
  Cls.prototype.decodeRow = function (rowNumber: number, row: any, _hints?: unknown): Result {
    const startGuardRange: number[] = Cls.findStartGuardPattern(row)
    const middle = this.decodeMiddle(row, startGuardRange, '')
    const endRange: number[] = this.decodeEnd(row, middle.rowOffset)
    const end = endRange[1]
    const quietEnd = end + (end - endRange[0])
    if (quietEnd >= row.getSize() || !row.isRange(end, quietEnd, false)) throw NotFoundException.getNotFoundInstance()
    const text: string = middle.resultString
    if (text.length < 8) throw FormatException.getFormatInstance()
    if (!this.checkChecksum(text)) throw ChecksumException.getChecksumInstance()
    const left = (startGuardRange[1] + startGuardRange[0]) / 2
    const right = (endRange[1] + endRange[0]) / 2
    return new Result(
      text,
      null as never, // seperti pembaca EAN/UPC lain di library: tanpa raw bytes
      0,
      [new ResultPoint(left, rowNumber), new ResultPoint(right, rowNumber)],
      BarcodeFormat.UPC_E,
      Date.now(),
    )
  }

  Cls.__whistleUpcePatched = true
}
