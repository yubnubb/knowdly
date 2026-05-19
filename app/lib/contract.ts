// app/lib/contract.ts
// Client for interacting with the Knowdly Soroban smart contract
//
// Key design: registerBook is split into two phases so the upload page
// can get a signed transaction BEFORE uploading to Arweave:
//
//   buildAndSignRegisterBook() → signed XDR string (Freighter prompt here)
//   submitSignedTransaction()  → submits + polls for confirmation
//
// This ensures nothing is uploaded to Arweave unless the professor
// has already signed the Stellar transaction.

import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Account,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'
import { signTransaction } from '@stellar/freighter-api'

// ── Configuration ─────────────────────────────────────────────────────────────

export const CONTRACT_ID = 'CATPB6WUFQXBU6Q3HWFNGPOBKLYSVTCKCMX25LZOIEMQQP4LXKKRR4YX'

const HORIZON_URL = 'https://horizon-testnet.stellar.org'
const RPC_URL     = 'https://soroban-testnet.stellar.org'
const NETWORK     = Networks.TESTNET

// ── Helper — load account ─────────────────────────────────────────────────────

async function loadAccount(address: string): Promise<Account> {
  const response = await fetch(`${HORIZON_URL}/accounts/${address}`)
  if (!response.ok) {
    throw new Error('Could not load account. Make sure your wallet is funded on testnet.')
  }
  const data = await response.json()
  return new Account(address, data.sequence)
}

// ── Helper — simulate only (read-only calls) ──────────────────────────────────

async function simulateOnly(transaction: any): Promise<any> {
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
  return simResponse.json()
}

// ── Helper — poll for transaction confirmation ────────────────────────────────

async function pollTransaction(hash: string): Promise<any> {
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000))

    const statusResponse = await fetch(RPC_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id:      1,
        method:  'getTransaction',
        params:  { hash },
      }),
    })

    const statusData = await statusResponse.json()
    console.log('Transaction status:', statusData.result?.status)

    if (statusData.result?.status === 'SUCCESS') return statusData.result
    if (statusData.result?.status === 'FAILED') {
      throw new Error('Transaction failed on network: ' + JSON.stringify(statusData.result))
    }
  }
  throw new Error('Transaction confirmation timeout')
}

// ── Helper — simulate and submit (used by purchase, not by register) ──────────

async function simulateAndSubmit(transaction: any): Promise<any> {
  const simData = await simulateOnly(transaction)
  if (simData.result?.error) throw new Error('Simulation failed: ' + simData.result.error)

  const server    = new rpc.Server(RPC_URL)
  const assembled = await server.prepareTransaction(transaction)

  const signResult = await signTransaction(assembled.toXDR(), {
    networkPassphrase: NETWORK,
  })
  if (signResult.error) throw new Error('Transaction signing failed: ' + signResult.error)

  const submitResponse = await fetch(RPC_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id:      1,
      method:  'sendTransaction',
      params:  { transaction: signResult.signedTxXdr },
    }),
  })

  const submitData = await submitResponse.json()
  if (submitData.result?.status === 'ERROR') {
    throw new Error('Transaction failed: ' + JSON.stringify(submitData.result))
  }

  const hash = submitData.result?.hash
  if (!hash) throw new Error('No transaction hash returned')
  console.log('Transaction submitted, hash:', hash)

  return pollTransaction(hash)
}

// ── submitSignedTransaction ───────────────────────────────────────────────────
// Takes a pre-signed XDR string and submits it to the network.
// Called by the upload page AFTER Arweave upload succeeds.

export async function submitSignedTransaction(signedXdr: string): Promise<any> {
  const submitResponse = await fetch(RPC_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id:      1,
      method:  'sendTransaction',
      params:  { transaction: signedXdr },
    }),
  })

  const submitData = await submitResponse.json()
  console.log('Submit response:', JSON.stringify(submitData, null, 2))

  if (submitData.result?.status === 'ERROR') {
    throw new Error('Transaction failed: ' + JSON.stringify(submitData.result))
  }

  const hash = submitData.result?.hash
  if (!hash) throw new Error('No transaction hash returned')
  console.log('Transaction submitted, hash:', hash)

  return pollTransaction(hash)
}

