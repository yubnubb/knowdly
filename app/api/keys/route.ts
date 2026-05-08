// app/api/keys/route.ts
// Server-side key management — stores and releases AES-256 encryption keys
// Keys are only released to wallets that own the corresponding Soroban NFT
// Keys persist to a file so they survive server restarts

import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Account,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── File-based key store ──────────────────────────────────────────────────────
// Keys persist to a JSON file so they survive server restarts
// In production use a proper database like PostgreSQL or Redis

const KEY_STORE_PATH = join(process.cwd(), '.keystore.json')

type KeyEntry = {
  bookId:      number
  arweaveTxId: string
  key:         string
  iv:          string
}

// load all keys from the JSON file
function loadKeyStore(): Record<string, KeyEntry> {
  try {
    if (existsSync(KEY_STORE_PATH)) {
      const data = readFileSync(KEY_STORE_PATH, 'utf-8')
      return JSON.parse(data)
    }
  } catch (err) {
    console.error('Error loading key store:', err)
  }
  return {}
}

// save all keys to the JSON file
function saveKeyStore(store: Record<string, KeyEntry>): void {
  try {
    writeFileSync(KEY_STORE_PATH, JSON.stringify(store, null, 2))
  } catch (err) {
    console.error('Error saving key store:', err)
  }
}

// get a single key entry by Arweave TX ID
function getKey(arweaveTxId: string): KeyEntry | undefined {
  const store = loadKeyStore()
  return store[arweaveTxId]
}

// store a single key entry by Arweave TX ID
function setKey(arweaveTxId: string, entry: KeyEntry): void {
  const store = loadKeyStore()
  store[arweaveTxId] = entry
  saveKeyStore(store)
}

// ── Stellar RPC config ────────────────────────────────────────────────────────

const RPC_URL     = 'https://soroban-testnet.stellar.org'
const NETWORK     = Networks.TESTNET
const CONTRACT_ID = 'CDZUALFCYWLHFDST3GY675CG3EXHLMODU2T24T5GECY3HYDR44XXCTDD'

// ── Verify ownership on-chain ─────────────────────────────────────────────────
// calls owns_book() on the Soroban contract
// returns true only if the wallet holds the NFT for this book

async function verifyOwnership(
  walletAddress: string,
  bookId:        number
): Promise<boolean> {
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
          nativeToScVal(walletAddress,   { type: 'address' }),
          nativeToScVal(BigInt(bookId),  { type: 'u64' }),
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

    const simData   = await simResponse.json()
    const returnVal = simData.result?.results?.[0]?.xdr
    if (!returnVal) return false

    const scVal = xdr.ScVal.fromXDR(returnVal, 'base64')
    return scValToNative(scVal) as boolean

  } catch (err) {
    console.error('Ownership verification failed:', err)
    return false
  }
}

// ── POST /api/keys ────────────────────────────────────────────────────────────
// Called by the upload page after successful Arweave upload and book registration
// Stores the AES key tied to the Soroban book ID
// Body: { arweaveTxId, bookId, key, iv }

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

    // store the key in the persistent file store
    setKey(arweaveTxId, { bookId, arweaveTxId, key, iv })

    console.log(`Key stored for book ID ${bookId}, Arweave TX: ${arweaveTxId}`)

    return NextResponse.json({ success: true })

  } catch (err) {
    console.error('Key storage error:', err)
    return NextResponse.json(
      { error: 'Failed to store key' },
      { status: 500 }
    )
  }
}

// ── GET /api/keys ─────────────────────────────────────────────────────────────
// Called by the reader page when a student opens a book
// Verifies on-chain ownership before releasing the decryption key
// Params: ?arweaveTxId=xxx&wallet=Gxxx

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const arweaveTxId   = searchParams.get('arweaveTxId')
    const walletAddress = searchParams.get('wallet')

    if (!arweaveTxId || !walletAddress) {
      return NextResponse.json(
        { error: 'Missing required params: arweaveTxId, wallet' },
        { status: 400 }
      )
    }

    // look up the key from the persistent store
    const entry = getKey(arweaveTxId)

    if (!entry) {
      return NextResponse.json(
        { error: 'Key not found for this book' },
        { status: 404 }
      )
    }

    // verify the wallet owns this book on-chain via Soroban
    console.log(
      `Checking ownership: wallet ${walletAddress} for book ID ${entry.bookId}`
    )
    const owns = await verifyOwnership(walletAddress, entry.bookId)

    if (!owns) {
      return NextResponse.json(
        { error: 'Access denied — you do not own this book' },
        { status: 403 }
      )
    }

    // ownership confirmed — release the decryption key
    console.log(
      `Key released for book ID ${entry.bookId} to wallet ${walletAddress}`
    )

    return NextResponse.json({
      key: entry.key,
      iv:  entry.iv,
    })

  } catch (err) {
    console.error('Key retrieval error:', err)
    return NextResponse.json(
      { error: 'Failed to retrieve key' },
      { status: 500 }
    )
  }
}