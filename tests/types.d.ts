// Tipe minimal untuk generator barcode yang dipakai tes (bwip-js tidak menyertakan tipe untuk impor ESM ini).
declare module 'bwip-js' {
  const bwipjs: {
    toBuffer(options: Record<string, unknown>): Promise<Buffer>
  }
  export default bwipjs
}
