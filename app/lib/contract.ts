// app/lib/contract.ts
// Client for interacting with the Knowdly Soroban smart contract

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

export const CONTRACT_ID = 'CDZUALFCYWLHFDST3GY675CG3EXHLMODU2T24T5GECY3HYDR44XXCTDD'

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

// ── Helper — simulate and submit ──────────────────────────────────────────────

async function simulateAndSubmit(transaction: any): Promise<any> {

  // step 1 — simulate
  const simData = await simulateOnly(transaction)

  if (simData.result?.error) {
    throw new Error('Simulation failed: ' + simData.result.error)
  }

  // step 2 — prepare
  const server    = new rpc.Server(RPC_URL)
  const assembled = await server.prepareTransaction(transaction)

  // step 3 — sign with Freighter
  const signResult = await signTransaction(assembled.toXDR(), {
    networkPassphrase: NETWORK,
  })

  if (signResult.error) {
    throw new Error('Transaction signing failed: ' + signResult.error)
  }

  // step 4 — submit
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
  console.log('Submit response:', JSON.stringify(submitData, null, 2))

  if (submitData.result?.status === 'ERROR') {
    throw new Error('Transaction failed: ' + JSON.stringify(submitData.result))
  }

  const hash = submitData.result?.hash
  if (!hash) throw new Error('No transaction hash returned')

  console.log('Transaction submitted, hash:', hash)

  // step 5 — poll for confirmation
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

    if (statusData.result?.status === 'SUCCESS') {
      return statusData.result
    }

    if (statusData.result?.status === 'FAILED') {
      throw new Error('Transaction failed on network: ' + JSON.stringify(statusData.result))
    }
  }

  throw new Error('Transaction confirmation timeout')
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

// ── registerBook ──────────────────────────────────────────────────────────────

export async function registerBook(
  publisherAddress: string,
  price:            number,
  royaltyBps:       number,
  arweaveTxId:      string,
  title:            string,
): Promise<number> {

  const account  = await loadAccount(publisherAddress)
  const contract = new Contract(CONTRACT_ID)
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

  // get the book ID by querying total books and subtracting 1
  try {
    const totalBooks = await getTotalBooks(publisherAddress)
    const bookId     = totalBooks - 1
    console.log('Book ID derived from total count:', bookId)
    return bookId
  } catch (err) {
    console.error('Could not get book ID:', err)
  }

  return 0
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