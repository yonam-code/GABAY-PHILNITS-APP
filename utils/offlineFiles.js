import { File, Directory, Paths } from 'expo-file-system'
import { hasInternet } from './connectivity'

/**
 * Permanent on-device storage for reading-material PDFs.
 * Files live in the app's document directory (not the OS cache), so they survive app restarts
 * and are not evicted by the system. One file per URL: if a PDF is replaced in Supabase it gets
 * a new URL and is downloaded again; the old one is never served for the new URL.
 */

const MAX_BYTES = 25 * 1024 * 1024

let _dir = null
function pdfDir() {
  if (!_dir) {
    _dir = new Directory(Paths.document, 'reading_pdfs')
    try { if (!_dir.exists) _dir.create({ idempotent: true, intermediates: true }) } catch (_) { }
  }
  return _dir
}

// Stable, filesystem-safe name for a URL (two 32-bit hashes -> very low collision risk)
function nameFor(url) {
  let h1 = 0x811c9dc5, h2 = 5381
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0
    h2 = ((h2 << 5) + h2 + c) >>> 0
  }
  return `${h1.toString(16)}${h2.toString(16)}.pdf`
}

function fileFor(url) {
  return new File(pdfDir(), nameFor(url))
}

/** The saved copy of this PDF, or null if it has not been downloaded yet. */
export function getLocalPdf(url) {
  if (!url) return null
  try {
    const f = fileFor(url)
    return f.exists && (f.size || 0) > 0 ? f : null
  } catch (_) {
    return null
  }
}

const _inflight = new Map()

/** Downloads the PDF into permanent storage (once). Resolves to the File. */
export function downloadPdf(url) {
  if (!url) return Promise.reject(new Error('No PDF link'))
  const existing = getLocalPdf(url)
  if (existing) return Promise.resolve(existing)
  if (_inflight.has(url)) return _inflight.get(url)

  const task = (async () => {
    const target = fileFor(url)
    const temp = new File(pdfDir(), `${nameFor(url)}.part`)
    try { if (temp.exists) temp.delete() } catch (_) { }
    const saved = await File.downloadFileAsync(url, temp, { idempotent: true })
    const size = saved.size || 0
    if (size === 0) { try { saved.delete() } catch (_) { } throw new Error('The PDF file is empty') }
    if (size > MAX_BYTES) { try { saved.delete() } catch (_) { } throw new Error('The PDF is too large to save offline') }
    // Only a complete download becomes the real file (a dropped connection never leaves a broken PDF)
    try { if (target.exists) target.delete() } catch (_) { }
    await saved.move(target)
    return fileFor(url)
  })()

  _inflight.set(url, task)
  task.finally(() => _inflight.delete(url)).catch(() => { })
  return task
}

// ── PDF.js viewer scripts, saved once so the PDF viewer also works offline ──
const PDFJS_VERSION = '2.16.105'
const PDFJS_FILES = {
  lib: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`,
  worker: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`,
}
let _pdfJsCache = null
let _pdfJsInflight = null

function pdfJsFile(kind) {
  return new File(pdfDir(), `pdfjs-${PDFJS_VERSION}-${kind}.js`)
}

/**
 * Returns { lib, worker } script text from device storage, downloading it first if needed.
 * Resolves to null if the scripts are not saved and cannot be downloaded (viewer then uses the CDN).
 */
export function getPdfJsScripts() {
  if (_pdfJsCache) return Promise.resolve(_pdfJsCache)
  if (_pdfJsInflight) return _pdfJsInflight
  _pdfJsInflight = (async () => {
    try {
      const out = {}
      for (const kind of ['lib', 'worker']) {
        const f = pdfJsFile(kind)
        if (!(f.exists && (f.size || 0) > 10000)) {
          const temp = new File(pdfDir(), `pdfjs-${PDFJS_VERSION}-${kind}.part`)
          try { if (temp.exists) temp.delete() } catch (_) { }
          const saved = await File.downloadFileAsync(PDFJS_FILES[kind], temp, { idempotent: true })
          if ((saved.size || 0) < 10000) { try { saved.delete() } catch (_) { } throw new Error('PDF viewer download incomplete') }
          try { if (f.exists) f.delete() } catch (_) { }
          await saved.move(f)
        }
        out[kind] = await pdfJsFile(kind).text()
      }
      _pdfJsCache = out
      return out
    } catch (_) {
      return null
    } finally {
      _pdfJsInflight = null
    }
  })()
  return _pdfJsInflight
}

/** Base64 contents of the saved PDF (for the in-app viewer). */
export async function readPdfBase64(file) {
  return await file.base64()
}

/**
 * Background pre-download of PDFs so the Library works fully offline.
 * Sequential (gentle on the network), skips files already saved, stops if the connection drops.
 */
let _precacheRunning = false
export async function precachePdfs(urls) {
  if (_precacheRunning) return
  _precacheRunning = true
  try {
    await getPdfJsScripts() // the viewer itself must be available offline too
    const unique = [...new Set((urls || []).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u) && !u.includes('drive.google.com')))]
    for (const url of unique) {
      if (getLocalPdf(url)) continue
      if (!(await hasInternet())) break
      try { await downloadPdf(url) } catch (_) { /* skip this one, try the rest */ }
    }
  } finally {
    _precacheRunning = false
  }
}
