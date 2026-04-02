const express = require('express')
const app = express()
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const QRCodeTerminal = require('qrcode-terminal')
const pino = require('pino')
const { Redis } = require('@upstash/redis')

const PORT = process.env.PORT || 3000
const API_URL = process.env.API_URL || 'https://whatsapp-bot-lin.onrender.com/mensagem'

// Configurar Redis
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

// Funções de persistência
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

// Função para gerar QR manualmente (forçado)
function gerarQR(qr) {
    console.log('📱 QR Code gerado! Escaneie com o WhatsApp:')
    QRCodeTerminal.generate(qr, { small: true })
}

async function start() {
    console.log('🚀 Iniciando conector...')

    // Log para verificar se Redis está configurado
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        console.error('❌ Redis não configurado! Verifique as variáveis de ambiente.')
    }

    // Carregar sessão salva
    const savedSession = await loadSession()

    const { state, saveCreds } = await useMultiFileAuthState('auth_info')

    if (savedSession) {
        state.creds = savedSession.creds
        if (savedSession.keys) state.keys = savedSession.keys
        console.log('🔄 Estado restaurado do Redis')
    } else {
        console.log('🆕 Nenhuma sessão encontrada. Será gerado um novo QR code.')
    }

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['Chrome (Linux)', 'Desktop', '1.0.0'],
        keepAliveIntervalMs: 25000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        printQRInTerminal: true  // força QR no terminal se não houver sessão
    })

    sock.ev.on('creds.update', async () => {
        const fullState = {
            creds: sock.authState.creds,
            keys: sock.authState.keys
        }
        await saveSession(fullState)
        saveCreds()
        console.log('💾 Credenciais atualizadas e salvas')
    })

    sock.ev.on('connection.update', (update) => {
        console.log('📡 Update recebido:', Object.keys(update).join(', '))
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            gerarQR(qr)
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

// Inicia servidor e bot
app.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`)
    start()
})