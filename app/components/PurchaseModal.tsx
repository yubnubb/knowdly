// app/components/PurchaseModal.tsx
// Full Stellar USDC purchase flow
// Student sees dollars — blockchain happens invisibly in the background

'use client'

import { useState } from 'react'
import { requestAccess, signTransaction } from '@stellar/freighter-api'
import {
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Asset,
  Operation,
  Memo,
  Account,
} from '@stellar/stellar-sdk'
import { purchaseBook } from '../lib/contract'

// ── Types ─────────────────────────────────────────────────────────────────────

type Book = {
  txId:    string
  title:   string
  author:  string
  price:   string
  royalty: string
}

type PurchaseStatus =
  | 'idle'
  | 'connecting'
  | 'building'
  | 'signing'
  | 'submitting'
  | 'done'
  | 'error'

type Props = {
  book:      Book | null
  onClose:   () => void
  onSuccess: (book: Book) => void
}

// ── Stellar testnet config ────────────────────────────────────────────────────

// Horizon testnet API — used to load accounts and submit transactions
const HORIZON_URL = 'https://horizon-testnet.stellar.org'

// USDC on Stellar testnet — issued by Circle's testnet issuer
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

// Knowdly's testnet receiving address
// replace this with your own Freighter testnet address
// so you can see the payment arrive in your wallet
const KNOWDLY_ADDRESS = 'GANHXK3GPUCB3F63GUIY2D4C4KXP3XWCJG6NXFFQ6W4IKAKAYSS66CWG'

// ── Component ─────────────────────────────────────────────────────────────────

