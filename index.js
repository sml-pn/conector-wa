require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCodeTerminal = require('qrcode-terminal');
const axios = require('axios');

// ========== CONFIGURAÇÃO ==========
const API_URL = process.env.API_URL;
if (!API_URL) {
    console.error('❌ ERRO CRÍTICO: Variável API_URL não definida no arquivo .env');
    console.error('   Crie um arquivo .env com: API_URL=https://...');
    process.exit(1);
}
console.log(`🌐 Webhook configurado: ${API_URL}`);

// ========== FUNÇÃO PRINCIPAL ==========
async function start() {
    console.log('🚀 Iniciando conector WhatsApp...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        browser: ['Chrome (Linux)', 'Desktop', '1.0.0'],
        printQRInTerminal: true,   // gera QR no terminal
        logger: { level: 'silent' } // reduz ruído
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('📱 QR Code gerado! Escaneie com WhatsApp:');
            QRCodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('✅ Conectado ao WhatsApp com sucesso!');
            console.log(`📱 Número do BOT: ${sock.user.id}`);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('🔄 Conexão fechada. Tentando reconectar em 5 segundos...');
                setTimeout(start, 5000);
            } else {
                console.log('❌ Logout detectado. Escaneie o QR novamente (arquivo .env)');
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        const timestamp = new Date().toLocaleTimeString();
        console.log(`\n📩 [${timestamp}] Mensagem de ${jid}: ${text}`);
        console.log(`📤 Enviando para o webhook...`);

        try {
            const response = await axios.post(API_URL, { from: jid, texto: text });
            const resposta = response.data.resposta || 'Erro: resposta vazia do servidor';
            await sock.sendMessage(jid, { text: resposta });
            console.log(`✅ Resposta enviada: ${resposta.substring(0, 50)}...`);
        } catch (err) {
            console.error(`❌ Erro no webhook: ${err.message}`);
            await sock.sendMessage(jid, { text: '⚠️ Servidor indisponível. Tente novamente mais tarde.' });
        }
    });
}

// ========== INÍCIO ==========
start();