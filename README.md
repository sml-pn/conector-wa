# 🤖 Conector WhatsApp – Instalação Automática

Este programa permite conectar seu WhatsApp ao sistema de atendimento automático.

## 📦 Pré‑requisitos
- Windows 10 ou 11 (recomendado)
- Acesso à internet (para baixar Node.js e dependências)

## 🚀 Como instalar e rodar

1. **Extraia** a pasta `conector-wa` em qualquer local do seu computador.
2. **Dê dois cliques** no arquivo `iniciar-bot.bat`.
3. Uma janela com um botão **“COMEÇAR”** aparecerá. Clique nele.
4. Aguarde a instalação automática (pode levar alguns minutos).
5. Ao final, seu navegador abrirá uma página com um **QR Code**.
6. Abra o WhatsApp no celular → **Configurações** → **Aparelhos conectados** → **Conectar um aparelho**.
7. Escaneie o QR Code.

✅ **Pronto!** Seu bot está ativo. Toda vez que o computador ligar, ele iniciará sozinho.

## 🛠️ Personalização (apenas se necessário)

Caso queira alterar para qual empresa o bot responde, edite o arquivo **`.env`** (criado automaticamente) e mude o número do `ID_DA_EMPRESA` para o ID correto.

## 📊 Verificar se o bot está rodando

- Abra o **Prompt de Comando** (CMD) como administrador.
- Digite `pm2 list` – você verá o processo `conector-wa` com status `online`.

## ❌ Problemas comuns

| Problema | Solução |
|----------|---------|
| Janela de erro ao executar o `.bat` | Execute como administrador (clique direito → Executar como administrador). |
| QR Code não aparece | Aguarde 10 segundos após a mensagem “Servidor rodando”. Tente acessar `http://localhost:3000/qr` manualmente. |
| Bot não responde | Verifique se o arquivo `.env` contém a URL correta do webhook. |

---

Desenvolvido com 💪 SML_PN