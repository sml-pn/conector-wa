const express = require('express')
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const Pino = require('pino')
const { Redis } = require('@upstash/redis')
const QRCode = require('qrcode')

const app = express()
const PORT = process.env.PORT || 3000
const API_URL = process.env.API_URL || 'https://whatsapp-bot-lin.onrender.com/mensagem'

// Redis (persistência da sessão)
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

// Variáveis globais
let sock = null
let reconnectAttempts = 0
let isPairingRequested = false
let currentQR = null

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

// Rota para exibir QR code (fallback)
app.get('/qr', async (req, res) => {
    if (!currentQR) {
        return res.send(`
            <html><body>
                <h1>QR Code não disponível</h1>
                <p>Aguardando conexão... O QR aparecerá em breve.</p>
                <meta http-equiv="refresh" content="5">
            </body></html>
        `)
    }
    try {
        const qrImage = await QRCode.toDataURL(currentQR)
        res.send(`
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Escaneie o QR Code</title>
            </head>
            <body style="text-align:center; font-family:Arial; padding:20px;">
                <h2>📱 Escaneie o QR code com o WhatsApp</h2>
                <img src="${qrImage}" style="max-width:300px; width:100%; border:1px solid #ccc; border-radius:10px;">
                <p>Abra o WhatsApp → Aparelhos conectados → Conectar um aparelho</p>
                <p><small>Este QR é válido por alguns minutos. Se expirar, recarregue a página.</small></p>
            </body>
            </html>
        `)
    } catch (err) {
        res.send('Erro ao gerar QR code')
    }
})

app.get('/', (req, res) => res.send('Conector WhatsApp ONLINE 🚀'))
app.get('/health', (req, res) => {
    res.json({
        status: sock?.user ? 'connected' : 'disconnected',
        uptime: process.uptime(),
        reconnectAttempts,
        pairingRequested: isPairingRequested
    })
})

// Função principal
async function start() {
    console.log('🚀 Iniciando conector...')

    const savedSession = await loadSession()
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')

    if (savedSession) {
        state.creds = savedSession.creds
        if (savedSession.keys) state.keys = savedSession.keys
        console.log('🔄 Estado restaurado do Redis')
    } else {
        console.log('🆕 Nenhuma sessão encontrada. Pairing code será gerado.')
        isPairingRequested = false
    }

    sock = makeWASocket({
        logger: Pino({ level: 'silent' }),
        auth: state,
        browser: ['Chrome (Linux)', 'Desktop', '1.0.0'],
        keepAliveIntervalMs: 30000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        printQRInTerminal: false,
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

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        // Atualiza QR code para fallback
        if (qr) {
            currentQR = qr
        }

        // Pairing code
        if (connection === 'connecting' && !sock.authState.creds.registered && !isPairingRequested) {
            isPairingRequested = true
            const phoneNumber = process.env.BOT_PHONE_NUMBER || '558596364974'
            console.log(`🔑 Solicitando código de pareamento para ${phoneNumber}...`)
            try {
                const code = await sock.requestPairingCode(phoneNumber)
                console.log(`📲 SEU CÓDIGO DE PAREAMENTO: ${code}`)
                console.log(`👉 Digite esse código no WhatsApp → Aparelhos conectados → Conectar com número de telefone`)
                // Aguarda 60 segundos antes de permitir nova solicitação
                setTimeout(() => { isPairingRequested = false }, 60000)
            } catch (err) {
                console.error('❌ Erro ao solicitar código de pareamento:', err.message)
                console.log('⚠️ Tentando novamente em 10 segundos...')
                setTimeout(() => { isPairingRequested = false }, 10000)
            }
        }

        if (connection === 'open') {
            reconnectAttempts = 0
            isPairingRequested = false
            currentQR = null
            console.log('✅ Conectado ao WhatsApp!')
            console.log(`📱 Número do BOT: ${sock.user.id}`)
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect && !isPairingRequested) {
                const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 60000)
                reconnectAttempts++
                console.log(`🔄 Reconectando em ${delay/1000}s... (tentativa ${reconnectAttempts})`)
                setTimeout(start, delay)
            } else if (statusCode === DisconnectReason.loggedOut) {
                console.log('❌ Desconectado permanentemente. É necessário re-parear.')
                isPairingRequested = false
                await redis.del('whatsapp-session')
                setTimeout(start, 5000)
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
            await sock.sendMessage(jid, { text: data.resposta || 'Erro interno' })
            console.log(`✅ Resposta enviada`)
        } catch (err) {
            console.error('❌ Erro ao chamar API:', err.message)
            await sock.sendMessage(jid, { text: '⚠️ Erro no servidor. Tente novamente.' })
        }
    })
}

// Inicia servidor e bot
app.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`)
    start()
})