const express = require('express')
const app = express()

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys')

const pino = require('pino')
const QRCode = require('qrcode')

// FIX FETCH
const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args))

// ENV
const PORT = process.env.PORT || 3000
const API_URL = process.env.API_URL
const API_TOKEN = process.env.API_TOKEN || '123456'

// Segurança
process.on('uncaughtException', console.error)
process.on('unhandledRejection', console.error)

let sock = null
let reconnectAttempts = 0
let currentQR = null

// 🌐 ROTAS
app.get('/', (req, res) => {
    res.send('✅ Conector WhatsApp ONLINE')
})

app.get('/health', (req, res) => {
    res.json({
        status: sock?.user ? 'connected' : 'disconnected',
        uptime: process.uptime()
    })
})

// 🔥 ROTA DO QR
app.get('/qr', (req, res) => {
    if (!currentQR) {
        return res.send('⏳ QR ainda não disponível. Aguarde...')
    }

    res.send(`
        <html>
        <head>
            <title>QR Code WhatsApp</title>
        </head>
        <body style="
            display:flex;
            justify-content:center;
            align-items:center;
            height:100vh;
            background:#0f172a;
            color:white;
            flex-direction:column;
            font-family:Arial;
        ">
            <h2>📱 Escaneie o QR Code</h2>
            <img src="${currentQR}" />
        </body>
        </html>
    `)
})

// 🚀 BOT
async function start() {
    console.log('🚀 Iniciando bot...')

    const { state, saveCreds } = await useMultiFileAuthState('auth')

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['Chrome', 'Desktop', '1.0.0'],
        keepAliveIntervalMs: 25000,
        connectTimeoutMs: 120000,
        syncFullHistory: false,
        markOnlineOnConnect: false
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        // 🔥 GERAR QR COMO IMAGEM
        if (qr) {
            console.log('📱 QR gerado! Acesse /qr')
            currentQR = await QRCode.toDataURL(qr)
        }

        if (connection === 'open') {
            reconnectAttempts = 0
            currentQR = null
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
                console.log('❌ Sessão encerrada. Acesse /qr para reconectar.')
            }
        }
    })

    // 📩 MENSAGENS
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