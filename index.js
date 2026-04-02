const express = require('express')
const app = express()
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const QRCode = require('qrcode')
const pino = require('pino')
const { Redis } = require('@upstash/redis')

const PORT = process.env.PORT || 3000
const API_URL = process.env.API_URL || 'https://whatsapp-bot-lin.onrender.com/mensagem'

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

async function saveSession(sessionData) {
    try {
        await redis.set('whatsapp-session', JSON.stringify(sessionData))
        console.log('✅ Sessão salva no Redis')
    } catch (err) {
        console.error('❌ Falha ao salvar sessão:', err.message)
    }
}

async function loadSession() {
    try {
        const data = await redis.get('whatsapp-session')
        if (data) {
            console.log('✅ Sessão carregada do Redis')
            return JSON.parse(data)
        }
    } catch (err) {
        console.error('❌ Falha ao carregar sessão:', err.message)
    }
    return null
}

app.get('/', (req, res) => res.send('Conector WhatsApp ONLINE 🚀'))
app.get('/health', (req, res) => {
    res.json({
        status: sock?.user ? 'connected' : 'disconnected',
        uptime: process.uptime()
    })
})

let sock = null
let reconnectAttempts = 0

async function gerarEExibirQR(qrData) {
    // Tenta gerar QR no terminal (compacto)
    try {
        const qrImage = await QRCode.toString(qrData, { type: 'terminal', small: true })
        console.log('📱 QR Code (escaneie com WhatsApp):')
        console.log(qrImage)
    } catch (err) {
        console.error('Erro ao gerar QR:', err.message)
    }
    // Fallback: exibe link para gerar QR online
    const encodedQR = encodeURIComponent(qrData)
    console.log(`🔗 Caso o QR não apareça, acesse: https://quickchart.io/qr?text=${encodedQR}&size=300`)
}

async function start() {
    console.log('🚀 Iniciando conector...')

    const savedSession = await loadSession()
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')

    if (savedSession) {
        state.creds = savedSession.creds
        if (savedSession.keys) state.keys = savedSession.keys
        console.log('🔄 Estado restaurado do Redis')
    } else {
        console.log('🆕 Nenhuma sessão encontrada. QR será gerado.')
    }

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['Chrome (Linux)', 'Desktop', '1.0.0'],
        keepAliveIntervalMs: 25000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0
    })

    sock.ev.on('creds.update', async () => {
        const fullState = {
            creds: sock.authState.creds,
            keys: sock.authState.keys
        }
        await saveSession(fullState)
        saveCreds()
        console.log('💾 Credenciais salvas')
    })

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            console.log('📡 QR recebido, gerando imagem...')
            await gerarEExibirQR(qr)
        }

        if (connection === 'open') {
            reconnectAttempts = 0
            console.log('✅ Conectado ao WhatsApp!')
            console.log(`📱 Número do BOT: ${sock.user.id}`)
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut

            if (shouldReconnect) {
                const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 60000)
                reconnectAttempts++
                console.log(`🔄 Reconectando em ${delay/1000}s... (tentativa ${reconnectAttempts})`)
                setTimeout(start, delay)
            } else {
                console.log('❌ Desconectado permanentemente. Escaneie o QR novamente.')
            }
        }
    })

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]
        if (!msg.message || msg.key.fromMe) return

        const jid = msg.key.remoteJid
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text
        if (!text) return

        console.log(`📩 Mensagem de ${jid}: ${text}`)

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: jid, texto: text })
            })
            const data = await response.json()
            await sock.sendMessage(jid, { text: data.resposta || 'Erro' })
            console.log(`✅ Resposta enviada`)
        } catch (err) {
            console.error('❌ Erro ao chamar API:', err.message)
        }
    })
}

app.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`)
    start()
})