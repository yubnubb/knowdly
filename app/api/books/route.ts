// app/api/books/route.ts
// Queries the book catalogue using dual indexing strategy:
//
//   ┌─────────────────────────────────────────────────────┐
//   │  PRIMARY — Supabase centralised index               │
//   │  Instant response, no indexing delay                │
//   │  Written to on every upload                         │
//   │  Queried first on every library load                │
//   └─────────────────────────────────────────────────────┘
//        ↓ if Supabase fails or returns empty
//   ┌─────────────────────────────────────────────────────┐
//   │  FALLBACK — Arweave GraphQL decentralised index     │
//   │  Permanent, censorship-resistant                    │
//   │  10-30min indexing delay on mainnet                 │
//   │  Used when Supabase is unavailable                  │
//   └─────────────────────────────────────────────────────┘
//
// Results from both sources are merged and deduplicated by arweave_tx_id.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Arweave GraphQL endpoint ──────────────────────────────────────────────────
// Reads from env var — defaults to ArLocal for local dev
// Dev:        ARWEAVE_GRAPHQL=http://localhost:1984/graphql
// Production: ARWEAVE_GRAPHQL=https://arweave.net/graphql

const ARWEAVE_GRAPHQL = process.env.ARWEAVE_GRAPHQL ?? 'https://arweave.net/graphql'

// ── Supabase client ───────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key)
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Tag = { name: string; value: string }
type Node = { id: string; tags: Tag[] }

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
  contentFormat: string
  contentMime:   string
  category:      string
}

type SortOption = 'recent' | 'price-low' | 'price-high' | 'title'

// ── Helpers ───────────────────────────────────────────────────────────────────

function tag(tags: Tag[], name: string): string {
  return tags.find(t => t.name === name)?.value || ''
}

// supports both old tag schema (Book-Title) and new schema (Title)
function nodeToBook(node: Node): Book {
  const tags = node.tags
  return {
    txId:          node.id,
    title:         tag(tags, 'Title')          || tag(tags, 'Book-Title'),
    author:        tag(tags, 'Author')         || tag(tags, 'Book-Author'),
    isbn:          tag(tags, 'ISBN')           || tag(tags, 'Book-ISBN'),
    edition:       tag(tags, 'Edition')        || tag(tags, 'Book-Edition'),
    description:   tag(tags, 'Description'),
    price:         tag(tags, 'Price')          || tag(tags, 'Book-Price'),
    royalty:       tag(tags, 'Royalty')        || tag(tags, 'Book-Royalty'),
    fileName:      tag(tags, 'File-Name'),
    contentType:   tag(tags, 'Content-Type'),
    contentFormat: tag(tags, 'Content-Format') || 'PDF',
    contentMime:   tag(tags, 'Content-Mime')   || 'application/pdf',
    category:      tag(tags, 'Category'),
  }
}

function rowToBook(row: any): Book {
  return {
    txId:          row.arweave_tx_id,
    title:         row.title         || '',
    author:        row.author        || '',
    isbn:          row.isbn          || '',
    edition:       row.edition       || '',
    description:   row.description   || '',
    price:         row.price         || '0',
    royalty:       row.royalty       || '0',
    fileName:      row.file_name     || '',
    contentType:   'application/octet-stream',
    contentFormat: row.content_format || 'PDF',
    contentMime:   row.content_mime   || 'application/pdf',
    category:      row.category       || '',
  }
}

// ── CENTRALISED INDEX — query Supabase ────────────────────────────────────────
// Fast primary source — written to on every upload
// Returns books instantly with no GraphQL indexing delay

async function querySupabase(
  search:   string,
  category: string,
  format:   string,
): Promise<Book[]> {
  const supabase = getSupabase()

  let query = supabase
    .from('books')
    .select('*')
    .order('created_at', { ascending: false })

  // apply filters
  if (category.trim()) {
    query = query.ilike('category', category.trim())
  }
  if (format.trim()) {
    query = query.ilike('content_format', format.trim())
  }

  const { data, error } = await query

  if (error) {
    console.error('Supabase query error:', error.message)
    return []
  }

  let books = (data || []).map(rowToBook)

  // apply search filter client-side (Supabase full-text search is overkill for now)
  if (search.trim()) {
    const term = search.toLowerCase()
    books = books.filter(b =>
      b.title.toLowerCase().includes(term)    ||
      b.author.toLowerCase().includes(term)   ||
      b.category.toLowerCase().includes(term) ||
      b.isbn.toLowerCase().includes(term)
    )
  }

  console.log(`Supabase index returned ${books.length} books`)
  return books
}

