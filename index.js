const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const QRCodeTerminal = require('qrcode-terminal'); // ← adicione esta lib para QR no terminal

const app = express();
const PORT = process.env.PORT || 3000;

let sock = null;
let reconnectAttempts = 0;
let currentQR = null;

// Ping automático (opcional – só se você rodar em nuvem)
const SELF_URL = process.env.SELF_URL;
if (SELF_URL) {
    setInterval(async () => {
        try {
            await fetch(SELF_URL);
            console.log('🔄 Ping enviado');
        } catch (err) {}
    }, 5 * 60 * 1000);
}

// Rota principal
app.get('/', (req, res) => res.send('✅ Conector WhatsApp ONLINE'));

app.get('/health', (req, res) => res.json({ status: sock?.user ? 'connected' : 'disconnected' }));

// Rota QR (útil se você acessar via navegador)
app.get('/qr', async (req, res) => {
    if (!currentQR) return res.send('⏳ Aguardando QR...');
    res.send(`
        <html>
        <body style="text-align:center;font-family:sans-serif;">
            <h2>Escaneie o QR code</h2>
            <img src="${currentQR}" style="max-width:300px;">
        </body>
        </html>
    `);
});

async function start() {
    console.log('🚀 Iniciando conector...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['Chrome (Linux)', 'Desktop', '1.0.0'],
        keepAliveIntervalMs: 30000,
        connectTimeoutMs: 120000,
        printQRInTerminal: true   // ← força QR no terminal (funciona no Termux)
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            // Gera QR para a rota /qr (opcional)
            currentQR = await QRCode.toDataURL(qr);
            // Gera QR diretamente no terminal (essencial para Termux)
            QRCodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'open') {
            reconnectAttempts = 0;
            currentQR = null;
            console.log('✅ Conectado ao WhatsApp!');
            console.log(`📱 Número do BOT: ${sock.user.id}`);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect && reconnectAttempts < 10) {
                const delay = Math.min(5000 * 2 ** reconnectAttempts, 60000);
                reconnectAttempts++;
                console.log(`🔄 Reconectando em ${delay / 1000}s...`);
                setTimeout(start, delay);
            } else {
                console.log('❌ Desconectado permanentemente. Reinicie o conector.');
            }
        }
    });

    // 🔗 Webhook para seu painel multi-empresa
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const texto = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!texto) return;

        console.log(`📩 Mensagem de ${jid}: ${texto}`);

        try {
            // ⚠️ ALTERE AQUI: coloque o ID da sua empresa (veja no painel)
            const EMPRESA_ID = '1775240521793';
            const API_URL = `https://whatsapp-bot-multi.onrender.com/webhook/${EMPRESA_ID}`;

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: jid, texto })
            });
            const data = await response.json();
            await sock.sendMessage(jid, { text: data.resposta || 'Erro' });
            console.log(`✅ Resposta enviada`);
        } catch (err) {
            console.error('❌ Erro ao chamar API:', err.message);
            await sock.sendMessage(jid, { text: 'Erro no servidor. Tente novamente.' });
        }
    });
}

app.listen(PORT, () => {
    console.log(`🌐 Servidor rodando em http://localhost:${PORT}`);
    start();
});