const express = require('express')
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const Pino = require('pino')
const { Redis } = require('@upstash/redis')

const app = express()
const PORT = process.env.PORT || 3000
const API_URL = process.env.API_URL || 'https://whatsapp-bot-lin.onrender.com/mensagem'

// Configuração do Redis (persistência da sessão)
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

// Variáveis de controle
let sock = null
let reconnectAttempts = 0
let pairingCodeRequested = false

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

// Servidor HTTP (keep-alive e status)
app.get('/', (req, res) => res.send('Conector WhatsApp ONLINE 🚀'))
app.get('/health', (req, res) => {
    res.json({
        status: sock?.user ? 'connected' : 'disconnected',
        uptime: process.uptime(),
        reconnectAttempts
    })
})

// Função principal do bot
async function start() {
    console.log('🚀 Iniciando conector...')

    // Carrega sessão salva (se existir)
    const savedSession = await loadSession()
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')

    if (savedSession) {
        state.creds = savedSession.creds
        if (savedSession.keys) state.keys = savedSession.keys
        console.log('🔄 Estado restaurado do Redis')
    } else {
        console.log('🆕 Nenhuma sessão encontrada. Pairing code será gerado.')
        pairingCodeRequested = false
    }

    sock = makeWASocket({
        logger: Pino({ level: 'silent' }),
        auth: state,
        browser: ['Chrome (Linux)', 'Desktop', '1.0.0'],
        keepAliveIntervalMs: 30000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        printQRInTerminal: false,  // Desabilita QR no terminal (usamos pairing code)
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

        // Se não estiver registrado e ainda não pedimos o pairing code
        if (connection === 'connecting' && !sock.authState.creds.registered && !pairingCodeRequested) {
            pairingCodeRequested = true
            // Número do telefone que vai receber o código (BOT)
            // Você deve informar o número completo no formato internacional (ex: 5511999999999)
            // Use uma variável de ambiente ou defina aqui
            const phoneNumber = process.env.BOT_PHONE_NUMBER || '558596364974'  // seu número do bot
            console.log(`🔑 Solicitando código de pareamento para ${phoneNumber}...`)
            try {
                const code = await sock.requestPairingCode(phoneNumber)
                console.log(`📲 SEU CÓDIGO DE PAREAMENTO: ${code}`)
                console.log(`👉 Digite esse código no WhatsApp → Aparelhos conectados → Conectar com número de telefone`)
            } catch (err) {
                console.error('❌ Erro ao solicitar código de pareamento:', err.message)
                console.log('⚠️ Fallback: gerando QR code...')
                // Fallback: se o pairing falhar, tenta gerar QR
                if (qr) {
                    console.log('📱 QR Code gerado! Acesse /qr para escanear.')
                    // Você pode implementar a rota /qr se quiser
                }
            }
        }

        if (qr && !sock.authState.creds.registered) {
            // Caso o pairing não seja usado, mostra QR (fallback)
            console.log('📱 QR Code disponível (fallback).')
            // Se quiser, pode salvar o QR em uma variável global para exibir via rota /qr
            // currentQR = qr
        }

        if (connection === 'open') {
            reconnectAttempts = 0
            pairingCodeRequested = false
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
                console.log('❌ Desconectado permanentemente. É necessário re-parear.')
                pairingCodeRequested = false
                // Limpa sessão para forçar novo pareamento
                await redis.del('whatsapp-session')
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

// Inicia o servidor HTTP e o bot
app.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`)
    start()
})