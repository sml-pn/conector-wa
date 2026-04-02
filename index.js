const express = require('express')
const app = express()

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys')

const QRCodeTerminal = require('qrcode-terminal')
const pino = require('pino')

// FIX FETCH
const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args))

// ENV
const PORT = process.env.PORT || 3000
const API_URL = process.env.API_URL
const API_TOKEN = process.env.API_TOKEN || '123456'

// Segurança contra crash
process.on('uncaughtException', console.error)
process.on('unhandledRejection', console.error)

let sock = null
let reconnectAttempts = 0

// Servidor HTTP
app.get('/', (req, res) => {
    res.send('✅ Conector WhatsApp ONLINE')
})

app.get('/health', (req, res) => {
    res.json({
        status: sock?.user ? 'connected' : 'disconnected',
        uptime: process.uptime()
    })
})

async function start() {
    console.log('🚀 Iniciando bot...')

    const { state, saveCreds } = await useMultiFileAuthState('auth')

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['Chrome', 'Desktop', '1.0.0'],
        keepAliveIntervalMs: 25000,
        connectTimeoutMs: 60000
    })

    // Salvar sessão automaticamente (arquivos locais)
    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            console.log('📱 Escaneie o QR abaixo:')
            QRCodeTerminal.generate(qr, { small: true })
        }

        if (connection === 'open') {
            reconnectAttempts = 0
            console.log('✅ Conectado ao WhatsApp!')
            console.log(`📱 Bot: ${sock.user.id}`)
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode

            const shouldReconnect =
                statusCode !== DisconnectReason.loggedOut

            if (shouldReconnect) {
                if (reconnectAttempts < 5) {
                    const delay = Math.min(5000 * 2 ** reconnectAttempts, 60000)
                    reconnectAttempts++

                    console.log(`🔄 Reconectando em ${delay / 1000}s...`)
                    setTimeout(start, delay)
                } else {
                    console.log('❌ Muitas tentativas. Reinicie o serviço.')
                }
            } else {
                console.log('❌ Sessão encerrada. Escaneie novamente.')
            }
        }
    })

    // Receber mensagens
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

            // Timeout
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
            console.error('❌ Erro:', err.message)
        }
    })
}

// START
app.listen(PORT, () => {
    console.log(`🌐 Rodando na porta ${PORT}`)
    start()
})