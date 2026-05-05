// app/upload/page.tsx
// The professor upload page — where professors upload their textbooks to Arweave
// This is a client component because it handles form state and file selection

'use client'

// useState manages all our form fields and upload state
import { useState } from 'react'

// TypeScript type for our upload status
type UploadStatus = 'idle' | 'uploading' | 'done' | 'error'

export default function UploadPage() {

  // ── Form field state ───────────────────────────────────────────────────────

  // the actual file object selected by the professor
  const [file, setFile] = useState<File | null>(null)

  // book metadata fields
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [isbn, setIsbn] = useState('')
  const [edition, setEdition] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [royalty, setRoyalty] = useState('5')

  // ── Upload state ───────────────────────────────────────────────────────────

  // tracks where we are in the upload process
  const [status, setStatus] = useState<UploadStatus>('idle')

  // the Arweave transaction ID returned after successful upload
  const [txId, setTxId] = useState<string | null>(null)

  // any error message if something goes wrong
  const [error, setError] = useState<string | null>(null)

  // upload progress percentage 0-100
  const [progress, setProgress] = useState(0)

  // ── Handlers ───────────────────────────────────────────────────────────────

  // runs when the professor picks a file
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (!selected) return
    setFile(selected)
    // reset any previous upload result
    setStatus('idle')
    setTxId(null)
    setError(null)
  }

  // validates the form before allowing upload
  function isFormValid() {
    return (
      file !== null &&
      title.trim() !== '' &&
      author.trim() !== '' &&
      price.trim() !== '' &&
      parseFloat(price) > 0
    )
  }

  // runs when the professor clicks Upload
  async function handleUpload() {
    if (!isFormValid() || !file) return

    setStatus('uploading')
    setError(null)
    setTxId(null)
    setProgress(0)

    try {
      // build a FormData object to send the file and metadata
      // to our Next.js API route as a multipart form submission
      const formData = new FormData()

      // append the file itself
      formData.append('file', file)

      // append all the book metadata as individual fields
      formData.append('title', title)
      formData.append('author', author)
      formData.append('isbn', isbn)
      formData.append('edition', edition)
      formData.append('description', description)
      formData.append('price', price)
      formData.append('royalty', royalty)

      // simulate progress while waiting for the server
      // real progress tracking requires streaming which we'll add later
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          // slowly increment up to 90% while waiting for server response
          // the final 10% jumps to 100% when the server confirms success
          if (prev >= 90) return prev
          return prev + 5
        })
      }, 500)

      // send the file and metadata to our server-side API route
      // POST /api/upload handles the actual Arweave upload
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      // stop the fake progress animation
      clearInterval(progressInterval)

      // parse the JSON response from our API route
      const data = await response.json()

      if (!response.ok) {
        // server returned an error — show it to the professor
        throw new Error(data.error || 'Upload failed')
      }

      // success — store the Arweave transaction ID
      setTxId(data.txId)
      setProgress(100)
      setStatus('done')

    } catch (err) {
      // something went wrong — show the error message
      const message = err instanceof Error ? err.message : 'Upload failed'
      setError(message)
      setStatus('error')
      setProgress(0)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto">

      {/* page header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-3">
          Upload your textbook
        </h1>
        <p className="text-gray-400 leading-relaxed">
          Your content is encrypted and stored permanently on Arweave.
          You keep full ownership and earn royalties on every sale and resale.
        </p>
      </div>

      {/* ── UPLOAD FORM ─────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-6">

        {/* FILE PICKER */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Book file <span className="text-indigo-400">*</span>
          </label>

          {/* styled file drop area */}
          <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-gray-700 rounded-xl cursor-pointer hover:border-indigo-500 transition-colors bg-gray-950">
            <input
              type="file"
              className="hidden"
              accept=".pdf,.epub,.txt"
              onChange={handleFileChange}
              disabled={status === 'uploading'}
            />
            {file ? (
              // show selected file info
              <div className="text-center">
                <div className="text-white font-medium mb-1">{file.name}</div>
                <div className="text-gray-500 text-sm">
                  {(file.size / 1024 / 1024).toFixed(2)} MB &middot; click to change
                </div>
              </div>
            ) : (
              // show placeholder
              <div className="text-center">
                <div className="text-gray-400 mb-1">Click to select a file</div>
                <div className="text-gray-600 text-sm">PDF, EPUB, or TXT</div>
              </div>
            )}
          </label>
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

        {/* ISBN and EDITION side by side */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              ISBN
            </label>
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
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Edition
            </label>
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
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Description
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="A brief description of what students will learn..."
            rows={3}
            disabled={status === 'uploading'}
            className="w-full bg-gray-950 border border-gray-700 text-white placeholder-gray-600 px-4 py-3 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors resize-none"
          />
        </div>

        {/* PRICE and ROYALTY side by side */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Price (USD) <span className="text-indigo-400">*</span>
            </label>
            <div className="relative">
              {/* dollar sign prefix inside the input */}
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
              {/* percent sign suffix */}
              <span className="absolute right-4 top-3.5 text-gray-500">%</span>
            </div>
            <p className="text-gray-600 text-xs mt-1">
              You earn this % every time a student resells your book
            </p>
          </div>
        </div>

        {/* UPLOAD BUTTON */}
        <button
          onClick={handleUpload}
          disabled={!isFormValid() || status === 'uploading' || status === 'done'}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white py-3 rounded-lg font-medium transition-colors"
        >
          {status === 'uploading' && 'Uploading... ' + progress + '%'}
          {status === 'done'      && 'Upload complete ✓'}
          {status === 'idle'      && 'Upload to Arweave'}
          {status === 'error'     && 'Try again'}
        </button>

        {/* PROGRESS BAR — only visible while uploading */}
        {status === 'uploading' && (
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div
              className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: progress + '%' }}
            />
          </div>
        )}

        {/* SUCCESS RESULT */}
        {status === 'done' && txId && (
          <div className="bg-green-950 border border-green-800 rounded-xl p-6 space-y-3">
            <div className="text-green-400 font-medium">Upload complete</div>
            <div>
              <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
                Arweave transaction ID
              </div>
              <code className="text-green-300 text-xs break-all">{txId}</code>
            </div>
            <a
              href={'https://arweave.net/' + txId}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
            >
              View on Arweave →
            </a>
          </div>
        )}

        {/* ERROR RESULT */}
        {status === 'error' && error && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-4">
            <div className="text-red-400 font-medium mb-1">Upload failed</div>
            <code className="text-red-300 text-xs">{error}</code>
          </div>
        )}

      </div>
    </div>
  )
}