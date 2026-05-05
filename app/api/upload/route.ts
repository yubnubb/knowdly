// app/api/upload/route.ts
// Server-side API route that handles Arweave uploads
// In dev mode this points at ArLocal running on localhost:1984
// In production change host/port/protocol to arweave.net/443/https

import { NextRequest, NextResponse } from 'next/server'
import Arweave from 'arweave'

// Tell Next.js to use the Node.js runtime
export const runtime = 'nodejs'

// Never cache this route — every upload is a fresh request
export const dynamic = 'force-dynamic'

// POST /api/upload
// receives multipart form data from the upload page
// returns { txId: string } on success or { error: string } on failure
export async function POST(request: NextRequest) {
  try {

    // parse the incoming multipart form data
    const formData = await request.formData()

    // extract the file
    const file = formData.get('file') as File | null

    // extract book metadata
    const title       = formData.get('title')       as string || ''
    const author      = formData.get('author')      as string || ''
    const isbn        = formData.get('isbn')        as string || ''
    const edition     = formData.get('edition')     as string || ''
    const description = formData.get('description') as string || ''
    const price       = formData.get('price')       as string || '0'
    const royalty     = formData.get('royalty')     as string || '5'

    // validate required fields
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    if (!title || !author) {
      return NextResponse.json(
        { error: 'Title and author are required' },
        { status: 400 }
      )
    }

    // convert the File object to a Buffer Node.js can work with
    const arrayBuffer = await file.arrayBuffer()
    const fileBuffer  = Buffer.from(arrayBuffer)

    // initialise Arweave pointing at ArLocal for local development
    // to switch to mainnet change these three values:
    //   host:     'arweave.net'
    //   port:     443
    //   protocol: 'https'
    const arweave = Arweave.init({
      host:     'localhost',
      port:     1984,
      protocol: 'http',
    })

  // generate a throwaway wallet
    const jwk = await arweave.wallets.generate()

    // get the wallet address
    const address = await arweave.wallets.getAddress(jwk)

    // fund the wallet with test AR tokens from ArLocal's faucet
    // ArLocal has a built in faucet endpoint that gives free test tokens
    // this is only needed on ArLocal — mainnet wallets need real AR
    await fetch('http://localhost:1984/mint/' + address + '/1000000000000')

    // mine a block so the balance is confirmed before we upload
    await fetch('http://localhost:1984/mine')

    // create the Arweave transaction with the file data
    const transaction = await arweave.createTransaction({
      data: fileBuffer,
    }, jwk)

    // add metadata tags
    transaction.addTag('Content-Type', file.type || 'application/octet-stream')
    transaction.addTag('App-Name',     'Knowdly')
    transaction.addTag('File-Name',    file.name)
    transaction.addTag('Book-Title',   title)
    transaction.addTag('Book-Author',  author)
    transaction.addTag('Book-ISBN',    isbn)
    transaction.addTag('Book-Edition', edition)
    transaction.addTag('Book-Price',   price)
    transaction.addTag('Book-Royalty', royalty)
    transaction.addTag('Description',  description)

    // sign the transaction with our funded wallet
    await arweave.transactions.sign(transaction, jwk)

    // post the transaction to ArLocal
    const response = await arweave.transactions.post(transaction)

    if (response.status !== 200 && response.status !== 202) {
      throw new Error('Arweave post failed with status: ' + response.status)
    }

    // mine the block so GraphQL indexes it immediately
    await fetch('http://localhost:1984/mine')

    console.log('ArLocal upload successful. TX ID:', transaction.id)

    return NextResponse.json({ txId: transaction.id })

  } catch (err) {
    console.error('Arweave upload error:', err)
    const message = err instanceof Error ? err.message : 'Upload failed'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}