// ── buildAndSignRegisterBook ──────────────────────────────────────────────────
// Phase 1 of the atomic upload flow.
// Builds, simulates, prepares, and signs the register_book transaction.
// Returns the signed XDR — does NOT submit to the network yet.
// Freighter will prompt the professor to sign here.
// If they cancel, nothing has been uploaded to Arweave.

export async function buildAndSignRegisterBook(
  publisherAddress: string,
  price:            number,
  royaltyBps:       number,
  arweaveTxId:      string, // NOTE: pass a placeholder here before actual upload
  title:            string,
): Promise<string> {
  const account      = await loadAccount(publisherAddress)
  const contract     = new Contract(CONTRACT_ID)
  const priceStroops = BigInt(price) * BigInt(100_000)

  const transaction = new TransactionBuilder(account, {
    fee:               BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      contract.call(
        'register_book',
        nativeToScVal(publisherAddress, { type: 'address' }),
        nativeToScVal(priceStroops,     { type: 'i128' }),
        nativeToScVal(royaltyBps,       { type: 'u32' }),
        nativeToScVal(arweaveTxId,      { type: 'string' }),
        nativeToScVal(title,            { type: 'string' }),
      )
    )
    .setTimeout(30)
    .build()

  // simulate to check for errors before prompting the professor
  const simData = await simulateOnly(transaction)
  if (simData.result?.error) {
    throw new Error('Contract simulation failed: ' + simData.result.error)
  }

  // prepare — assembles the transaction with resource fees from simulation
  const server    = new rpc.Server(RPC_URL)
  const assembled = await server.prepareTransaction(transaction)

  // sign — this is the Freighter prompt
  const signResult = await signTransaction(assembled.toXDR(), {
    networkPassphrase: NETWORK,
  })

  if (signResult.error) {
    throw new Error('Signing cancelled or failed: ' + signResult.error)
  }

  return signResult.signedTxXdr
}

// ── getTotalBooks ─────────────────────────────────────────────────────────────

export async function getTotalBooks(callerAddress: string): Promise<number> {
  const contract = new Contract(CONTRACT_ID)
  const account  = new Account(callerAddress, '0')

  const transaction = new TransactionBuilder(account, {
    fee:               BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(contract.call('get_total_books'))
    .setTimeout(30)
    .build()

  const simData = await simulateOnly(transaction)

  try {
    const returnVal = simData.result?.results?.[0]?.xdr
    if (!returnVal) return 0
    const scVal = xdr.ScVal.fromXDR(returnVal, 'base64')
    return Number(scValToNative(scVal))
  } catch (err) {
    console.error('Error getting total books:', err)
    return 0
  }
}

// ── registerBook (legacy — kept for reference, not used by upload page) ───────

export async function registerBook(
  publisherAddress: string,
  price:            number,
  royaltyBps:       number,
  arweaveTxId:      string,
  title:            string,
): Promise<number> {
  const account      = await loadAccount(publisherAddress)
  const contract     = new Contract(CONTRACT_ID)
  const priceStroops = BigInt(price) * BigInt(100_000)

  const transaction = new TransactionBuilder(account, {
    fee:               BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      contract.call(
        'register_book',
        nativeToScVal(publisherAddress, { type: 'address' }),
        nativeToScVal(priceStroops,     { type: 'i128' }),
        nativeToScVal(royaltyBps,       { type: 'u32' }),
        nativeToScVal(arweaveTxId,      { type: 'string' }),
        nativeToScVal(title,            { type: 'string' }),
      )
    )
    .setTimeout(30)
    .build()

  await simulateAndSubmit(transaction)

  try {
    const totalBooks = await getTotalBooks(publisherAddress)
    return totalBooks - 1
  } catch {
    return 0
  }
}

// ── purchaseBook ──────────────────────────────────────────────────────────────

export async function purchaseBook(
  buyerAddress: string,
  bookId:       number,
): Promise<number> {
  const account  = await loadAccount(buyerAddress)
  const contract = new Contract(CONTRACT_ID)

  const transaction = new TransactionBuilder(account, {
    fee:               BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      contract.call(
        'purchase',
        nativeToScVal(buyerAddress,   { type: 'address' }),
        nativeToScVal(BigInt(bookId), { type: 'u64' }),
      )
    )
    .setTimeout(30)
    .build()

  const result = await simulateAndSubmit(transaction)
  console.log('Book purchased on-chain. Result:', result)
  return 0
}

// ── getToken ──────────────────────────────────────────────────────────────────
// Returns a token's full details — bookId, owner, arweaveTxId via book lookup.
// Used alongside getTokensByOwner to discover owned books on any device.

export async function getToken(
  callerAddress: string,
  tokenId:       number,
): Promise<{ id: number; bookId: number; owner: string; purchasePrice: bigint } | null> {
  const contract = new Contract(CONTRACT_ID)
  const account  = new Account(callerAddress, '0')

  const transaction = new TransactionBuilder(account, {
    fee:               BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      contract.call(
        'get_token',
        nativeToScVal(BigInt(tokenId), { type: 'u64' }),
      )
    )
    .setTimeout(30)
    .build()

  const simData = await simulateOnly(transaction)

  if (simData.result?.error) {
    console.error('getToken simulation error:', simData.result.error)
    return null
  }

  try {
    const returnVal = simData.result?.results?.[0]?.xdr
    if (!returnVal) return null
    const scVal  = xdr.ScVal.fromXDR(returnVal, 'base64')
    const native = scValToNative(scVal) as any
    return {
      id:            Number(native.id),
      bookId:        Number(native.book_id),
      owner:         native.owner,
      purchasePrice: BigInt(native.purchase_price),
    }
  } catch (err) {
    console.error('Error parsing getToken result:', err)
    return null
  }
}

// ── getTokensByOwner ──────────────────────────────────────────────────────────
// Returns all tokenIds owned by a wallet — replaces localStorage dependency.
// Call this on any device to discover all books a wallet owns on-chain.

export async function getTokensByOwner(ownerAddress: string): Promise<number[]> {
  const contract = new Contract(CONTRACT_ID)
  const account  = new Account(ownerAddress, '0')

  const transaction = new TransactionBuilder(account, {
    fee:               BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      contract.call(
        'get_tokens_by_owner',
        nativeToScVal(ownerAddress, { type: 'address' }),
      )
    )
    .setTimeout(30)
    .build()

  const simData = await simulateOnly(transaction)

  if (simData.result?.error) {
    console.error('getTokensByOwner simulation error:', simData.result.error)
    return []
  }

  try {
    const returnVal = simData.result?.results?.[0]?.xdr
    if (!returnVal) return []
    const scVal  = xdr.ScVal.fromXDR(returnVal, 'base64')
    const native = scValToNative(scVal)
    // native comes back as a BigInt array — convert to number[]
    return Array.isArray(native) ? native.map(Number) : []
  } catch (err) {
    console.error('Error parsing getTokensByOwner result:', err)
    return []
  }
}

// ── ownsBook ──────────────────────────────────────────────────────────────────

export async function ownsBook(
  ownerAddress: string,
  bookId:       number,
): Promise<boolean> {
  const contract = new Contract(CONTRACT_ID)
  const account  = new Account(ownerAddress, '0')

  const transaction = new TransactionBuilder(account, {
    fee:               BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      contract.call(
        'owns_book',
        nativeToScVal(ownerAddress,   { type: 'address' }),
        nativeToScVal(BigInt(bookId), { type: 'u64' }),
      )
    )
    .setTimeout(30)
    .build()

  const simData = await simulateOnly(transaction)

  if (simData.result?.error) {
    console.error('ownsBook simulation error:', simData.result.error)
    return false
  }

  try {
    const returnVal = simData.result?.results?.[0]?.xdr
    if (!returnVal) return false
    const scVal = xdr.ScVal.fromXDR(returnVal, 'base64')
    return scValToNative(scVal) as boolean
  } catch (err) {
    console.error('Error parsing ownsBook result:', err)
    return false
  }
}