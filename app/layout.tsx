// layout.tsx — the root layout that wraps every page in the app
// anything placed here appears on ALL pages (navbar, footer, fonts)

import type { Metadata } from 'next'
import './globals.css'

// Connect Stellar (Freighter Wallet)
import WalletConnect from './components/WalletConnect'

// metadata is used by Next.js to set the browser tab title and description
// also used by search engines and social media link previews
export const metadata: Metadata = {
  title: 'Knowdly — All the knowledge. Finally affordable.',
  description: 'Blockchain-powered textbook platform giving students affordable access and professors fair royalties.',
}

// RootLayout wraps every page — children is whatever page is being rendered
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // lang="en" helps screen readers and search engines
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen" suppressHydrationWarning>

        {/* navbar — appears at the top of every page */}
        <nav className="border-b border-gray-800 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">

            {/* logo / brand name */}
            <a href="/" className="text-xl font-bold text-white tracking-tight">
              Knowdly
            </a>

            {/* navigation links */}
            <div className="flex items-center gap-6 text-sm text-gray-400">
              <a href="/library" className="hover:text-white transition-colors">
                Library
              </a>
              <a href="/upload" className="hover:text-white transition-colors">
                For Creators
              </a>
              <a
                href="/upload"
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Upload a Book
              </a>

              {/* wallet connect button — connects Freighter on Stellar testnet */}
              <WalletConnect />
            </div>
          </div>
        </nav>

        {/* children — the actual page content renders here */}
        <main className="max-w-6xl mx-auto px-6 py-12">
          {children}
        </main>

        {/* footer — appears at the bottom of every page */}
        <footer className="border-t border-gray-800 px-6 py-8 mt-20">
          <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-gray-500">
            <span>© 2026 Knowdly. All rights reserved.</span>
            <span>All the knowledge. Finally affordable.</span>
          </div>
        </footer>

      </body>
    </html>
  )
}