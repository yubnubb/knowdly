// app/api/upload/route.ts
// Server-side API route that handles Arweave uploads
// Uses environment variables so the same code works in dev and production
//
// .env.local (dev):
//   ARWEAVE_HOST=localhost
//   ARWEAVE_PORT=1984
//   ARWEAVE_PROTOCOL=http
//   ARWEAVE_JWK=        ← leave empty, ArLocal auto-funds
//
// Production env vars:
//   ARWEAVE_HOST=arweave.net
//   ARWEAVE_PORT=443
//   ARWEAVE_PROTOCOL=https
//   ARWEAVE_JWK={"kty":"RSA",...}  ← your funded wallet JWK

import { NextRequest, NextResponse } from 'next/server'
import Arweave from 'arweave'

export const runtime   = 'nodejs'
export const dynamic   = 'force-dynamic'
export const maxDuration = 60

// ── Arweave config from environment ──────────────────────────────────────────

const ARWEAVE_HOST     = process.env.ARWEAVE_HOST     ?? 'localhost'
const ARWEAVE_PORT     = parseInt(process.env.ARWEAVE_PORT ?? '1984')
const ARWEAVE_PROTOCOL = process.env.ARWEAVE_PROTOCOL ?? 'http'
const ARWEAVE_GATEWAY  = `${ARWEAVE_PROTOCOL}://${ARWEAVE_HOST}${ARWEAVE_PORT !== 443 && ARWEAVE_PORT !== 80 ? ':' + ARWEAVE_PORT : ''}`
const IS_LOCAL         = ARWEAVE_HOST === 'localhost'

// POST /api/upload
export async function POST(request: NextRequest) {
  try {

    const formData = await request.formData()

    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    console.log('Received file name:', file.name)
    console.log('Received file size:', file.size)
    console.log('Received file type:', file.type)

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

    // initialise Arweave from environment variables
    const arweave = Arweave.init({
      host:     ARWEAVE_HOST,
      port:     ARWEAVE_PORT,
      protocol: ARWEAVE_PROTOCOL,
    })

    // ── Wallet setup ──────────────────────────────────────────────────────────
    // Dev:        generate a throwaway wallet and auto-fund via ArLocal faucet
    // Production: use the funded wallet from ARWEAVE_JWK env var
    let jwk: any

    if (IS_LOCAL) {
      jwk             = await arweave.wallets.generate()
      const address   = await arweave.wallets.getAddress(jwk)
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

    // ── Arweave tags ─────────────────────────────────────────────────────────
    transaction.addTag('Content-Type',    'application/octet-stream')
    transaction.addTag('App-Name',        'Knowdly')
    transaction.addTag('Content-Format',  contentFormat)
    transaction.addTag('Content-Mime',    contentMime)
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

    // ── Chunked upload ────────────────────────────────────────────────────────
    const uploader = await arweave.transactions.getUploader(transaction)

    while (!uploader.isComplete) {
      await uploader.uploadChunk()
      console.log(
        `Upload progress: ${uploader.pctComplete}% ` +
        `(chunk ${uploader.uploadedChunks}/${uploader.totalChunks})`
      )
    }

    // mine immediately in dev so GraphQL indexes it
    if (IS_LOCAL) {
      await fetch(`${ARWEAVE_GATEWAY}/mine`)
    }

    console.log('Arweave upload successful. TX ID:', transaction.id)
    return NextResponse.json({ txId: transaction.id })

  } catch (err) {
    console.error('Arweave upload error:', err)
    const message = err instanceof Error ? err.message : 'Upload failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}