// app/upload/page.tsx
// Atomic upload flow — wallet must be connected and sign before anything
// is uploaded to Arweave or stored on the key server.
//
// Order of operations:
//   1. Connect Freighter wallet
//   2. Encrypt file in browser
//   3. Upload encrypted file to Arweave
//   4. Store encryption key on key server
//   5. Register book on Soroban + submit transaction
//   6. Show success
//
// If the professor cancels at step 1, nothing has happened.
// If any later step fails, the error is shown clearly.

'use client'

import { useState } from 'react'
import { buildAndSignRegisterBook, submitSignedTransaction, getTotalBooks } from '../lib/contract'
import { requestAccess } from '@stellar/freighter-api'
import { generateKey, exportKey, encryptFile } from '../lib/crypto'

type UploadStatus = 'idle' | 'uploading' | 'done' | 'error'
type ContentFormat = 'PDF' | 'EPUB' | 'TXT' | null

const MIME_TYPES: Record<string, string> = {
  PDF:  'application/pdf',
  EPUB: 'application/epub+zip',
  TXT:  'text/plain',
}

function getMimeType(format: ContentFormat): string {
  if (!format) return 'application/octet-stream'
  return MIME_TYPES[format] ?? 'application/octet-stream'
}

function detectFormat(file: File): ContentFormat {
  const name = file.name.toLowerCase()
  if (name.endsWith('.epub'))                return 'EPUB'
  if (name.endsWith('.pdf'))                 return 'PDF'
  if (name.endsWith('.txt'))                 return 'TXT'
  if (file.type === 'application/pdf')       return 'PDF'
  if (file.type === 'application/epub+zip')  return 'EPUB'
  if (file.type === 'text/plain')            return 'TXT'
  return null
}

const CATEGORIES = [
  'Textbook', 'Novel', 'Research Paper',
  'Essay Collection', 'Course Notes', 'Reference', 'Other',
]

