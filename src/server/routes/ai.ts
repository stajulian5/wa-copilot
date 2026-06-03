import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { eq, desc } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { format } from 'date-fns'
import keytar from 'keytar'

export const aiRouter = Router()

const db = (req: any): BetterSQLite3Database<typeof schema> => req.db

const KEYCHAIN_SERVICE = 'MicaCRM'
const KEYCHAIN_ACCOUNT = 'anthropic-api-key'
const MODEL = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `Eres el asistente de un KAM (Key Account Manager) de Mica, empresa mexicana de PropTech que ofrece Protección de Renta a agentes inmobiliarios.

Tu tarea: redactar UN mensaje de WhatsApp que el KAM enviará al broker.

CONTEXTO DEL BROKER
Nombre: {{contact_name}}
Etapa: {{stage}}
Propiedad: {{property}}
KYC: {{kyc_status}}
Contrato: {{contract_status}}
Plataforma: {{broker_status}}
Ops históricas / rentas históricas: {{ops_historicas}} / {{rents_historicas}}
Ops activas / rentas 3m: {{ops_activas}} / {{rents_3m}}
Última actividad: {{latest_activity_type}}

TONO ACTIVO
{{tone_attributes}}

CONVERSACIÓN (cronológica, más antiguo primero)
{{last_20_messages}}

INSTRUCCIONES
- Escribe SOLO el cuerpo del mensaje, listo para enviar sin edición adicional
- Usa siempre español mexicano — coloquial pero profesional
- Máximo 3–4 oraciones salvo que el contexto requiera más detalle
- Si el broker hizo una pregunta, respóndela directamente
- No inventes datos ausentes del contexto
- No te identifiques como IA
- Si la etapa es waiting_for: seguimiento amable, sin presionar
- Si la etapa es new: contextualiza para una relación en inicio
- Si la etapa es all_resolved: solo escribe si hay razón clara para reactivar`

// POST /ai/suggest
// Body: { contactId: number }
aiRouter.post('/suggest', async (req, res) => {
  const { contactId } = req.body
  if (!contactId) return res.status(400).json({ error: 'contactId required' })

  const apiKey = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
  if (!apiKey) return res.status(402).json({ error: 'NO_API_KEY' })

  const [contact] = db(req)
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId))
    .all()
  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  const msgs = db(req)
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.contactId, contactId))
    .orderBy(desc(schema.messages.timestamp))
    .limit(20)
    .all()
    .reverse()

  // Retrieve active tone attributes from settings
  const [toneSetting] = db(req)
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'ai_tone'))
    .all()
  const toneAttributes = toneSetting?.value ?? 'Cálido, Conciso, Proactivo'

  const conversationText = msgs
    .map((m) => {
      const time = format(new Date(m.timestamp), 'HH:mm')
      const who = m.direction === 'out' ? 'KAM' : 'Broker'
      return `[${time}] ${who}: ${m.body ?? '[media]'}`
    })
    .join('\n')

  const systemPrompt = SYSTEM_PROMPT
    .replace('{{contact_name}}', contact.name ?? contact.phone)
    .replace('{{stage}}', contact.stage)
    .replace('{{property}}', contact.property ?? 'No especificada')
    .replace('{{kyc_status}}', contact.kycStatus ?? 'Desconocido')
    .replace('{{contract_status}}', contact.contractStatus ?? 'Desconocido')
    .replace('{{broker_status}}', contact.brokerStatus ?? 'Desconocido')
    .replace('{{ops_historicas}}', contact.opsHistoricas ?? '-')
    .replace('{{rents_historicas}}', contact.rentsHistoricas ?? '-')
    .replace('{{ops_activas}}', contact.opsActivas ?? '-')
    .replace('{{rents_3m}}', contact.rents3m ?? '-')
    .replace('{{latest_activity_type}}', contact.latestActivityType ?? '-')
    .replace('{{tone_attributes}}', toneAttributes)
    .replace('{{last_20_messages}}', conversationText || '(Sin mensajes previos)')

  try {
    const anthropic = new Anthropic({ apiKey })
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Redacta el siguiente mensaje.' }]
    })

    const suggestion = (response.content[0] as any).text as string

    // Track token usage
    const month = format(new Date(), 'yyyy-MM')
    const existing = db(req)
      .select()
      .from(schema.apiUsage)
      .where(eq(schema.apiUsage.month, month))
      .all()[0]

    if (existing) {
      db(req)
        .update(schema.apiUsage)
        .set({
          inputTokens: existing.inputTokens + response.usage.input_tokens,
          outputTokens: existing.outputTokens + response.usage.output_tokens,
          updatedAt: new Date()
        })
        .where(eq(schema.apiUsage.month, month))
        .run()
    } else {
      db(req)
        .insert(schema.apiUsage)
        .values({
          month,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens
        })
        .run()
    }

    res.json({ suggestion })
  } catch (err: any) {
    console.error('AI error:', err)
    res.status(500).json({ error: err.message ?? 'AI request failed' })
  }
})

