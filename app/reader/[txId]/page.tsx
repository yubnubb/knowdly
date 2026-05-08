// app/reader/[txId]/page.tsx
// Book reader page — fetches content from ArLocal via our proxy API
// URL: /reader/[arweave-transaction-id]

'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { importKey, decryptFile } from '../../lib/crypto'

// ── Types ─────────────────────────────────────────────────────────────────────

type BookMeta = {
  txId:        string
  title:       string
  author:      string
  isbn:        string
  edition:     string
  description: string
  price:       string
  royalty:     string
  fileName:    string
  contentType: string
}

type ReaderStatus = 'loading' | 'ready' | 'error'

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReaderPage() {

  const params  = useParams()
  const router  = useRouter()
  const txId    = params.txId as string

  const [status,    setStatus]    = useState<ReaderStatus>('loading')
  const [meta,      setMeta]      = useState<BookMeta | null>(null)
  const [pdfUrl,    setPdfUrl]    = useState<string | null>(null)
  const [textBody,  setTextBody]  = useState<string | null>(null)
  const [error,     setError]     = useState<string | null>(null)
  const [fontSize,  setFontSize]  = useState(18)
  const [darkMode,  setDarkMode]  = useState(true)
  const [progress,  setProgress]  = useState(0)

  useEffect(() => {
    if (txId) fetchBook()
  }, [txId])

  useEffect(() => {
    function onScroll() {
      const el    = document.documentElement
      const total = el.scrollHeight - el.clientHeight
      setProgress(total > 0 ? Math.round((el.scrollTop / total) * 100) : 0)
    }
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ── Fetch Book Data ───────────────────────────────────────────────────────

  async function fetchBook() {
    setStatus('loading')
    setError(null)

    try {

      // ── Step 1: Fetch book metadata ──────────────────────────────────────
      const metaRes  = await fetch('/api/books')
      const metaData = await metaRes.json()
      const found    = metaData.books?.find((b: BookMeta) => b.txId === txId)
      if (found) setMeta(found)

      // ── Step 2: Fetch encrypted content from ArLocal ─────────────────────
      console.log('Fetching encrypted content...')
      const contentRes = await fetch(`http://localhost:1984/${txId}/data`)
      console.log('Fetch complete, status:', contentRes.status)

      if (!contentRes.ok) {
        throw new Error('Could not load book content: ' + contentRes.status)
      }

      // read the body ONCE — a response body can only be read once
      const encryptedBuffer = await contentRes.arrayBuffer()
      console.log('Encrypted buffer size:', encryptedBuffer.byteLength)

      // ── Step 3: Get wallet address from Freighter ────────────────────────
      console.log('Requesting decryption key...')
      const { requestAccess } = await import('@stellar/freighter-api')
      const accessResult = await requestAccess()

      if (accessResult.error) {
        throw new Error('Please connect your Freighter wallet to read this book')
      }

      // ── Step 4: Request decryption key from key server ───────────────────
      // server verifies on-chain ownership before releasing the key
      const keyResponse = await fetch(
        `/api/keys?arweaveTxId=${txId}&wallet=${accessResult.address}`
      )

      if (!keyResponse.ok) {
        const keyError = await keyResponse.json()
        throw new Error(keyError.error || 'Could not retrieve decryption key')
      }

      const { key: keyHex, iv } = await keyResponse.json()
      console.log('Key received. Decrypting content...')

      // ── Step 5: Decrypt the content ──────────────────────────────────────
      const aesKey        = await importKey(keyHex)
      const decryptedData = await decryptFile(encryptedBuffer, aesKey, iv)
      console.log('Decrypted size:', decryptedData.byteLength)

      // ── Step 6: Render the content ───────────────────────────────────────
      // all uploads are encrypted PDFs — render as PDF blob
      const blob = new Blob([decryptedData], { type: 'application/pdf' })
      const url  = URL.createObjectURL(blob)
      console.log('Blob created, size:', blob.size)
      setPdfUrl(url)
      setStatus('ready')

    } catch (err) {
      console.error('Reader error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load book')
      setStatus('error')
    }
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const bg         = darkMode ? 'bg-gray-950'   : 'bg-amber-50'
  const textColor  = darkMode ? 'text-gray-100' : 'text-gray-900'
  const barBg      = darkMode ? 'bg-gray-900'   : 'bg-white'
  const barBorder  = darkMode ? 'border-gray-800' : 'border-gray-200'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={`min-h-screen ${bg} ${textColor} transition-colors duration-200`}>

      {/* ── TOP TOOLBAR ───────────────────────────────────────────────────── */}
      <div className={`fixed top-0 left-0 right-0 z-50 ${barBg} border-b ${barBorder}`}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-4">

          {/* back to library */}
          <button
            onClick={() => router.push('/library')}
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            ← Library
          </button>

          {/* book info */}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {meta?.title || 'Loading...'}
            </div>
            {meta?.author && (
              <div className="text-xs text-gray-500">{meta.author}</div>
            )}
          </div>

          {/* controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFontSize(s => Math.max(12, s - 2))}
              className="text-xs text-gray-400 hover:text-white w-7 h-7 border border-gray-700 rounded flex items-center justify-center transition-colors"
            >
              A-
            </button>
            <button
              onClick={() => setFontSize(s => Math.min(28, s + 2))}
              className="text-xs text-gray-400 hover:text-white w-7 h-7 border border-gray-700 rounded flex items-center justify-center transition-colors"
            >
              A+
            </button>
            <button
              onClick={() => setDarkMode(d => !d)}
              className="text-xs text-gray-400 hover:text-white w-7 h-7 border border-gray-700 rounded flex items-center justify-center transition-colors"
            >
              {darkMode ? '☀' : '☾'}
            </button>
          </div>

          {/* progress */}
          <span className="text-xs text-gray-500 w-10 text-right">
            {progress}%
          </span>
        </div>

        {/* progress bar */}
        <div
          className="absolute bottom-0 left-0 h-0.5 bg-indigo-500 transition-all duration-150"
          style={{ width: progress + '%' }}
        />
      </div>

      {/* ── CONTENT ───────────────────────────────────────────────────────── */}
      <div className="pt-20 pb-20">
        <div className="max-w-2xl mx-auto px-6">

          {/* loading */}
          {status === 'loading' && (
            <div className="flex flex-col items-center justify-center py-40">
              <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
              <div className="text-gray-400 text-sm">Loading book...</div>
            </div>
          )}

          {/* error */}
          {status === 'error' && (
            <div className="text-center py-40">
              <div className="text-5xl mb-4">📕</div>
              <div className="text-red-400 font-medium mb-2">Could not load book</div>
              <div className="text-gray-500 text-sm mb-6">{error}</div>
              <button
                onClick={fetchBook}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg text-sm transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {/* ready */}
          {status === 'ready' && (
            <>
              {/* book header */}
              {meta && (
                <div className="mb-10 pb-8 border-b border-gray-800">
                  <h1
                    className="font-bold leading-tight mb-2"
                    style={{ fontSize: fontSize + 8 + 'px' }}
                  >
                    {meta.title}
                  </h1>
                  <p className="text-gray-400">
                    {meta.author}
                    {meta.edition ? ' · ' + meta.edition + ' edition' : ''}
                  </p>
                  {meta.isbn && (
                    <p className="text-gray-600 text-xs mt-1">ISBN {meta.isbn}</p>
                  )}
                </div>
              )}

              {/* PDF viewer */}
              {pdfUrl && (
                <div className="w-full rounded-xl overflow-hidden border border-gray-800">
                  <iframe
                    src={pdfUrl}
                    className="w-full"
                    style={{ height: '80vh' }}
                    title={meta?.title || 'Book'}
                  />
                </div>
              )}

              {/* text viewer */}
              {textBody && (
                <div
                  className="leading-relaxed whitespace-pre-wrap font-serif"
                  style={{ fontSize: fontSize + 'px' }}
                >
                  {textBody}
                </div>
              )}
            </>
          )}

        </div>
      </div>

      {/* ── BOTTOM BAR ────────────────────────────────────────────────────── */}
      {status === 'ready' && meta && (
        <div className={`fixed bottom-0 left-0 right-0 ${barBg} border-t ${barBorder} px-4 py-2`}>
          <div className="max-w-4xl mx-auto flex justify-between text-xs text-gray-500">
            <span className="truncate">{meta.title}</span>
            <span className="flex-shrink-0 ml-4">{progress}% complete</span>
          </div>
        </div>
      )}

    </div>
  )
}