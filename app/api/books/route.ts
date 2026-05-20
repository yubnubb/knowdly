// app/api/books/route.ts
// Server-side API route that queries ArLocal GraphQL for all Knowdly books
// In production change ARWEAVE_GRAPHQL to https://arweave.net/graphql

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ARWEAVE_GRAPHQL = process.env.ARWEAVE_GRAPHQL ?? 'https://arweave.net/graphql'

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
  contentFormat: string  // PDF | EPUB | TXT
  contentMime:   string  // original MIME type for blob reconstruction
  category:      string  // novel | textbook | etc.
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tag(tags: Tag[], name: string): string {
  return tags.find(t => t.name === name)?.value || ''
}

// supports both old tag schema (Book-Title) and new schema (Title)
// so uploads from before the tag rename still appear in the library
function toBook(node: Node): Book {
  const tags = node.tags
  return {
    txId:          node.id,
    title:         tag(tags, 'Title')        || tag(tags, 'Book-Title'),
    author:        tag(tags, 'Author')       || tag(tags, 'Book-Author'),
    isbn:          tag(tags, 'ISBN')         || tag(tags, 'Book-ISBN'),
    edition:       tag(tags, 'Edition')      || tag(tags, 'Book-Edition'),
    description:   tag(tags, 'Description'),
    price:         tag(tags, 'Price')        || tag(tags, 'Book-Price'),
    royalty:       tag(tags, 'Royalty')      || tag(tags, 'Book-Royalty'),
    fileName:      tag(tags, 'File-Name'),
    contentType:   tag(tags, 'Content-Type'),
    contentFormat: tag(tags, 'Content-Format') || 'PDF',
    contentMime:   tag(tags, 'Content-Mime')   || 'application/pdf',
    category:      tag(tags, 'Category'),
  }
}

// ── GET /api/books ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {

    const { searchParams } = new URL(request.url)
    const search   = searchParams.get('search')   || ''
    const category = searchParams.get('category') || ''
    const format   = searchParams.get('format')   || ''

    const query = `
      query {
        transactions(
          first: 100
          sort: HEIGHT_DESC
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
      throw new Error('GraphQL request failed: ' + response.status)
    }

    const json  = await response.json()
    const edges = json?.data?.transactions?.edges || []

    let books: Book[] = []

    for (const edge of edges) {
      const node: Node = edge.node

      // must be a Knowdly upload
      if (tag(node.tags, 'App-Name') !== 'Knowdly') continue

      // must have a title — supports both old and new tag names
      const title = tag(node.tags, 'Title') || tag(node.tags, 'Book-Title')
      if (!title) continue

      books.push(toBook(node))
    }

    // filter by search term
    if (search.trim()) {
      const term = search.toLowerCase()
      books = books.filter(b =>
        b.title.toLowerCase().includes(term)    ||
        b.author.toLowerCase().includes(term)   ||
        b.category.toLowerCase().includes(term) ||
        b.isbn.toLowerCase().includes(term)
      )
    }

    // filter by category
    if (category.trim()) {
      books = books.filter(b =>
        b.category.toLowerCase() === category.toLowerCase()
      )
    }

    // filter by format
    if (format.trim()) {
      books = books.filter(b =>
        b.contentFormat.toLowerCase() === format.toLowerCase()
      )
    }

    console.log(`Arweave query returned ${books.length} books`)

    return NextResponse.json({ books })

  } catch (err) {
    console.error('Arweave GraphQL error:', err)
    const message = err instanceof Error ? err.message : 'Query failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}