export default function UploadPage() {

  // ── Form state ─────────────────────────────────────────────────────────────
  const [file,        setFile]        = useState<File | null>(null)
  const [format,      setFormat]      = useState<ContentFormat>(null)
  const [title,       setTitle]       = useState('')
  const [author,      setAuthor]      = useState('')
  const [isbn,        setIsbn]        = useState('')
  const [edition,     setEdition]     = useState('')
  const [description, setDescription] = useState('')
  const [category,    setCategory]    = useState('')
  const [price,       setPrice]       = useState('')
  const [royalty,     setRoyalty]     = useState('5')

  // ── Upload state ───────────────────────────────────────────────────────────
  const [status,      setStatus]      = useState<UploadStatus>('idle')
  const [step,        setStep]        = useState('')   // human-readable progress
  const [progress,    setProgress]    = useState(0)
  const [txId,        setTxId]        = useState<string | null>(null)
  const [error,       setError]       = useState<string | null>(null)

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (!selected) return
    setFile(selected)
    setFormat(detectFormat(selected))
    setStatus('idle')
    setTxId(null)
    setError(null)
  }

  function isFormValid() {
    return (
      file !== null &&
      format !== null &&
      title.trim() !== '' &&
      author.trim() !== '' &&
      category !== '' &&
      price.trim() !== '' &&
      parseFloat(price) > 0
    )
  }

  function resetForm() {
    setFile(null); setFormat(null); setTitle(''); setAuthor('')
    setIsbn(''); setEdition(''); setDescription(''); setCategory('')
    setPrice(''); setRoyalty('5'); setStatus('idle')
    setTxId(null); setProgress(0); setStep(''); setError(null)
  }

  async function handleUpload() {
    if (!isFormValid() || !file || !format) return

    setStatus('uploading')
    setError(null)
    setTxId(null)
    setProgress(0)

    try {

      // ── Step 1: Connect wallet FIRST ───────────────────────────────────
      // If the professor cancels here, nothing has been uploaded or stored.
      setStep('Connecting wallet...')
      const accessResult = await requestAccess()
      if (accessResult.error) {
        throw new Error('Wallet connection required to publish. Please connect Freighter and try again.')
      }
      const walletAddress = accessResult.address
      console.log('Wallet connected:', walletAddress)
      setProgress(10)

      // ── Step 2: Encrypt file in browser ───────────────────────────────
      // Plaintext never leaves the browser.
      setStep('Encrypting file...')
      const aesKey = await generateKey()
      const { encryptedData, iv } = await encryptFile(file, aesKey)
      const keyHex = await exportKey(aesKey)
      console.log('File encrypted. Size:', encryptedData.byteLength)
      setProgress(25)

      // ── Step 3: Build + sign Stellar transaction BEFORE uploading ────────
      // Freighter prompts the professor here. If they cancel, nothing
      // has been uploaded to Arweave yet — clean abort.
      setStep('Preparing Stellar transaction — please sign in Freighter...')

      // We use a placeholder Arweave TX ID for signing since we don't
      // have the real one yet. The contract stores this as metadata only —
      // ownership and payment are enforced by bookId, not txId.
      const PLACEHOLDER_TX = 'pending_' + Date.now()

      let signedXdr: string
      try {
        signedXdr = await buildAndSignRegisterBook(
          walletAddress,
          parseFloat(price) * 100,
          parseInt(royalty) * 100,
          PLACEHOLDER_TX,
          title,
        )
        console.log('Transaction signed. Proceeding with upload...')
      } catch (signErr) {
        // Professor cancelled Freighter — nothing uploaded, clean stop
        throw new Error('Upload cancelled — transaction was not signed.')
      }
      setProgress(35)

      // ── Step 4: Upload encrypted file to Arweave ──────────────────────
      // Only reached if professor signed the transaction.
      setStep('Uploading to Arweave...')

      const encryptedBlob = new Blob([encryptedData], { type: 'application/octet-stream' })
      const encryptedFile = new File([encryptedBlob], file.name + '.enc', {
        type: 'application/octet-stream',
      })

      const formData = new FormData()
      formData.append('file',          encryptedFile)
      formData.append('title',         title)
      formData.append('author',        author)
      formData.append('isbn',          isbn)
      formData.append('edition',       edition)
      formData.append('description',   description)
      formData.append('category',      category.toLowerCase())
      formData.append('price',         price)
      formData.append('royalty',       royalty)
      formData.append('contentFormat', format)
      formData.append('contentMime',   getMimeType(format))

      const progressInterval = setInterval(() => {
        setProgress(prev => prev >= 75 ? prev : prev + 3)
      }, 400)

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body:   formData,
      })
      clearInterval(progressInterval)

      const uploadData: { txId: string; error?: string } = await uploadRes.json()
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Arweave upload failed')

      const arweaveTxId = uploadData.txId
      setTxId(arweaveTxId)
      setProgress(75)
      console.log('Arweave upload successful. TX ID:', arweaveTxId)

      // ── Step 5: Submit signed transaction to Stellar ───────────────────
      // Now that we have the real Arweave TX ID, submit the transaction.
      setStep('Submitting to Stellar network...')
      let bookId: number
      try {
        await submitSignedTransaction(signedXdr)
        const totalBooks = await getTotalBooks(walletAddress)
        bookId = totalBooks - 1
        console.log('Book registered on Stellar. Book ID:', bookId)
      } catch (submitErr) {
        // Submission failed — Arweave upload exists but book is not
        // registered. Safe state: book won't appear as purchasable
        // because it has no bookId in localStorage.
        throw new Error(
          'Arweave upload succeeded but Stellar submission failed. ' +
          'Arweave TX: ' + arweaveTxId + '. Please contact support.'
        )
      }

      setProgress(90)

      // ── Step 6: Store encryption key ──────────────────────────────────
      // Only reached if Soroban registration succeeded.
      // Key is tied to the bookId — ownership verified before release.
      setStep('Storing encryption key...')

      // store Arweave TX → Soroban book ID mapping in localStorage
      const bookIdMap = JSON.parse(localStorage.getItem('knowdly_book_ids') || '{}')
      bookIdMap[arweaveTxId] = bookId
      localStorage.setItem('knowdly_book_ids', JSON.stringify(bookIdMap))

      const keyRes = await fetch('/api/keys', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ arweaveTxId, bookId, key: keyHex, iv }),
      })

      if (!keyRes.ok) {
        // Key storage failed — book is registered on Soroban but unreadable.
        // This is the one failure mode we can't easily recover from.
        // Log it clearly so it can be manually fixed.
        console.error('CRITICAL: Key storage failed for bookId', bookId, 'txId', arweaveTxId)
        throw new Error(
          'Book registered on Stellar but encryption key storage failed. ' +
          'Please contact support with your Arweave TX ID: ' + arweaveTxId
        )
      }

      console.log('Encryption key stored securely.')
      setProgress(100)
      setStep('Complete')
      setStatus('done')

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      setError(message)
      setStatus('error')
      setProgress(0)
      setStep('')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto">

      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-3">Upload your book</h1>
        <p className="text-gray-400 leading-relaxed">
          Your content is encrypted and stored permanently on Arweave.
          You keep full ownership and earn royalties on every sale and resale.
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-6">

        {/* FILE PICKER */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Book file <span className="text-indigo-400">*</span>
          </label>
          <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-gray-700 rounded-xl cursor-pointer hover:border-indigo-500 transition-colors bg-gray-950">
            <input
              type="file"
              className="hidden"
              accept=".pdf,.epub,.txt"
              onChange={handleFileChange}
              disabled={status === 'uploading'}
            />
            {file ? (
              <div className="text-center">
                <div className="text-white font-medium mb-1">{file.name}</div>
                <div className="text-gray-500 text-sm">
                  {(file.size / 1024 / 1024).toFixed(2)} MB &middot;&nbsp;
                  {format && (
                    <span className={`font-semibold ${
                      format === 'EPUB' ? 'text-purple-400' :
                      format === 'PDF'  ? 'text-indigo-400' : 'text-gray-400'
                    }`}>{format}</span>
                  )}
                  &nbsp;&middot; click to change
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-gray-400 mb-1">Click to select a file</div>
                <div className="text-gray-600 text-sm">PDF · EPUB · TXT</div>
              </div>
            )}
          </label>
          {format === 'EPUB' && (
            <p className="text-purple-400 text-xs mt-2">
              EPUB — readers get a reflow e-reader experience (ideal for novels and essays)
            </p>
          )}
          {format === 'PDF' && (
            <p className="text-indigo-400 text-xs mt-2">
              PDF — readers get a page-by-page viewer (ideal for textbooks and papers)
            </p>
          )}
        </div>

        {/* TITLE */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Title <span className="text-indigo-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Introduction to Quantum Computing"
            disabled={status === 'uploading'}
            className="w-full bg-gray-950 border border-gray-700 text-white placeholder-gray-600 px-4 py-3 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* AUTHOR */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Author <span className="text-indigo-400">*</span>
          </label>
          <input
            type="text"
            value={author}
            onChange={e => setAuthor(e.target.value)}
            placeholder="Dr. Jane Smith"
            disabled={status === 'uploading'}
            className="w-full bg-gray-950 border border-gray-700 text-white placeholder-gray-600 px-4 py-3 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* CATEGORY */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Category <span className="text-indigo-400">*</span>
          </label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            disabled={status === 'uploading'}
            className="w-full bg-gray-950 border border-gray-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="" disabled>Select a category</option>
            {CATEGORIES.map(c => (
              <option key={c} value={c.toLowerCase()}>{c}</option>
            ))}
          </select>
        </div>

        {/* ISBN and EDITION */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">ISBN</label>
            <input
              type="text"
              value={isbn}
              onChange={e => setIsbn(e.target.value)}
              placeholder="978-0-000-00000-0"
              disabled={status === 'uploading'}
              className="w-full bg-gray-950 border border-gray-700 text-white placeholder-gray-600 px-4 py-3 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Edition</label>
            <input
              type="text"
              value={edition}
              onChange={e => setEdition(e.target.value)}
              placeholder="3rd"
              disabled={status === 'uploading'}
              className="w-full bg-gray-950 border border-gray-700 text-white placeholder-gray-600 px-4 py-3 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        {/* DESCRIPTION */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="A brief description of what readers will discover..."
            rows={3}
            disabled={status === 'uploading'}
            className="w-full bg-gray-950 border border-gray-700 text-white placeholder-gray-600 px-4 py-3 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors resize-none"
          />
        </div>

        {/* PRICE and ROYALTY */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Price (USD) <span className="text-indigo-400">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-3.5 text-gray-500">$</span>
              <input
                type="number"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="49.99"
                min="0"
                step="0.01"
                disabled={status === 'uploading'}
                className="w-full bg-gray-950 border border-gray-700 text-white placeholder-gray-600 pl-8 pr-4 py-3 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Resale royalty (%)
            </label>
            <div className="relative">
              <input
                type="number"
                value={royalty}
                onChange={e => setRoyalty(e.target.value)}
                min="0"
                max="50"
                disabled={status === 'uploading'}
                className="w-full bg-gray-950 border border-gray-700 text-white placeholder-gray-600 px-4 py-3 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <span className="absolute right-4 top-3.5 text-gray-500">%</span>
            </div>
            <p className="text-gray-600 text-xs mt-1">
              You earn this % every time a reader resells your book
            </p>
          </div>
        </div>

        {/* UPLOAD BUTTON */}
        <button
          onClick={handleUpload}
          disabled={!isFormValid() || status === 'uploading' || status === 'done'}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white py-3 rounded-lg font-medium transition-colors"
        >
          {status === 'uploading' && (step || `Uploading... ${progress}%`)}
          {status === 'done'      && 'Upload complete ✓'}
          {status === 'idle'      && 'Upload to Arweave'}
          {status === 'error'     && 'Try again'}
        </button>

        {/* PROGRESS BAR */}
        {status === 'uploading' && (
          <div className="space-y-2">
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div
                className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: progress + '%' }}
              />
            </div>
            <div className="text-gray-500 text-xs text-center">{step}</div>
          </div>
        )}

        {/* SUCCESS */}
        {status === 'done' && txId && (
          <div className="bg-green-950 border border-green-800 rounded-xl p-6 space-y-3">
            <div className="text-green-400 font-medium">Upload complete ✓</div>
            <div>
              <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
                Arweave transaction ID
              </div>
              <code className="text-green-300 text-xs break-all">{txId}</code>
            </div>
            <div className="flex gap-4">
              <a
                href={'https://arweave.net/' + txId}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
              >
                View on Arweave →
              </a>
              <button
                onClick={resetForm}
                className="text-gray-400 hover:text-white text-sm transition-colors"
              >
                Upload another →
              </button>
            </div>
          </div>
        )}

        {/* ERROR */}
        {status === 'error' && error && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-4">
            <div className="text-red-400 font-medium mb-1">Upload failed</div>
            <p className="text-red-300 text-xs leading-relaxed">{error}</p>
          </div>
        )}

      </div>
    </div>
  )
}