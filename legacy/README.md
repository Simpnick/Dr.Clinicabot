# Chatbot Clínico - Google Workspace & WhatsApp Cloud API Oficial (OAuth 2.0)

Este projeto consiste em um Agente de IA para clínicas médicas individuais, conectando a **API Oficial do WhatsApp Cloud** diretamente às ferramentas de escritório do **Google Workspace** (Google Calendar, Sheets, Drive e Docs) do médico por meio de um fluxo de login simplificado (OAuth 2.0).

## 🚀 Arquitetura Simplificada
- **Interface:** WhatsApp do médico (comandos administrativos) e dos pacientes (agendamentos).
- **Orquestrador:** Agente de IA com Gemini-1.5-Flash (Function Calling).
- **Banco de Dados (Pacientes e Finanças):** Google Sheets.
- **Agenda:** Google Calendar.
- **Prontuários:** Google Docs (criados automaticamente e estruturados em uma pasta do Google Drive do médico).

---

## 🛠️ Configuração e Integração com o Google

### 1. Criar Credenciais OAuth no Google Cloud Console
1. Acesse o [Google Cloud Console](https://console.cloud.google.com).
2. Crie um novo projeto ou selecione um existente.
3. No menu lateral, acesse **APIs e Serviços** > **Biblioteca** e ative as seguintes APIs:
   - *Google Sheets API*
   - *Google Calendar API*
   - *Google Drive API*
   - *Google Docs API*
4. Acesse **APIs e Serviços** > **Tela de consentimento OAuth**:
   - Escolha o tipo de usuário (External/Externo).
   - Preencha os dados do aplicativo (nome, e-mail de suporte).
   - Adicione os escopos necessários (Calendar, Sheets, Drive, Documents).
   - Adicione o seu e-mail (ou o do médico) como usuário de teste (Test Users), pois o app está em modo de teste/desenvolvimento.
5. Acesse **APIs e Serviços** > **Credenciais**:
   - Clique em **Criar Credenciais** > **ID do cliente OAuth**.
   - Tipo de aplicativo: *Aplicativo da Web (Web Application)*.
   - Adicione a URI de Redirecionamento autorizada: `http://localhost:3000/auth/google/callback` (substitua pelo domínio real caso publique em nuvem).
   - Copie o **Client ID** e **Client Secret** gerados.

### 2. Configurar o Arquivo `.env`
Renomeie ou copie o arquivo `.env.example` para `.env` e preencha com as suas chaves:
```bash
PORT=3000
DOCTOR_PHONE=5511999999999 # WhatsApp do médico (com DDD e DDI)
GEMINI_API_KEY=sua_chave_gemini_aqui

GOOGLE_CLIENT_ID=seu_client_id_gerado
GOOGLE_CLIENT_SECRET=seu_client_secret_gerado
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

GOOGLE_SPREADSHEET_ID=id_da_planilha # Pode ser preenchido após criar uma planilha em branco

WHATSAPP_PHONE_NUMBER_ID=seu_phone_number_id_da_meta
WHATSAPP_ACCESS_TOKEN=seu_access_token_da_meta
WHATSAPP_VERIFY_TOKEN=sua_verify_token_definida_aqui
```

### 3. Rodar e Conectar a Conta do Médico
1. Instale as dependências:
   ```bash
   npm install
   ```
2. Inicialize o servidor em modo de desenvolvimento:
   ```bash
   npm run dev
   ```
3. Abra o navegador e acesse a rota de autenticação:
   `http://localhost:3000/auth/google`
4. Faça o login com a conta Google do médico e autorize as permissões.
5. Pronto! O servidor salvará um arquivo `tokens.json` na raiz do projeto e gerará automaticamente as tabelas de controle no Google Sheets e as pastas no Google Drive do médico. O sistema agora está ativo e conectado de forma permanente.

---

## 📞 Integração com WhatsApp (API Oficial Cloud)

Consulte o guia passo a passo em [configurar-whatsapp-oficial.md](file:///c:/AI/clinica-chatbot/docs/configurar-whatsapp-oficial.md) para ver como registrar sua conta no Meta Developers, configurar seu aplicativo, obter chaves de produção/testes e expor seu webhook localmente ou na nuvem.
