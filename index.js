const express = require('express')
const app = express()

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys')

const pino = require('pino')
const QRCode = require('qrcode')

// Node 18+ já tem fetch
const fetch = global.fetch

const PORT = process.env.PORT || 3000

let sock = null
let reconnectAttempts = 0
let currentQR = null

// 🔥 PING (anti sleep)
const SELF_URL = process.env.SELF_URL

setInterval(async () => {
    try {
        if (SELF_URL) {
            await fetch(SELF_URL)
            console.log('🔄 Ping enviado')
        }
    } catch (err) {
        console.log('⚠️ Falha no ping')
    }
}, 5 * 60 * 1000) // 5 minutos

// ROTAS
app.get('/', (req, res) => {
    res.send('✅ ONLINE')
})

app.get('/health', (req, res) => {
    res.json({
        status: sock?.user ? 'connected' : 'disconnected'
    })
})

// QR VIA LINK
app.get('/qr', (req, res) => {
    if (!currentQR) {
        return res.send('⏳ Aguarde QR...')
    }

    res.send(`
    <html>
    <body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#111;color:#fff;flex-direction:column;">
        <h2>Escaneie o QR</h2>
        <img src="${currentQR}" />
    </body>
    </html>
    `)
})

async function start() {
    console.log('🚀 Iniciando bot...')

    const { state, saveCreds } = await useMultiFileAuthState('auth')

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['Chrome', 'Desktop', '1.0.0'],
        keepAliveIntervalMs: 30000,
        connectTimeoutMs: 120000,
        syncFullHistory: false
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            console.log('📱 QR disponível em /qr')
            currentQR = await QRCode.toDataURL(qr)
        }

        if (connection === 'open') {
            reconnectAttempts = 0
            currentQR = null
            console.log('✅ Conectado!')
        }

        if (connection === 'close') {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

            if (shouldReconnect) {
                if (reconnectAttempts < 5) {
                    reconnectAttempts++
                    const delay = Math.min(5000 * 2 ** reconnectAttempts, 60000)

                    console.log(`🔄 Tentando reconectar em ${delay / 1000}s...`)
                    setTimeout(start, delay)
                } else {
                    console.log('❌ Muitas tentativas. Aguarde novo deploy.')
                }
            } else {
                console.log('❌ Sessão expirada. Acesse /qr')
            }
        }
    })
}

// START
app.listen(PORT, () => {
    console.log(`🌐 Rodando na porta ${PORT}`)
    start()
})