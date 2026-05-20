// app/api/upload/route.ts
// Server-side API route that handles Arweave uploads
// Uses dual indexing — writes to both Arweave tags and Supabase on every upload:
//
//   ┌─────────────────────────────────────────────────────┐
//   │  DECENTRALISED INDEX — Arweave tags                 │
//   │  Permanent, censorship-resistant, always available  │
//   │  Queried via GraphQL (10-30min indexing delay)      │
//   └─────────────────────────────────────────────────────┘
//   ┌─────────────────────────────────────────────────────┐
//   │  CENTRALISED INDEX — Supabase books table           │
//   │  Fast, instant, queryable immediately after upload  │
//   │  Cache only — Arweave is the source of truth        │
//   └─────────────────────────────────────────────────────┘
//
// Environment variables:
//   ARWEAVE_HOST, ARWEAVE_PORT, ARWEAVE_PROTOCOL, ARWEAVE_JWK
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

import { NextRequest, NextResponse } from 'next/server'
import Arweave from 'arweave'
import { createClient } from '@supabase/supabase-js'

export const runtime     = 'nodejs'
export const dynamic     = 'force-dynamic'
export const maxDuration = 60

// ── Arweave config ────────────────────────────────────────────────────────────

const ARWEAVE_HOST     = process.env.ARWEAVE_HOST     ?? 'localhost'
const ARWEAVE_PORT     = parseInt(process.env.ARWEAVE_PORT ?? '1984')
const ARWEAVE_PROTOCOL = process.env.ARWEAVE_PROTOCOL ?? 'http'
const ARWEAVE_GATEWAY  = `${ARWEAVE_PROTOCOL}://${ARWEAVE_HOST}${ARWEAVE_PORT !== 443 && ARWEAVE_PORT !== 80 ? ':' + ARWEAVE_PORT : ''}`
const IS_LOCAL         = ARWEAVE_HOST === 'localhost'

// ── Supabase client (server-side only) ───────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key)
}

// ── POST /api/upload ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {

    const formData = await request.formData()

    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    console.log('Received file name:', file.name)
    console.log('Received file size:', file.size)

    const title         = formData.get('title')         as string || ''
    const author        = formData.get('author')        as string || ''
    const isbn          = formData.get('isbn')          as string || ''
    const edition       = formData.get('edition')       as string || ''
    const description   = formData.get('description')   as string || ''
    const price         = formData.get('price')         as string || '0'
    const royalty       = formData.get('royalty')       as string || '5'
    const category      = formData.get('category')      as string || ''
    const contentFormat = formData.get('contentFormat') as string || 'PDF'
    const contentMime   = formData.get('contentMime')   as string || 'application/pdf'

    if (!title || !author) {
      return NextResponse.json(
        { error: 'Title and author are required' },
        { status: 400 }
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const fileBuffer  = Buffer.from(arrayBuffer)

    // ── Initialise Arweave ────────────────────────────────────────────────────

    const arweave = Arweave.init({
      host:     ARWEAVE_HOST,
      port:     ARWEAVE_PORT,
      protocol: ARWEAVE_PROTOCOL,
    })

    // ── Wallet setup ──────────────────────────────────────────────────────────
    // Dev:        throwaway wallet auto-funded via ArLocal faucet
    // Production: funded wallet from ARWEAVE_JWK env var

    let jwk: any

    if (IS_LOCAL) {
      jwk           = await arweave.wallets.generate()
      const address = await arweave.wallets.getAddress(jwk)
      await fetch(`${ARWEAVE_GATEWAY}/mint/${address}/1000000000000`)
      await fetch(`${ARWEAVE_GATEWAY}/mine`)
      console.log('ArLocal: funded throwaway wallet', address)
    } else {
      const jwkStr = process.env.ARWEAVE_JWK
      if (!jwkStr) throw new Error('ARWEAVE_JWK environment variable is required for production')
      jwk = JSON.parse(jwkStr)
      const address = await arweave.wallets.getAddress(jwk)
      console.log('Mainnet: using wallet', address)
    }

    const transaction = await arweave.createTransaction({ data: fileBuffer }, jwk)

    // ── DECENTRALISED INDEX — Arweave tags ────────────────────────────────────
    // These tags are permanently attached to the transaction on Arweave.
    // They are the source of truth for all book metadata.
    // Queryable via GraphQL at https://arweave.net/graphql
    // Note: new transactions take 10-30 minutes to appear in the GraphQL index.

    transaction.addTag('Content-Type',    'application/octet-stream')
    transaction.addTag('App-Name',        'Knowdly')
    transaction.addTag('Content-Format',  contentFormat)   // PDF | EPUB | TXT
    transaction.addTag('Content-Mime',    contentMime)     // original MIME type
    transaction.addTag('Title',           title)
    transaction.addTag('Author',          author)
    transaction.addTag('Category',        category)
    transaction.addTag('ISBN',            isbn)
    transaction.addTag('Edition',         edition)
    transaction.addTag('Description',     description)
    transaction.addTag('Price',           price)
    transaction.addTag('Royalty',         royalty)
    transaction.addTag('File-Name',       file.name)

    await arweave.transactions.sign(transaction, jwk)

    // ── Chunked upload to Arweave ─────────────────────────────────────────────
    // Handles files of any size — required for files over 256KB on mainnet

    const uploader = await arweave.transactions.getUploader(transaction)

    while (!uploader.isComplete) {
      await uploader.uploadChunk()
      console.log(
        `Upload progress: ${uploader.pctComplete}% ` +
        `(chunk ${uploader.uploadedChunks}/${uploader.totalChunks})`
      )
    }

    // mine immediately in dev so ArLocal GraphQL indexes it
    if (IS_LOCAL) {
      await fetch(`${ARWEAVE_GATEWAY}/mine`)
    }

    console.log('Arweave upload successful. TX ID:', transaction.id)

    // ── CENTRALISED INDEX — Supabase books table ──────────────────────────────
    // Write book metadata to Supabase immediately after Arweave upload.
    // This allows the library to show the book instantly without waiting
    // for Arweave's GraphQL indexer (which takes 10-30 minutes on mainnet).
    //
    // This is a cache only — Arweave tags are the source of truth.
    // If Supabase fails, the book still exists on Arweave permanently.
    // The library falls back to Arweave GraphQL if Supabase is unavailable.

    try {
      const supabase = getSupabase()
      const { error: dbError } = await supabase
        .from('books')
        .upsert(
          {
            arweave_tx_id:  transaction.id,
            title,
            author,
            category,
            content_format: contentFormat,
            content_mime:   contentMime,
            price,
            royalty,
            isbn,
            edition,
            description,
            file_name:      file.name,
          },
          { onConflict: 'arweave_tx_id' }
        )

      if (dbError) {
        // log but don't fail — Arweave upload succeeded, Supabase is just a cache
        console.error('Supabase index write failed (non-fatal):', dbError.message)
      } else {
        console.log('Supabase index updated for TX:', transaction.id)
      }
    } catch (dbErr) {
      // Supabase failure is non-fatal — book is still on Arweave
      console.error('Supabase index error (non-fatal):', dbErr)
    }

    return NextResponse.json({ txId: transaction.id })

  } catch (err) {
    console.error('Arweave upload error:', err)
    const message = err instanceof Error ? err.message : 'Upload failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}