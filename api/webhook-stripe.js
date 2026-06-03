/**
 * POST /api/webhook-stripe
 *
 * Stripe sends events here when a subscription is created, renewed, or cancelled.
 * This upgrades/downgrades the user's plan in KV.
 *
 * Set in Stripe dashboard:
 *   Webhook endpoint: https://your-vercel-url.vercel.app/api/webhook-stripe
 *   Events to send:  customer.subscription.created
 *                    customer.subscription.updated
 *                    customer.subscription.deleted
 *                    invoice.payment_failed
 *
 * Required env vars:
 *   STRIPE_WEBHOOK_SECRET   — from Stripe CLI / dashboard
 *   STRIPE_SECRET_KEY       — for API calls back to Stripe
 */

const crypto = require('crypto')

function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')))
  const timestamp = parts.t
  const sig = parts.v1
  const signed = `${timestamp}.${payload}`
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
}

async function kvSet(key, value) {
  await fetch(`${process.env.KV_REST_API_URL}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  })
}

async function kvGet(key) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  })
  if (!res.ok) return null
  const { result } = await res.json()
  return result ? JSON.parse(result) : null
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const sig = req.headers['stripe-signature']
  const rawBody = await new Promise((resolve) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => resolve(data))
  })

  let event
  try {
    if (!verifyStripeSignature(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)) {
      return res.status(400).json({ error: 'Invalid signature' })
    }
    event = JSON.parse(rawBody)
  } catch (err) {
    return res.status(400).json({ error: 'Webhook error' })
  }

  const subscription = event.data.object
  const email = subscription.customer_email

  if (!email) {
    return res.status(200).json({ received: true, note: 'No email on subscription — skipped' })
  }

  const emailKey = `user:${email.toLowerCase()}`
  const user = await kvGet(emailKey)
  if (!user) {
    console.warn('[stripe-webhook] unknown user:', email)
    return res.status(200).json({ received: true })
  }

  let newPlan = user.plan

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      newPlan = subscription.status === 'active' ? 'pro' : 'free'
      break
    case 'customer.subscription.deleted':
    case 'invoice.payment_failed':
      newPlan = 'free'
      break
  }

  if (newPlan !== user.plan) {
    const updated = { ...user, plan: newPlan, updatedAt: Date.now() }
    await kvSet(emailKey, JSON.stringify(updated))
    // Also update the key index
    if (user.licenseKey) {
      const keyRecord = await kvGet(`key:${user.licenseKey}`)
      if (keyRecord) {
        await kvSet(`key:${user.licenseKey}`, JSON.stringify({ ...keyRecord, plan: newPlan }))
      }
    }
    console.log(`[stripe-webhook] ${email}: ${user.plan} → ${newPlan}`)
  }

  res.status(200).json({ received: true })
}