export default function PurchaseModal({ book, onClose, onSuccess }: Props) {

  // current step in the purchase flow
  const [status, setStatus]   = useState<PurchaseStatus>('idle')

  // error message shown to student if something goes wrong
  const [error, setError]     = useState<string | null>(null)

  // confirmed Stellar transaction hash shown after success
  const [txHash, setTxHash]   = useState<string | null>(null)

  // do not render if no book is selected
  if (!book) return null

  // handlePurchase — the full payment flow from wallet connect to confirmation
  async function handlePurchase() {
    // re-check book inside the function so TypeScript knows it's not null
    if (!book) return

    setStatus('connecting')
    setError(null)
    setTxHash(null)

    try {

      // ── Step 1: Connect Freighter and get student wallet address ───────────

      // requestAccess opens Freighter popup asking student to approve
      const accessResult = await requestAccess()

      if (accessResult.error) {
        throw new Error('Wallet connection was rejected')
      }

      // the student's Stellar public key — their wallet address
      const studentAddress = accessResult.address

      setStatus('building')

      // ── Step 2: Load student account from Stellar testnet ─────────────────

      // we need the account sequence number to build a valid transaction
      // Horizon returns the full account object including sequence
      const accountRes = await fetch(
        `${HORIZON_URL}/accounts/${studentAddress}`
      )

      if (!accountRes.ok) {
        throw new Error(
          'Could not load your wallet. Make sure Freighter is set to Testnet and your account is funded via Friendbot.'
        )
      }

      const accountData = await accountRes.json()

      // check the student has a USDC trustline
      // without a trustline Stellar rejects USDC payments
      const hasUsdcTrustline = accountData.balances?.some(
        (b: { asset_code?: string; asset_issuer?: string }) =>
          b.asset_code   === 'USDC' &&
          b.asset_issuer === USDC_ISSUER
      )

      if (!hasUsdcTrustline) {
        throw new Error(
          'No USDC trustline found. Add a USDC trustline in Stellar Laboratory before purchasing.'
        )
      }

      // check the student has enough USDC
      const usdcBalance = accountData.balances?.find(
        (b: { asset_code?: string; asset_issuer?: string }) =>
          b.asset_code   === 'USDC' &&
          b.asset_issuer === USDC_ISSUER
      )

      const balance = parseFloat(usdcBalance?.balance || '0')
      const price   = parseFloat(book.price)

      if (balance < price) {
        throw new Error(
          `Insufficient USDC balance. You have ${balance.toFixed(2)} USDC but need ${price.toFixed(2)} USDC.`
        )
      }

      // ── Step 3: Build the Stellar transaction ─────────────────────────────

      // create an Account object with the sequence number from Horizon
      // TransactionBuilder needs this to construct a valid transaction
      const account = new Account(studentAddress, accountData.sequence)

      // define USDC as the payment asset
      const usdcAsset = new Asset('USDC', USDC_ISSUER)

      // format the price to 7 decimal places as Stellar requires
      const amount = price.toFixed(7)

      // build the transaction
      const transaction = new TransactionBuilder(account, {
        fee:               BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        // single payment operation — student sends USDC to Knowdly
        .addOperation(
          Operation.payment({
            destination: KNOWDLY_ADDRESS,
            asset:       usdcAsset,
            amount,
          })
        )
        // memo records which book was purchased
        // we use the first 28 characters of the Arweave TX ID
        // Stellar memo text is limited to 28 bytes
        .addMemo(Memo.text(book.txId.slice(0, 28)))
        // transaction expires after 3 minutes if not signed
        .setTimeout(180)
        .build()

      setStatus('signing')

      // ── Step 4: Send to Freighter for student to sign ─────────────────────

      // convert transaction to XDR — Stellar's binary serialisation format
      // this is what Freighter signs and what Horizon accepts
      const xdr = transaction.toXDR()

      // signTransaction opens Freighter showing the student:
      //   Amount:      49.99 USDC
      //   Destination: Knowdly's address
      //   Memo:        book reference
      // student clicks Approve or Reject
      const signResult = await signTransaction(xdr, {
        networkPassphrase: Networks.TESTNET,
      })

      if (signResult.error) {
        throw new Error('Transaction was rejected in Freighter')
      }

      setStatus('submitting')

      // ── Step 5: Submit signed transaction to Stellar network ──────────────

      // post the signed XDR to Horizon
      // Horizon broadcasts it to the Stellar validator network
      // transaction confirms in approximately 5 seconds
      const submitRes = await fetch(`${HORIZON_URL}/transactions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    `tx=${encodeURIComponent(signResult.signedTxXdr)}`,
      })

      const submitData = await submitRes.json()

      if (!submitRes.ok) {
        // extract the Horizon error code for a helpful message
        const code = submitData?.extras?.result_codes?.transaction
        const opCode = submitData?.extras?.result_codes?.operations?.[0]

        if (code === 'tx_failed' && opCode === 'op_no_trust') {
          throw new Error('USDC trustline missing on destination account.')
        }
        if (code === 'tx_failed' && opCode === 'op_underfunded') {
          throw new Error('Insufficient USDC balance to complete this purchase.')
        }

        throw new Error(
          `Transaction failed: ${code || 'unknown error'}`
        )
      }

      // ── Step 6: Payment confirmed ─────────────────────────────────────────────

      setTxHash(submitData.hash)

      // mint the ownership token on Soroban
      // this records on-chain that the student owns this book
      try {
        console.log('Minting ownership token on Stellar...')
        await purchaseBook(
          studentAddress,
          0, // TODO: use actual Soroban book ID stored alongside Arweave TX ID
        )
        console.log('Ownership token minted successfully')
      } catch (contractErr) {
        // don't fail the purchase if token minting fails
        // the USDC payment already went through
        console.error('Token minting failed:', contractErr)
      }

      setStatus('done')

      // tell the library page this book is now owned
      onSuccess(book)

    } catch (err) {
      console.error('Purchase error:', err)
      setError(err instanceof Error ? err.message : 'Purchase failed')
      setStatus('error')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    // backdrop — clicking outside the modal closes it
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 max-w-md w-full">

        {/* ── IDLE / ERROR — waiting for student to click pay ────────────── */}
        {(status === 'idle' || status === 'error') && (
          <>
            {/* header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">
                  Complete purchase
                </h2>
                <p className="text-gray-400 text-sm">
                  Secure payment via your connected wallet
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-white transition-colors text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {/* book summary card */}
            <div className="bg-gray-800 rounded-xl p-4 mb-6 flex gap-4 items-start">
              <div className="w-12 h-16 bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-2xl">📖</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-medium text-sm leading-snug mb-1 line-clamp-2">
                  {book.title}
                </div>
                <div className="text-gray-400 text-xs">
                  {book.author}
                </div>
              </div>
            </div>

            {/* price breakdown */}
            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Book price</span>
                <span className="text-white">${book.price}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Network fee</span>
                <span className="text-white">~$0.00</span>
              </div>
              <div className="border-t border-gray-700 pt-2 flex justify-between font-semibold">
                <span className="text-gray-300">Total</span>
                <span className="text-white text-lg">${book.price}</span>
              </div>
              <div className="text-gray-600 text-xs text-right">
                Paid in USDC · Stellar testnet
              </div>
            </div>

            {/* ownership note */}
            <div className="bg-indigo-950 border border-indigo-800 rounded-xl p-3 mb-6 text-xs text-indigo-300">
              You will permanently own this book as a token in your wallet.
              Resell it any time — the author automatically earns {book.royalty}% of every resale.
            </div>

            {/* error from previous attempt */}
            {status === 'error' && error && (
              <div className="bg-red-950 border border-red-800 rounded-xl p-3 mb-4 text-xs text-red-300">
                {error}
              </div>
            )}

            {/* pay button */}
            <button
              onClick={handlePurchase}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl font-medium transition-colors mb-3"
            >
              Pay with Wallet — ${book.price}
            </button>

            <button
              onClick={onClose}
              className="w-full text-gray-500 hover:text-gray-400 text-sm transition-colors"
            >
              Cancel
            </button>
          </>
        )}

        {/* ── LOADING STATES ────────────────────────────────────────────────── */}
        {['connecting', 'building', 'signing', 'submitting'].includes(status) && (
          <div className="text-center py-8">

            {/* spinner */}
            <div className="w-12 h-12 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-6" />

            <div className="text-white font-medium mb-2">
              {status === 'connecting'  && 'Connecting to your wallet...'}
              {status === 'building'    && 'Preparing your transaction...'}
              {status === 'signing'     && 'Waiting for your approval...'}
              {status === 'submitting'  && 'Confirming on Stellar network...'}
            </div>

            {status === 'signing' && (
              <p className="text-gray-400 text-sm">
                Check your Freighter extension and click Approve
              </p>
            )}

            {status === 'submitting' && (
              <p className="text-gray-400 text-sm">
                This takes about 5 seconds
              </p>
            )}
          </div>
        )}

        {/* ── SUCCESS ───────────────────────────────────────────────────────── */}
        {status === 'done' && (
          <div className="text-center py-4">

            <div className="w-16 h-16 bg-green-900 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-3xl">✓</span>
            </div>

            <h2 className="text-xl font-bold text-white mb-2">
              Purchase complete
            </h2>
            <p className="text-gray-400 text-sm mb-6">
              You now own{' '}
              <span className="text-white font-medium">{book.title}</span>.
            </p>

            {/* transaction hash — proof of purchase on Stellar */}
            {txHash && (
              <div className="bg-gray-800 rounded-xl p-3 mb-6 text-left">
                <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
                  Stellar transaction
                </div>
                <code className="text-green-400 text-xs break-all block mb-2">
                  {txHash}
                </code>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
                >
                  View on Stellar Explorer →
                </a>
              </div>
            )}

            <button
              onClick={onClose}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl font-medium transition-colors"
            >
              Done
            </button>
          </div>
        )}

      </div>
    </div>
  )
}