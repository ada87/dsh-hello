/**
 * Minimal declarations for the two qrcode modules the admin QR needs.
 *
 * Only these deep paths are imported: `lib/server.js` pulls in the PNG renderer,
 * and that renderer's `pngjs` dependency calls `require('fs')` at load time,
 * which an ESM bundle cannot serve. The SVG renderer and the core encoder have
 * no Node-only dependencies, so bundling them is safe.
 */
declare module 'qrcode/lib/core/qrcode' {
  const core: {
    create(data: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): unknown
  }
  export default core
}

declare module 'qrcode/lib/renderer/svg' {
  const renderer: {
    render(
      qrData: unknown,
      options?: {
        margin?: number
        width?: number
        color?: { dark?: string; light?: string }
      },
    ): string
  }
  export default renderer
}
