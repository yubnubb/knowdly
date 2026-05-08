// app/api/keys/route.ts
// Server-side key management — stores and releases AES-256 encryption keys
// Keys are only released to wallets that own the corresponding Soroban NFT
// This is the centralised key server we discussed — v2 will use Stellar ZK

import { NextRequest, NextResponse } from 'next/server'
import { Contract, Networks, TransactionBuilder, BASE_FEE, Account, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── In-memory key store ───────────────────────────────────────────────────────
// In production this would be a database (PostgreSQL, Redis etc)
// For now we use a Map that lives in server memory
// NOTE: this resets when the server restarts — use a real DB for production

const keyStore = new Map<string, {
  bookId:     number    // Soroban book ID
  arweaveTxId: string  // Arweave transaction ID
  key:        string   // AES-256 key as hex string
  iv:         string   // initialisation vector as hex string
}>()

// ── Stellar RPC config ────────────────────────────────────────────────────────

const RPC_URL     = 'https://soroban-testnet.stellar.org'
const NETWORK     = Networks.TESTNET
const CONTRACT_ID = 'CDZUALFCYWLHFDST3GY675CG3EXHLMODU2T24T5GECY3HYDR44XXCTDD'

// ── Verify ownership on-chain ─────────────────────────────────────────────────

async function verifyOwnership(walletAddress: string, bookId: number): Promise<boolean> {
  try {
    const contract = new Contract(CONTRACT_ID)
    const account  = new Account(walletAddress, '0')

    const transaction = new TransactionBuilder(account, {
      fee:               BASE_FEE,
      networkPassphrase: NETWORK,
    })
      .addOperation(
        contract.call(
          'owns_book',
          nativeToScVal(walletAddress, { type: 'address' }),
          nativeToScVal(BigInt(bookId), { type: 'u64' }),
        )
      )
      .setTimeout(30)
      .build()

    const simResponse = await fetch(RPC_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id:      1,
        method:  'simulateTransaction',
        params:  { transaction: transaction.toXDR() },
      }),
    })

    const simData = await simResponse.json()
    const returnVal = simData.result?.results?.[0]?.xdr
    if (!returnVal) return false

    const scVal = xdr.ScVal.fromXDR(returnVal, 'base64')
    return scValToNative(scVal) as boolean

  } catch (err) {
    console.error('Ownership verification failed:', err)
    return false
  }
}

// ── POST /api/keys — store a new encryption key ───────────────────────────────
// Called by the upload page after successful Arweave upload and book registration
// Stores the AES key tied to the book ID

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { arweaveTxId, bookId, key, iv } = body

    if (!arweaveTxId || bookId === undefined || !key || !iv) {
      return NextResponse.json(
        { error: 'Missing required fields: arweaveTxId, bookId, key, iv' },
        { status: 400 }
      )
    }

    // store the key indexed by Arweave TX ID
    keyStore.set(arweaveTxId, { bookId, arweaveTxId, key, iv })

    console.log(`Key stored for book ID ${bookId}, Arweave TX: ${arweaveTxId}`)

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error('Key storage error:', err)
    return NextResponse.json({ error: 'Failed to store key' }, { status: 500 })
  }
}

// ── GET /api/keys — retrieve a key for verified owners ───────────────────────
// Called by the reader page when a student opens a book
// Verifies on-chain ownership before releasing the key

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const arweaveTxId  = searchParams.get('arweaveTxId')
    const walletAddress = searchParams.get('wallet')

    if (!arweaveTxId || !walletAddress) {
      return NextResponse.json(
        { error: 'Missing required params: arweaveTxId, wallet' },
        { status: 400 }
      )
    }

    // look up the key
    const entry = keyStore.get(arweaveTxId)
    if (!entry) {
      return NextResponse.json(
        { error: 'Key not found for this book' },
        { status: 404 }
      )
    }

    // verify the wallet owns this book on-chain
    console.log(`Checking ownership: wallet ${walletAddress} for book ID ${entry.bookId}`)
    const owns = await verifyOwnership(walletAddress, entry.bookId)

    if (!owns) {
      return NextResponse.json(
        { error: 'Access denied — you do not own this book' },
        { status: 403 }
      )
    }

    // ownership confirmed — release the key
    console.log(`Key released for book ID ${entry.bookId} to wallet ${walletAddress}`)

    return NextResponse.json({
      key: entry.key,
      iv:  entry.iv,
    })

  } catch (err) {
    console.error('Key retrieval error:', err)
    return NextResponse.json({ error: 'Failed to retrieve key' }, { status: 500 })
  }
}