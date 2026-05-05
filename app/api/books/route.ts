// app/api/books/route.ts
// Server-side API route that queries ArLocal GraphQL for all Knowdly books
// In production change ARWEAVE_GRAPHQL to https://arweave.net/graphql

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ArLocal GraphQL endpoint for local development
// change to https://arweave.net/graphql for production
const ARWEAVE_GRAPHQL = 'http://localhost:1984/graphql'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tag = {
  name:  string
  value: string
}

type Node = {
  id:   string
  tags: Tag[]
}

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

// ── Helper ────────────────────────────────────────────────────────────────────

// extract a tag value by name from a tags array
function tag(tags: Tag[], name: string): string {
  const found = tags.find(t => t.name === name)
  return found ? found.value : ''
}

// convert a raw Arweave node into a clean Book object
function toBook(node: Node): Book {
  return {
    txId:        node.id,
    title:       tag(node.tags, 'Book-Title'),
    author:      tag(node.tags, 'Book-Author'),
    isbn:        tag(node.tags, 'Book-ISBN'),
    edition:     tag(node.tags, 'Book-Edition'),
    description: tag(node.tags, 'Description'),
    price:       tag(node.tags, 'Book-Price'),
    royalty:     tag(node.tags, 'Book-Royalty'),
    fileName:    tag(node.tags, 'File-Name'),
    contentType: tag(node.tags, 'Content-Type'),
  }
}

// ── GET /api/books ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {

    // optional search term from query string e.g. /api/books?search=quantum
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''

    // fetch ALL transactions from ArLocal without tag filter
    // ArLocal does not support tag filtering in GraphQL queries
    // we filter by App-Name: Knowdly in JavaScript below
    const query = `
      query {
        transactions(
          first: 100
          sort: HEIGHT_DESC
        ) {
          edges {
            node {
              id
              tags {
                name
                value
              }
            }
          }
        }
      }
    `

    // send the GraphQL query to ArLocal
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

    // build books array — filter to only Knowdly books with a title
    let books: Book[] = []

    for (const edge of edges) {
      const node: Node = edge.node

      // skip if not a Knowdly upload
      if (tag(node.tags, 'App-Name') !== 'Knowdly') continue

      // skip if no title — not a book upload
      const title = tag(node.tags, 'Book-Title')
      if (!title) continue

      books.push(toBook(node))
    }

    // apply search filter if provided
    if (search.trim()) {
      const term = search.toLowerCase()
      books = books.filter(b =>
        b.title.toLowerCase().includes(term)  ||
        b.author.toLowerCase().includes(term) ||
        b.isbn.toLowerCase().includes(term)
      )
    }

    console.log('Arweave query returned ' + books.length + ' books')

    return NextResponse.json({ books })

  } catch (err) {
    console.error('Arweave GraphQL error:', err)
    const message = err instanceof Error ? err.message : 'Query failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}