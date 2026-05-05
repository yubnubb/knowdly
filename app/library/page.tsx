// app/library/page.tsx
// Student library page — queries Arweave GraphQL for all Knowdly books
// 'use client' because we need useState and useEffect for search and fetching

'use client'

import { useState, useEffect } from 'react'
import PurchaseModal from '../components/PurchaseModal'


// TypeScript type matching what our API route returns
type Book = {
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

export default function LibraryPage() {

  // all books returned from Arweave
  const [books, setBooks] = useState<Book[]>([])

  // current search term typed by the student
  const [search, setSearch] = useState('')

  // tracks whether we are loading books from the API
  const [loading, setLoading] = useState(true)

  // any error message if the query fails
  const [error, setError] = useState<string | null>(null)

  // the book the student is currently trying to purchase
  // null means the modal is closed
  const [purchasingBook, setPurchasingBook] = useState<Book | null>(null)

  // load owned books from localStorage on mount so they survive navigation
  const [ownedBooks, setOwnedBooks] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const stored = localStorage.getItem('knowdly_owned_books')
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch {
      return new Set()
    }
  })
  
  // fetchBooks calls our /api/books route which queries Arweave GraphQL
  // optionally filtered by a search term
  async function fetchBooks(searchTerm: string) {
    setLoading(true)
    setError(null)

    try {
      // build the URL with optional search param
      const url = searchTerm.trim() !== ''
        ? '/api/books?search=' + encodeURIComponent(searchTerm)
        : '/api/books'

      const response = await fetch(url)
      const data     = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load books')
      }

      // update the books list with what Arweave returned
      setBooks(data.books)

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load books'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  // load all books when the page first mounts
  useEffect(() => {
    fetchBooks('')
  }, [])

  // handle search input — fetch with new search term
  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const term = e.target.value
    setSearch(term)

    // debounce — wait 500ms after the student stops typing
    // before sending the query to avoid hammering the API
    const timer = setTimeout(() => {
      fetchBooks(term)
    }, 500)

    // clear the previous timer if they keep typing
    return () => clearTimeout(timer)
  }

  return (
    <div>

      {/* ── PAGE HEADER ───────────────────────────────────────────────────── */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-3">
          Library
        </h1>
        <p className="text-gray-400">
          Browse and purchase textbooks. Every book is permanently stored
          on Arweave and owned by its author.
        </p>
      </div>

      {/* ── SEARCH AND FILTER BAR ─────────────────────────────────────────── */}
      <div className="flex gap-4 mb-8 flex-wrap">

        {/* search input — triggers live search as student types */}
        <input
          type="text"
          value={search}
          onChange={handleSearch}
          placeholder="Search by title, author, or ISBN..."
          className="flex-1 min-w-64 bg-gray-900 border border-gray-700 text-white placeholder-gray-500 px-4 py-2.5 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors"
        />

        {/* subject filter dropdown — filtering logic to add later */}
        <select className="bg-gray-900 border border-gray-700 text-gray-300 px-4 py-2.5 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors">
          <option value="">All subjects</option>
          <option value="cs">Computer Science</option>
          <option value="math">Mathematics</option>
          <option value="physics">Physics</option>
          <option value="biology">Biology</option>
          <option value="chemistry">Chemistry</option>
          <option value="economics">Economics</option>
          <option value="philosophy">Philosophy</option>
        </select>

        {/* sort dropdown — sorting logic to add later */}
        <select className="bg-gray-900 border border-gray-700 text-gray-300 px-4 py-2.5 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors">
          <option value="recent">Most recent</option>
          <option value="price-low">Price: low to high</option>
          <option value="price-high">Price: high to low</option>
          <option value="title">Title A-Z</option>
        </select>
      </div>

      {/* ── LOADING STATE ─────────────────────────────────────────────────── */}
      {loading && (
        <div className="text-center py-20">
          <div className="text-gray-500 text-sm animate-pulse">
            Querying Arweave network...
          </div>
        </div>
      )}

      {/* ── ERROR STATE ───────────────────────────────────────────────────── */}
      {error && !loading && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4 mb-6">
          <div className="text-red-400 font-medium mb-1">Failed to load books</div>
          <code className="text-red-300 text-xs">{error}</code>
          <button
            onClick={() => fetchBooks(search)}
            className="ml-4 text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* ── RESULTS COUNT ─────────────────────────────────────────────────── */}
      {!loading && !error && (
        <div className="text-gray-500 text-sm mb-6">
          {books.length} {books.length === 1 ? 'book' : 'books'} found
          {search && ' for "' + search + '"'}
        </div>
      )}

      {/* ── BOOK GRID ─────────────────────────────────────────────────────── */}
      {!loading && !error && books.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {books.map((book) => (
            <div
              key={book.txId}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col gap-4 hover:border-gray-700 transition-colors"
            >

              {/* book cover placeholder */}
              <div className="w-full h-40 bg-gray-800 rounded-xl flex items-center justify-center">
                <span className="text-5xl">📖</span>
              </div>

              {/* book metadata */}
              <div className="flex-1">
                <h2 className="text-white font-semibold leading-snug mb-1 line-clamp-2">
                  {book.title}
                </h2>
                <p className="text-gray-400 text-sm mb-1">
                  {book.author}
                </p>
                <p className="text-gray-600 text-xs mb-3">
                  {book.edition && book.edition + ' edition · '}
                  {book.isbn && 'ISBN ' + book.isbn}
                </p>
                <p className="text-gray-500 text-sm leading-relaxed line-clamp-3">
                  {book.description}
                </p>
              </div>

             {/* price and purchase */}
              <div className="flex items-center justify-between pt-2 border-t border-gray-800">
                <div>
                  <div className="text-white font-bold text-lg">
                    {book.price ? '$' + book.price : 'Free'}
                  </div>
                  {book.royalty && (
                    <div className="text-gray-600 text-xs">
                      {book.royalty}% resale royalty to author
                    </div>
                  )}
                </div>

                {/* purchase or read button — never nested */}
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

              {/* arweave transaction link */}
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

      {/* ── EMPTY STATE ───────────────────────────────────────────────────── */}
      {!loading && !error && books.length === 0 && (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">📚</div>
          <div className="text-gray-400 text-lg mb-2">
            {search ? 'No books found for "' + search + '"' : 'No books yet'}
          </div>
          <div className="text-gray-600 text-sm">
            {search ? 'Try a different search term' : 'Be the first to upload a textbook'}
          </div>
        </div>
      )}

      {/* ── BOTTOM CTA ────────────────────────────────────────────────────── */}
      <div className="border border-gray-800 rounded-2xl p-8 text-center mt-8">
        <h3 className="text-white font-semibold mb-2">
          Are you a professor?
        </h3>
        <p className="text-gray-400 text-sm mb-4">
          Upload your textbook and start earning fair royalties on every sale and resale.
        </p>
        <a
          href="/upload"
          className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          Upload your textbook
        </a>
      </div>
      {/* purchase modal — shown when student clicks Purchase */}
      <PurchaseModal
        book={purchasingBook}
        onClose={() => setPurchasingBook(null)}
        onSuccess={(book) => {
          setOwnedBooks(prev => {
            const updated = new Set(prev).add(book.txId)
            // persist to localStorage so Read button survives navigation
            localStorage.setItem(
              'knowdly_owned_books',
              JSON.stringify(Array.from(updated))
            )
            return updated
          })
          setTimeout(() => setPurchasingBook(null), 2000)
        }}
      />
    </div>
  )
}