// POST /ai/summarize
// Body: { contactId: number }
// Returns: { summary: string } — a short executive summary for escalation
aiRouter.post('/summarize', async (req, res) => {
  const { contactId } = req.body
  if (!contactId) return res.status(400).json({ error: 'contactId required' })

  const apiKey = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
  if (!apiKey) return res.status(402).json({ error: 'NO_API_KEY' })

  const [contact] = db(req)
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId))
    .all()
  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  const msgs = db(req)
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.contactId, contactId))
    .orderBy(desc(schema.messages.timestamp))
    .limit(30)
    .all()
    .reverse()

  const stageLabels: Record<string, string> = {
    new: 'New',
    open_conversation: 'Open Conversation',
    waiting_for: 'Waiting For',
    all_resolved: 'All Resolved'
  }

  const conversationText = msgs
    .map((m) => {
      const time = format(new Date(m.timestamp), 'HH:mm dd/MM')
      const who = m.direction === 'out' ? 'KAM' : 'Broker'
      return `[${time}] ${who}: ${m.body ?? '[media]'}`
    })
    .join('\n')

  const contactName = contact.name ?? contact.phone ?? 'Contacto'

  const systemPrompt = `Eres un asistente interno de Mica, PropTech mexicana.
Genera un resumen ejecutivo BREVE de esta conversación para escalar con otro KAM.

CONTACTO
Nombre: ${contactName}
Etapa CRM: ${stageLabels[contact.stage] ?? contact.stage}
${contact.property ? `Propiedad: ${contact.property}` : ''}
${contact.kycStatus ? `KYC: ${contact.kycStatus}` : ''}
${contact.notes ? `Notas: ${contact.notes}` : ''}

CONVERSACIÓN (más antiguo primero)
${conversationText || '(Sin mensajes)'}

INSTRUCCIONES
- Máximo 3 oraciones en español mexicano natural
- Incluye: quién es, qué quiere/necesita, y cuál es el punto de fricción o por qué se escala
- Sin bullet points — texto corrido
- No empieces con "El broker" — sé directo
- Responde SOLO el resumen, sin preámbulo`

  try {
    const anthropic = new Anthropic({ apiKey })
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Genera el resumen.' }]
    })

    const summary = (response.content[0] as any).text as string
    res.json({ summary, contactName, stage: contact.stage, property: contact.property })
  } catch (err: any) {
    console.error('AI summarize error:', err)
    res.status(500).json({ error: err.message ?? 'AI request failed' })
  }
})

// GET /ai/usage
aiRouter.get('/usage', (req, res) => {
  const month = format(new Date(), 'yyyy-MM')
  const [row] = db(req)
    .select()
    .from(schema.apiUsage)
    .where(eq(schema.apiUsage.month, month))
    .all()
  res.json(row ?? { month, inputTokens: 0, outputTokens: 0 })
})
