import qrCore from 'qrcode/lib/core/qrcode'
import qrSvg from 'qrcode/lib/renderer/svg'

/**
 * Build the pairing QR without `qrcode`'s entry point.
 *
 * `qrcode/lib/index.js` -> `server.js` loads the PNG renderer, and that pulls
 * `pngjs`, whose `require('fs')` cannot run inside an ESM bundle. The SVG
 * renderer and the core encoder are pure JavaScript, so importing them
 * directly keeps the encoder bundled and free of runtime resolution.
 */
export async function renderQrSvg(text: string): Promise<{ svg: string | null; error: string | null }> {
  try {
    const data = qrCore.create(text, { errorCorrectionLevel: 'M' })
    const svg = qrSvg.render(data, {
      margin: 1,
      width: 320,
      color: { dark: '#0b0e14', light: '#ffffff' },
    })
    if (typeof svg !== 'string') {
      console.warn('[dsh-hello] QR encoder returned', typeof svg, 'instead of an SVG string')
      return { svg: null, error: `encoder-returned-${typeof svg}` }
    }
    if (!svg.trimStart().startsWith('<svg')) {
      console.warn('[dsh-hello] QR encoder returned a non-SVG string:', svg.slice(0, 80))
      return { svg: null, error: `encoder-returned-text:${svg.trim().slice(0, 40)}` }
    }
    return { svg, error: null }
  } catch (error) {
    console.warn('[dsh-hello] QR SVG generation failed:', error)
    return { svg: null, error: `encoder-failed:${error instanceof Error ? error.message : String(error)}`.slice(0, 200) }
  }
}
