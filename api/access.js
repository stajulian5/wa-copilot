/**
 * POST /api/access
 *
 * Called when a user signs up from the landing page.
 * Phase 1 (now):  Store email, assign a free license key, return it.
 * Phase 2 (paid): Check Stripe subscription; block if no active subscription.
 *
 * Required env vars:
 *   KV_REST_API_URL       — Vercel KV endpoint  (set in Vercel dashboard)
 *   KV_REST_API_TOKEN     — Vercel KV token      (set in Vercel dashboard)
 *
 * Optional (Phase 2):
 *   STRIPE_SECRET_KEY     — for verifying subscriptions
 *   RESEND_API_KEY        — for sending welcome emails
 */

const crypto = require('crypto')

// ── Tiny KV helper (Vercel KV REST API) ──────────────────────────────────────

async function kvSet(key, value) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/set/${key}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(value)
  })
  if (!res.ok) throw new Error(`KV set failed: ${res.status}`)
}

async function kvGet(key) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  })
  if (!res.ok) return null
  const { result } = await res.json()
  return result ? JSON.parse(result) : null
}

// ── License key generator ────────────────────────────────────────────────────

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   // no confusable chars (0/O, 1/I)
  const seg = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `CP-${seg(4)}-${seg(4)}-${seg(4)}`          // e.g. CP-X7K2-MN4P-Q8VR
}

// ── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS — allow the landing page domain
  res.setHeader('Access-Control-Allow-Origin', 'https://stajulian5.github.io')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const { email, source = 'landing' } = req.body ?? {}

  // Basic validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' })
  }

  const emailKey = `user:${email.toLowerCase().trim()}`

  try {
    // Return existing key if this email already signed up
    const existing = await kvGet(emailKey)
    if (existing) {
      return res.status(200).json({
        key: existing.licenseKey,
        plan: existing.plan,
        already_registered: true
      })
    }

    // ── Phase 2 hook: Stripe subscription check ──────────────────────────────
    // When you're ready to charge, uncomment and implement this block:
    //
    // const subscription = await getStripeSubscription(email)
    // if (!subscription || subscription.status !== 'active') {
    //   return res.status(402).json({
    //     error: 'No active subscription',
    //     checkout_url: await createStripeCheckoutSession(email)
    //   })
    // }
    // ────────────────────────────────────────────────────────────────────────

    // Create new user record
    const user = {
      email: email.toLowerCase().trim(),
      licenseKey: generateLicenseKey(),
      plan: 'free',          // 'free' | 'pro' — flipped by Stripe webhook later
      source,                // 'landing' | 'app' | 'referral'
      createdAt: Date.now(),
      lastSeenAt: Date.now()
    }

    await kvSet(emailKey, JSON.stringify(user))
    // Also index by license key for fast lookups during app validation
    await kvSet(`key:${user.licenseKey}`, JSON.stringify({ email: user.email, plan: user.plan }))

    // ── Phase 2 hook: Send welcome email ─────────────────────────────────────
    // await sendWelcomeEmail(user)
    // ────────────────────────────────────────────────────────────────────────

    return res.status(201).json({
      key: user.licenseKey,
      plan: user.plan
    })

  } catch (err) {
    console.error('[access]', err)
    // Fail open during Phase 1 — never block a free user due to infra issues
    return res.status(200).json({
      key: generateLicenseKey(),
      plan: 'free',
      offline_fallback: true
    })
  }
}
