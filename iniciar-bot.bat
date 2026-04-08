
@echo off
title Instalador do Bot WhatsApp
:: Cria uma janela HTML com botão usando mshta
mshta "javascript:var janela=window; janela.resizeTo(450,350); janela.moveTo((screen.width-450)/2,(screen.height-350)/2); document.title='Instalador Bot WhatsApp'; var html='<html><body style=\"font-family:Segoe UI;text-align:center;background:#f0f2f5;padding:20px;\">'+'<h2 style=\"color:#075E54;\">🤖 Bot WhatsApp</h2>'+'<p>Clique no botão abaixo para instalar e iniciar o bot.<br>Tudo será feito automaticamente.</p>'+'<button id=\"btn\" style=\"background:#25D366;color:white;border:none;padding:12px 30px;font-size:18px;border-radius:30px;cursor:pointer;margin-top:20px;\">▶️ COMEÇAR</button>'+'</body></html>'; document.write(html); var btn=document.getElementById('btn'); btn.onclick=function(){ window.close(); var shell=new ActiveXObject('WScript.Shell'); shell.Run('\"%~f0\" /executar',0,false); }; setTimeout(function(){ if(btn) btn.style.backgroundColor='#128C7E'; },100); "
exit /b

:: Se o script for chamado com /executar, inicia a instalação
if "%1"=="/executar" goto :executar
exit /b

:executar
title Instalador Automático do Bot WhatsApp
echo ============================================
echo    Bot WhatsApp - Instalação Automática
echo ============================================
echo.

:: 1. Verificar/instalar Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js nao encontrado. Instalando automaticamente...
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements >nul 2>&1
    if %errorlevel% neq 0 (
        echo Baixando instalador manual...
        powershell -Command "Invoke-WebRequest -Uri https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi -OutFile %TEMP%\node.msi"
        msiexec /i "%TEMP%\node.msi" /qn /norestart
        del /f /q "%TEMP%\node.msi" 2>nul
    )
    echo Node.js instalado.
) else ( echo [OK] Node.js ja instalado. )

:: 2. Instalar PM2 globalmente
call npm install -g pm2 >nul 2>&1
echo [OK] PM2 instalado.

:: 3. Instalar dependências do projeto
echo Instalando dependencias do bot...
call npm install >nul 2>&1
echo [OK] Dependencias instaladas.

:: 4. Verificar se existe .env; se não, criar a partir do .env.example
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env >nul
        echo [AVISO] Arquivo .env criado a partir do .env.example.
        echo        Edite-o com o ID da empresa antes de iniciar (se necessário).
    ) else (
        echo [ERRO] Arquivo .env.example nao encontrado. Crie um arquivo .env manualmente.
        pause
        exit /b 1
    )
)

:: 5. Iniciar o bot com PM2
echo Iniciando o bot...
call pm2 start index.js --name "conector-wa" --update-env
call pm2 save

:: 6. Configurar inicialização automática (silencioso)
call pm2 startup >nul 2>&1

:: 7. Abrir QR code no navegador (aguarda 3s para o servidor subir)
echo Aguardando servidor...
timeout /t 3 /nobreak >nul
echo Abrindo QR code no navegador...
start http://localhost:3000/qr

:: 8. Mensagem final
msg %username% /time:8 "✅ Bot instalado e iniciado! QR code aberto no navegador. Escaneie com WhatsApp."
exit