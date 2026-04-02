const express = require('express')
const app = express()

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys')

const QRCodeTerminal = require('qrcode-terminal')
const pino = require('pino')
const { Redis } = require('@upstash/redis')

// Fix fetch (Node compatível)
const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args))

// ENV
const PORT = process.env.PORT || 3000
const API_URL = process.env.API_URL
const API_TOKEN = process.env.API_TOKEN || '123456'

// Redis
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

// Segurança básica
process.on('uncaughtException', console.error)
process.on('unhandledRejection', console.error)

// Servidor HTTP
app.get('/', (req, res) => res.send('Conector WhatsApp ONLINE 🚀'))

app.get('/health', (req, res) => {
    res.json({
        status: sock?.user ? 'connected' : 'disconnected',
        uptime: process.uptime()
    })
})

let sock = null
let reconnectAttempts = 0

// SALVAR sessão
async function saveSession(session) {
    try {
        await redis.set('wa-session', JSON.stringify(session))
        console.log('✅ Sessão salva no Redis')
    } catch (err) {
        console.error('❌ Erro ao salvar sessão:', err.message)
    }
}

// CARREGAR sessão
async function loadSession() {
    try {
        const data = await redis.get('wa-session')
        if (data) {
            console.log('✅ Sessão carregada do Redis')
            return JSON.parse(data)
        }
    } catch (err) {
        console.error('❌ Erro ao carregar sessão:', err.message)
    }
    return null
}

async function start() {
    console.log('🚀 Iniciando bot...')

    const saved = await loadSession()

    const { state, saveCreds } = await useMultiFileAuthState('auth')

    if (saved) {
        state.creds = saved.creds
        state.keys = saved.keys
    }

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['Chrome', 'Desktop', '1.0.0'],
        keepAliveIntervalMs: 25000,
        connectTimeoutMs: 60000
    })

    // Salvar sessão sempre que atualizar
    sock.ev.on('creds.update', async () => {
        const session = {
            creds: sock.authState.creds,
            keys: sock.authState.keys
        }

        await saveSession(session)
        await saveCreds()
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            console.log('📱 Escaneie o QR abaixo:')
            QRCodeTerminal.generate(qr, { small: true })
        }

        if (connection === 'open') {
            reconnectAttempts = 0
            console.log('✅ Conectado com sucesso!')
            console.log(`📱 Bot: ${sock.user.id}`)
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode

            const shouldReconnect =
                code !== DisconnectReason.loggedOut

            if (shouldReconnect) {
                const delay = Math.min(5000 * 2 ** reconnectAttempts, 60000)
                reconnectAttempts++

                console.log(`🔄 Reconectando em ${delay / 1000}s...`)
                setTimeout(start, delay)
            } else {
                console.log('❌ Sessão expirada. Escaneie novamente.')
            }
        }
    })

    // RECEBER mensagens
    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const msg = messages[0]

            if (!msg.message || msg.key.fromMe) return

            const jid = msg.key.remoteJid

            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text

            if (!text) return

            console.log(`📩 ${jid}: ${text}`)

            // Timeout de 10s
            const controller = new AbortController()
            setTimeout(() => controller.abort(), 10000)

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_TOKEN}`
                },
                body: JSON.stringify({
                    from: jid,
                    texto: text
                }),
                signal: controller.signal
            })

            const data = await response.json()

            await sock.sendMessage(jid, {
                text: data.resposta || 'Erro ao responder'
            })

            console.log('✅ Resposta enviada')
        } catch (err) {
            console.error('❌ Erro geral:', err.message)
        }
    })
}

// START
app.listen(PORT, () => {
    console.log(`🌐 Rodando na porta ${PORT}`)
    start()
})