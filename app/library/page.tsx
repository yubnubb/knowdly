// app/library/page.tsx
// Student library page — queries Arweave GraphQL for all Knowdly books
// 'use client' because we need useState and useEffect for search and fetching

'use client'

import { useState, useEffect, useCallback } from 'react'
import PurchaseModal from '../components/PurchaseModal'
import { getTokensByOwner, getToken, getBookArweaveTxId } from '../lib/contract'

// ── Types ─────────────────────────────────────────────────────────────────────

type Book = {
  txId:          string
  title:         string
  author:        string
  isbn:          string
  edition:       string
  description:   string
  price:         string
  royalty:       string
  fileName:      string
  contentType:   string
  contentFormat: string  // PDF | EPUB | TXT
  contentMime:   string
  category:      string
  sorobanBookId: number  // on-chain book ID — passed to purchase modal directly
}

type SortOption = 'recent' | 'price-low' | 'price-high' | 'title'

// ── Helpers ───────────────────────────────────────────────────────────────────

// format badge color
function formatBadge(fmt: string) {
  if (fmt === 'EPUB') return 'bg-purple-900 text-purple-300'
  if (fmt === 'PDF')  return 'bg-indigo-900 text-indigo-300'
  return 'bg-gray-800 text-gray-400'
}

// sort books client-side
function sortBooks(books: Book[], sort: SortOption): Book[] {
  const copy = [...books]
  switch (sort) {
    case 'price-low':  return copy.sort((a,b) => parseFloat(a.price||'0') - parseFloat(b.price||'0'))
    case 'price-high': return copy.sort((a,b) => parseFloat(b.price||'0') - parseFloat(a.price||'0'))
    case 'title':      return copy.sort((a,b) => a.title.localeCompare(b.title))
    default:           return copy // recent = Arweave HEIGHT_DESC order
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LibraryPage() {

  const [books,          setBooks]          = useState<Book[]>([])
  const [search,         setSearch]         = useState('')
  const [category,       setCategory]       = useState('')
  const [format,         setFormat]         = useState('')
  const [sort,           setSort]           = useState<SortOption>('recent')
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState<string | null>(null)
  const [purchasingBook, setPurchasingBook] = useState<Book | null>(null)
  const [walletAddress,  setWalletAddress]  = useState<string | null>(null)
  const [ownedBooks,     setOwnedBooks]     = useState<Set<string>>(new Set())

  // ── Fetch ───────────────────────────────────────────────────────────────────

  const fetchBooks = useCallback(async (
    searchTerm: string,
    cat: string,
    fmt: string,
  ) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (searchTerm.trim()) params.set('search',   searchTerm.trim())
      if (cat.trim())         params.set('category', cat.trim())
      if (fmt.trim())         params.set('format',   fmt.trim())

      const url      = '/api/books' + (params.toString() ? '?' + params.toString() : '')
      const response = await fetch(url)
      const data     = await response.json()

      if (!response.ok) throw new Error(data.error || 'Failed to load books')

      // enrich books with sorobanBookId from localStorage map
      // works for books uploaded on this device
      // books uploaded on other devices will have sorobanBookId -1 until
      // we move the bookId fully on-chain
      const bookIdMap = JSON.parse(localStorage.getItem('knowdly_book_ids') || '{}')
      const enriched  = (data.books as Book[]).map(b => ({
        ...b,
        sorobanBookId: bookIdMap[b.txId] !== undefined ? Number(bookIdMap[b.txId]) : -1,
      }))
      setBooks(enriched)

      // load localStorage ownership cache
      const stored = localStorage.getItem('knowdly_owned_books')
      if (stored) setOwnedBooks(new Set(JSON.parse(stored)))

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load books')
    } finally {
      setLoading(false)
    }
  }, [])

  // initial load
  useEffect(() => { fetchBooks('', '', '') }, [fetchBooks])

  // re-fetch when category or format filter changes
  useEffect(() => { fetchBooks(search, category, format) }, [category, format])

  // ── Wallet ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function checkWallet() {
      try {
        const { requestAccess } = await import('@stellar/freighter-api')
        const result = await requestAccess()
        if (!result.error && result.address) {
          setWalletAddress(result.address)
          const key    = `knowdly_owned_books_${result.address}`
          const stored = localStorage.getItem(key)
          setOwnedBooks(stored ? new Set(JSON.parse(stored)) : new Set())
        }
      } catch { /* wallet not connected */ }
    }
    checkWallet()
  }, [])

  // on-chain ownership check after wallet + books are ready
  useEffect(() => {
    if (walletAddress && books.length > 0) checkOnChainOwnership(walletAddress, books)
  }, [walletAddress, books])

  // ── Search debounce ─────────────────────────────────────────────────────────

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const term = e.target.value
    setSearch(term)
    const timer = setTimeout(() => fetchBooks(term, category, format), 500)
    return () => clearTimeout(timer)
  }

  // ── On-chain ownership via NFT tokens ──────────────────────────────────────
  // Works on any device — no localStorage dependency for ownership discovery

  async function checkOnChainOwnership(walletAddr: string, bookList: Book[]) {
  try {
    // get all token IDs owned by this wallet — pure on-chain NFT lookup
    const tokenIds = await getTokensByOwner(walletAddr)
    if (tokenIds.length === 0) return

    // for each token get the bookId, then get the arweaveTxId from the contract
    const onChainOwned = new Set<string>()

    await Promise.all(tokenIds.map(async id => {
  try {
    console.log('Fetching token:', id)
    const token = await getToken(walletAddr, id)
    console.log('Token result:', id, token)
    if (!token) return

    console.log('Fetching arweaveTxId for bookId:', token.bookId)
    const arweaveTxId = await getBookArweaveTxId(walletAddr, token.bookId)
    console.log('ArweaveTxId result:', arweaveTxId)
    
    if (arweaveTxId) {
      onChainOwned.add(arweaveTxId)
    }
  } catch (err) {
    console.error('Error processing token', id, ':', err)
  }
}))

    if (onChainOwned.size > 0) {
      setOwnedBooks(prev => {
        const updated = new Set([...prev, ...onChainOwned])
        const key = `knowdly_owned_books_${walletAddr}`
        localStorage.setItem(key, JSON.stringify(Array.from(updated)))
        return updated
      })
    }
  } catch (err) {
    console.error('On-chain ownership check failed:', err)
  }
}

  // ── Derived ─────────────────────────────────────────────────────────────────

  const displayBooks = sortBooks(books, sort)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* PAGE HEADER */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-3">Library</h1>
        <p className="text-gray-400">
          Browse and purchase books. Every title is permanently stored
          on Arweave and owned by its author.
        </p>
      </div>

      {/* FILTER BAR */}
      <div className="flex gap-3 mb-8 flex-wrap">

        {/* search */}
        <input
          type="text"
          value={search}
          onChange={handleSearch}
          placeholder="Search by title, author, or ISBN..."
          className="flex-1 min-w-64 bg-gray-900 border border-gray-700 text-white placeholder-gray-500 px-4 py-2.5 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
        />

        {/* category filter — real Arweave tag values */}
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="bg-gray-900 border border-gray-700 text-gray-300 px-4 py-2.5 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
        >
          <option value="">All categories</option>
          <option value="textbook">Textbook</option>
          <option value="novel">Novel</option>
          <option value="research paper">Research Paper</option>
          <option value="essay collection">Essay Collection</option>
          <option value="course notes">Course Notes</option>
          <option value="reference">Reference</option>
          <option value="other">Other</option>
        </select>

        {/* format filter */}
        <select
          value={format}
          onChange={e => setFormat(e.target.value)}
          className="bg-gray-900 border border-gray-700 text-gray-300 px-4 py-2.5 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
        >
          <option value="">All formats</option>
          <option value="PDF">PDF</option>
          <option value="EPUB">EPUB</option>
          <option value="TXT">TXT</option>
        </select>

        {/* sort */}
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortOption)}
          className="bg-gray-900 border border-gray-700 text-gray-300 px-4 py-2.5 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
        >
          <option value="recent">Most recent</option>
          <option value="price-low">Price: low to high</option>
          <option value="price-high">Price: high to low</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>

      {/* LOADING */}
      {loading && (
        <div className="text-center py-20">
          <div className="text-gray-500 text-sm animate-pulse">
            Querying Arweave network...
          </div>
        </div>
      )}

      {/* ERROR */}
      {error && !loading && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4 mb-6">
          <div className="text-red-400 font-medium mb-1">Failed to load books</div>
          <code className="text-red-300 text-xs">{error}</code>
          <button
            onClick={() => fetchBooks(search, category, format)}
            className="ml-4 text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* RESULTS COUNT */}
      {!loading && !error && (
        <div className="text-gray-500 text-sm mb-6">
          {displayBooks.length} {displayBooks.length === 1 ? 'book' : 'books'} found
          {search    && ` for "${search}"`}
          {category  && ` · ${category}`}
          {format    && ` · ${format}`}
        </div>
      )}

      {/* BOOK GRID */}
      {!loading && !error && displayBooks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {displayBooks.map(book => (
            <div
              key={book.txId}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col gap-4 hover:border-gray-700 transition-colors"
            >
              {/* cover placeholder */}
              <div className="w-full h-40 bg-gray-800 rounded-xl flex items-center justify-center relative">
                <span className="text-5xl">📖</span>
                {/* format badge */}
                {book.contentFormat && (
                  <span className={`absolute top-3 right-3 text-xs font-semibold px-2 py-0.5 rounded ${formatBadge(book.contentFormat)}`}>
                    {book.contentFormat}
                  </span>
                )}
              </div>

              {/* metadata */}
              <div className="flex-1">
                <h2 className="text-white font-semibold leading-snug mb-1 line-clamp-2">
                  {book.title}
                </h2>
                <p className="text-gray-400 text-sm mb-1">{book.author}</p>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {book.category && (
                    <span className="text-xs text-indigo-400 capitalize bg-indigo-950 px-2 py-0.5 rounded">
                      {book.category}
                    </span>
                  )}
                  <p className="text-gray-600 text-xs">
                    {book.edition && book.edition + ' edition'}
                    {book.edition && book.isbn && ' · '}
                    {book.isbn && 'ISBN ' + book.isbn}
                  </p>
                </div>
                <p className="text-gray-500 text-sm leading-relaxed line-clamp-3">
                  {book.description}
                </p>
              </div>

              {/* price + action */}
              <div className="flex items-center justify-between pt-2 border-t border-gray-800">
                <div>
                  <div className="text-white font-bold text-lg">
                    {book.price ? '$' + book.price : 'Free'}
                  </div>
                  {book.royalty && (
                    <div className="text-gray-600 text-xs">
                      {book.royalty}% resale royalty
                    </div>
                  )}
                </div>

                {ownedBooks.has(book.txId) ? (
                  <a
                    href={'/reader/' + book.txId}
                    className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    Read →
                  </a>
                ) : (
                  <button
                    onClick={() => setPurchasingBook(book)}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    Purchase
                  </button>
                )}
              </div>

              {/* arweave link */}
              <a
                href={'https://arweave.net/' + book.txId}
                target="_blank"
                rel="noreferrer"
                className="text-gray-700 hover:text-gray-500 text-xs transition-colors truncate"
              >
                ar://{book.txId}
              </a>
            </div>
          ))}
        </div>
      )}

      {/* EMPTY STATE */}
      {!loading && !error && displayBooks.length === 0 && (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">📚</div>
          <div className="text-gray-400 text-lg mb-2">
            {search ? `No books found for "${search}"` : 'No books yet'}
          </div>
          <div className="text-gray-600 text-sm">
            {search ? 'Try a different search term' : 'Be the first to upload a book'}
          </div>
        </div>
      )}

      {/* BOTTOM CTA */}
      <div className="border border-gray-800 rounded-2xl p-8 text-center mt-8">
        <h3 className="text-white font-semibold mb-2">Are you a creator?</h3>
        <p className="text-gray-400 text-sm mb-4">
          Upload your book and start earning fair royalties on every sale and resale.
        </p>
        <a
          href="/upload"
          className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          Upload your book
        </a>
      </div>

      {/* PURCHASE MODAL */}
      <PurchaseModal
        book={purchasingBook}
        onClose={() => setPurchasingBook(null)}
        onSuccess={book => {
          setOwnedBooks(prev => {
            const updated = new Set(prev).add(book.txId)
            if (walletAddress) {
              const key = `knowdly_owned_books_${walletAddress}`
              localStorage.setItem(key, JSON.stringify(Array.from(updated)))
            }
            return updated
          })
          setTimeout(() => setPurchasingBook(null), 2000)
        }}
      />
    </div>
  )
}