/**
 * GET /api/verify?key=CP-XXXX-XXXX-XXXX
 *
 * Called by the Copilot app on launch to validate a license key.
 *
 * Phase 1 (now):  Always returns valid — every key works.
 * Phase 2 (paid): Check plan field; reject 'free' keys after the cutover date.
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' })

  const { key } = req.query

  if (!key || !key.startsWith('CP-')) {
    return res.status(400).json({ valid: false, reason: 'Invalid key format' })
  }

  try {
    const kvRes = await fetch(`${process.env.KV_REST_API_URL}/get/key:${key}`, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
    })
    const { result } = await kvRes.json()
    const record = result ? JSON.parse(result) : null

    // ── Phase 1: All keys are valid ──────────────────────────────────────────
    // Remove this block and uncomment Phase 2 when you start charging.
    return res.status(200).json({
      valid: true,
      plan: record?.plan ?? 'free',
      features: ['pipeline', 'chat', 'ai', 'escalation']   // all features, always
    })

    // ── Phase 2: Enforce subscription ────────────────────────────────────────
    // const PAID_CUTOVER = new Date('2025-10-01').getTime()
    // if (!record) {
    //   return res.status(200).json({ valid: false, reason: 'Unknown key' })
    // }
    // if (record.plan !== 'pro' && Date.now() > PAID_CUTOVER) {
    //   return res.status(200).json({
    //     valid: false,
    //     reason: 'Subscription required',
    //     upgrade_url: 'https://stajulian5.github.io/wa-copilot/#pricing'
    //   })
    // }
    // return res.status(200).json({ valid: true, plan: record.plan, features: ['pipeline','chat','ai','escalation'] })
    // ────────────────────────────────────────────────────────────────────────

  } catch (err) {
    // Fail open — never block the app due to infra issues
    console.error('[verify]', err)
    return res.status(200).json({ valid: true, plan: 'free', offline_fallback: true })
  }
}
