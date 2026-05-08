// app/lib/crypto.ts
// Client-side AES-256-GCM encryption and decryption
// Uses the browser's built-in Web Crypto API — no external libraries needed
// Encryption happens in the browser before upload — server never sees plaintext

// ── Generate a new AES-256 key ────────────────────────────────────────────────

export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {
      name:   'AES-GCM',
      length: 256,        // AES-256
    },
    true,                 // extractable — we need to export it for storage
    ['encrypt', 'decrypt']
  )
}

// ── Export key to hex string for storage ──────────────────────────────────────

export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return bufferToHex(raw)
}

// ── Import key from hex string ────────────────────────────────────────────────

export async function importKey(hexKey: string): Promise<CryptoKey> {
  const raw = hexToBuffer(hexKey)
  return crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,              // not extractable after import
    ['decrypt']
  )
}

// ── Encrypt a file ────────────────────────────────────────────────────────────

export async function encryptFile(
  file: File,
  key: CryptoKey
): Promise<{ encryptedData: ArrayBuffer; iv: string }> {

  // read the file as ArrayBuffer
  const fileBuffer = await file.arrayBuffer()

  // generate a random 12-byte initialisation vector
  // IV must be unique for each encryption operation
  const iv = crypto.getRandomValues(new Uint8Array(12))

  // encrypt the file data
  const encryptedData = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    fileBuffer
  )

  return {
    encryptedData,
    iv: bufferToHex(iv),
  }
}

// ── Decrypt a file ────────────────────────────────────────────────────────────

export async function decryptFile(
  encryptedData: ArrayBuffer,
  key:           CryptoKey,
  ivHex:         string
): Promise<ArrayBuffer> {

  const iv = hexToBuffer(ivHex)

  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer as ArrayBuffer,
    },
    key,
    encryptedData
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}