// ── DECENTRALISED INDEX — query Arweave GraphQL ───────────────────────────────
// Permanent fallback — always available as long as Arweave exists
// Note: new transactions take 10-30 minutes to appear after upload on mainnet
// Used when Supabase is unavailable or returns no results

async function queryArweave(
  search:   string,
  category: string,
  format:   string,
): Promise<Book[]> {
  const query = `
    query {
      transactions(
        first: 100
        sort: HEIGHT_DESC
        tags: [{ name: "App-Name", values: ["Knowdly"] }]
      ) {
        edges {
          node {
            id
            tags { name value }
          }
        }
      }
    }
  `

  const response = await fetch(ARWEAVE_GRAPHQL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ query }),
  })

  if (!response.ok) {
    throw new Error('Arweave GraphQL request failed: ' + response.status)
  }

  const json  = await response.json()
  const edges = json?.data?.transactions?.edges || []

  let books: Book[] = []

  for (const edge of edges) {
    const node: Node = edge.node
    if (tag(node.tags, 'App-Name') !== 'Knowdly') continue
    const title = tag(node.tags, 'Title') || tag(node.tags, 'Book-Title')
    if (!title) continue
    books.push(nodeToBook(node))
  }

  // apply filters
  if (search.trim()) {
    const term = search.toLowerCase()
    books = books.filter(b =>
      b.title.toLowerCase().includes(term)    ||
      b.author.toLowerCase().includes(term)   ||
      b.category.toLowerCase().includes(term) ||
      b.isbn.toLowerCase().includes(term)
    )
  }
  if (category.trim()) {
    books = books.filter(b => b.category.toLowerCase() === category.toLowerCase())
  }
  if (format.trim()) {
    books = books.filter(b => b.contentFormat.toLowerCase() === format.toLowerCase())
  }

  console.log(`Arweave GraphQL index returned ${books.length} books`)
  return books
}

// ── GET /api/books ────────────────────────────────────────────────────────────
// Dual indexing strategy:
//   1. Query Supabase first (fast, centralised)
//   2. Query Arweave GraphQL as fallback (slow, decentralised)
//   3. Merge and deduplicate results by txId
//   4. Arweave results fill in any gaps Supabase might have missed

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const search   = searchParams.get('search')   || ''
    const category = searchParams.get('category') || ''
    const format   = searchParams.get('format')   || ''

    // ── Step 1: Query Supabase (primary centralised index) ────────────────────
    let supabaseBooks: Book[] = []
    try {
      supabaseBooks = await querySupabase(search, category, format)
    } catch (err) {
      console.error('Supabase query failed, falling back to Arweave:', err)
    }

    // ── Step 2: Query Arweave GraphQL (decentralised fallback) ────────────────
    // Always query Arweave to catch any books not yet in Supabase
    // (e.g. uploaded before dual indexing was enabled, or if Supabase write failed)
    let arweaveBooks: Book[] = []
    try {
      arweaveBooks = await queryArweave(search, category, format)
    } catch (err) {
      console.error('Arweave GraphQL query failed:', err)
    }

    // ── Step 3: Merge and deduplicate ─────────────────────────────────────────
    // Supabase results take priority (more complete metadata, faster)
    // Arweave results fill in any books not in Supabase
    const seen  = new Set<string>()
    const books: Book[] = []

    // add Supabase books first
    for (const book of supabaseBooks) {
      if (!seen.has(book.txId)) {
        seen.add(book.txId)
        books.push(book)
      }
    }

    // add any Arweave books not already in the list
    for (const book of arweaveBooks) {
      if (!seen.has(book.txId)) {
        seen.add(book.txId)
        books.push(book)
      }
    }

    console.log(`Total books after merge: ${books.length} (${supabaseBooks.length} from Supabase, ${arweaveBooks.length} from Arweave)`)

    return NextResponse.json({ books })

  } catch (err) {
    console.error('Books query error:', err)
    const message = err instanceof Error ? err.message : 'Query failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}