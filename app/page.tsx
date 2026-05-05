// page.tsx — the Knowdly landing page
// this is the first thing visitors see at http://localhost:3000

export default function Home() {
  return (
    <div>

      {/* ── HERO SECTION ──────────────────────────────────────────────────── */}
      {/* the main headline area — biggest, boldest, most important message */}
      <section className="text-center py-20">

        {/* eyebrow label — small text above the main headline */}
        <div className="inline-block bg-indigo-950 text-indigo-400 text-xs font-medium px-3 py-1 rounded-full mb-6 border border-indigo-800">
          Now in development · Built on Stellar + Arweave
        </div>

        {/* main headline — the core value proposition */}
        <h1 className="text-5xl font-bold text-white leading-tight mb-6 max-w-3xl mx-auto">
          Textbooks should not cost more than{' '}
          <span className="text-indigo-400">your rent</span>
        </h1>

        {/* subheadline — expands on the headline with more detail */}
        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Knowdly gives students affordable subscription access to academic
          textbooks, while giving professors full ownership, transparent
          royalties, and a direct relationship with their readers.
        </p>

        {/* call to action buttons */}
        <div className="flex items-center justify-center gap-4 flex-wrap">

          {/* primary CTA — for students */}
          <a
            href="/library"
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-lg font-medium transition-colors text-lg"
          >
            Browse the library
          </a>

          {/* secondary CTA — for professors */}
          <a
            href="/upload"
            className="border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white px-8 py-3 rounded-lg font-medium transition-colors text-lg"
          >
            Upload your textbook
          </a>
        </div>
      </section>

      {/* ── STATS BAR ─────────────────────────────────────────────────────── */}
      {/* three key statistics that establish the problem and urgency */}
      <section className="border border-gray-800 rounded-2xl p-8 mb-20 grid grid-cols-1 md:grid-cols-3 gap-8 text-center">

        {/* stat 1 */}
        <div>
          <div className="text-4xl font-bold text-indigo-400 mb-2">$1,200+</div>
          <div className="text-gray-400 text-sm leading-relaxed">
            Average amount American students spend on textbooks every year
          </div>
        </div>

        {/* divider — hidden on mobile, visible on desktop */}
        <div className="hidden md:block border-l border-gray-800" />

        {/* stat 2 */}
        <div>
          <div className="text-4xl font-bold text-indigo-400 mb-2">65%</div>
          <div className="text-gray-400 text-sm leading-relaxed">
            Of students regularly skip buying required textbooks due to cost
          </div>
        </div>

        {/* divider */}
        <div className="hidden md:block border-l border-gray-800" />

        {/* stat 3 */}
        <div>
          <div className="text-4xl font-bold text-indigo-400 mb-2">1,000%</div>
          <div className="text-gray-400 text-sm leading-relaxed">
            Increase in textbook prices since the 1970s — three times inflation
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────────────────────── */}
      <section className="mb-20">

        {/* section heading */}
        <h2 className="text-3xl font-bold text-white text-center mb-4">
          How Knowdly works
        </h2>
        <p className="text-gray-400 text-center mb-12 max-w-xl mx-auto">
          Different experiences for students and professors — built on the same
          transparent, permanent infrastructure.
        </p>

        {/* two column layout — students left, professors right */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

          {/* student column */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">

            {/* column icon and title */}
            <div className="text-3xl mb-4">🎓</div>
            <h3 className="text-xl font-semibold text-white mb-6">
              For students
            </h3>

            {/* step by step explanation */}
            <div className="space-y-4">
              <div className="flex gap-4">
                {/* step number */}
                <div className="w-7 h-7 rounded-full bg-indigo-900 text-indigo-400 text-sm font-bold flex items-center justify-center flex-shrink-0">
                  1
                </div>
                <div>
                  <div className="text-white font-medium mb-1">Subscribe once</div>
                  <div className="text-gray-400 text-sm">
                    Pay a low monthly fee and get access to the entire Knowdly library instantly.
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-indigo-900 text-indigo-400 text-sm font-bold flex items-center justify-center flex-shrink-0">
                  2
                </div>
                <div>
                  <div className="text-white font-medium mb-1">Read anything</div>
                  <div className="text-gray-400 text-sm">
                    Browse thousands of textbooks across every subject. Read in your browser, no downloads needed.
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-indigo-900 text-indigo-400 text-sm font-bold flex items-center justify-center flex-shrink-0">
                  3
                </div>
                <div>
                  <div className="text-white font-medium mb-1">Own what you buy</div>
                  <div className="text-gray-400 text-sm">
                    Purchase individual books as tokens and resell them when your course ends — just like a physical book.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* professor column */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
            <div className="text-3xl mb-4">📚</div>
            <h3 className="text-xl font-semibold text-white mb-6">
              For professors
            </h3>

            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-indigo-900 text-indigo-400 text-sm font-bold flex items-center justify-center flex-shrink-0">
                  1
                </div>
                <div>
                  <div className="text-white font-medium mb-1">Upload your content</div>
                  <div className="text-gray-400 text-sm">
                    Upload your textbook in minutes. Set your price and royalty rate. Keep full ownership of your work.
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-indigo-900 text-indigo-400 text-sm font-bold flex items-center justify-center flex-shrink-0">
                  2
                </div>
                <div>
                  <div className="text-white font-medium mb-1">Earn on every sale</div>
                  <div className="text-gray-400 text-sm">
                    Receive the full purchase price directly. No waiting, no quarterly statements, no surprises.
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-indigo-900 text-indigo-400 text-sm font-bold flex items-center justify-center flex-shrink-0">
                  3
                </div>
                <div>
                  <div className="text-white font-medium mb-1">Earn on every resale</div>
                  <div className="text-gray-400 text-sm">
                    Smart contracts automatically send you a royalty every time a student resells your book. Forever.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TECH STACK TRUST SIGNAL ───────────────────────────────────────── */}
      {/* brief mention of the infrastructure — builds credibility with technical visitors */}
      <section className="border border-gray-800 rounded-2xl p-8 mb-20 text-center">
        <p className="text-gray-500 text-sm mb-6 uppercase tracking-widest font-medium">
          Built on permanent infrastructure
        </p>
        <div className="flex items-center justify-center gap-12 flex-wrap">
          <div className="text-center">
            <div className="text-white font-semibold mb-1">Stellar</div>
            <div className="text-gray-500 text-xs">Ownership + royalties</div>
          </div>
          <div className="text-center">
            <div className="text-white font-semibold mb-1">Arweave</div>
            <div className="text-gray-500 text-xs">Permanent storage</div>
          </div>
          <div className="text-center">
            <div className="text-white font-semibold mb-1">Soroban</div>
            <div className="text-gray-500 text-xs">Smart contracts</div>
          </div>
          <div className="text-center">
            <div className="text-white font-semibold mb-1">End-to-end encrypted</div>
            <div className="text-gray-500 text-xs">AES-256 content protection</div>
          </div>
        </div>
      </section>

      {/* ── WAITLIST CTA ──────────────────────────────────────────────────── */}
      {/* bottom of page call to action — capture interest before launch */}
      <section className="text-center py-16 bg-gray-900 border border-gray-800 rounded-2xl">
        <h2 className="text-3xl font-bold text-white mb-4">
          Be first to know when we launch
        </h2>
        <p className="text-gray-400 mb-8 max-w-md mx-auto">
          Join the waitlist and get early access. Students get the first month
          free. Professors get free uploads during beta.
        </p>

        {/* email capture form */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <input
            type="email"
            placeholder="your@university.edu"
            className="bg-gray-800 border border-gray-700 text-white placeholder-gray-500 px-4 py-3 rounded-lg w-72 focus:outline-none focus:border-indigo-500"
          />
          <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-medium transition-colors">
            Join the waitlist
          </button>
        </div>

        {/* reassurance note below the form */}
        <p className="text-gray-600 text-xs mt-4">
          No spam. No credit card required. Unsubscribe any time.
        </p>
      </section>

    </div>
  )
}