// app/api/keys/route.ts
// Server-side key management — stores and releases AES-256 encryption keys
// Keys are only released to wallets that own the corresponding Soroban NFT
// Keys persist to Supabase PostgreSQL — survives server restarts and deployments
//
// Requires in .env.local:
//   SUPABASE_URL=https://your-project.supabase.co
//   SUPABASE_SERVICE_KEY=your_service_role_key

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
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

// ── Supabase client (server-side only) ───────────────────────────────────────
// Uses the service role key which bypasses RLS
// NEVER expose this key in the browser

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment')
  }

  return createClient(url, key)
}

// ── Stellar RPC config ────────────────────────────────────────────────────────

const RPC_URL     = 'https://soroban-testnet.stellar.org'
const NETWORK     = Networks.TESTNET
const CONTRACT_ID = 'CATPB6WUFQXBU6Q3HWFNGPOBKLYSVTCKCMX25LZOIEMQQP4LXKKRR4YX'

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
          nativeToScVal(walletAddress,  { type: 'address' }),
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
// Called by the upload page after successful Arweave upload + book registration
// Stores the AES key tied to the Soroban book ID in Supabase
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

    const supabase = getSupabase()

    // upsert — if a key already exists for this txId, update it
    // handles re-uploads cleanly
    const { error } = await supabase
      .from('keys')
      .upsert(
        { arweave_tx_id: arweaveTxId, book_id: bookId, key, iv },
        { onConflict: 'arweave_tx_id' }
      )

    if (error) {
      console.error('Supabase key storage error:', error)
      return NextResponse.json(
        { error: 'Failed to store key: ' + error.message },
        { status: 500 }
      )
    }

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
// Called by the reader page when a user opens a book
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

    const supabase = getSupabase()

    // look up the key from Supabase
    const { data, error } = await supabase
      .from('keys')
      .select('book_id, key, iv')
      .eq('arweave_tx_id', arweaveTxId)
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: 'Key not found for this book' },
        { status: 404 }
      )
    }

    // verify the wallet owns this book on-chain via Soroban
    console.log(
      `Checking ownership: wallet ${walletAddress} for book ID ${data.book_id}`
    )
    const owns = await verifyOwnership(walletAddress, data.book_id)

    if (!owns) {
      return NextResponse.json(
        { error: 'Access denied — you do not own this book' },
        { status: 403 }
      )
    }

    // ownership confirmed — release the decryption key
    console.log(
      `Key released for book ID ${data.book_id} to wallet ${walletAddress}`
    )

    return NextResponse.json({
      key: data.key,
      iv:  data.iv,
    })

  } catch (err) {
    console.error('Key retrieval error:', err)
    return NextResponse.json(
      { error: 'Failed to retrieve key' },
      { status: 500 }
    )
  }
}