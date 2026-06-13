# 🩺 Chatbot Clínico v2.0.0

Este repositório contém o **Chatbot Clínico Modular** desenvolvido para automação de atendimentos e triagem de pacientes em clínicas médicas. Ele conecta a **API Oficial do WhatsApp Cloud (Meta)** às ferramentas do **Google Workspace** (Calendar, Sheets, Docs e Drive), utilizando inteligência artificial orquestrada (Gemini / LLM local) para agendamentos e geração automatizada de prontuários.

O sistema conta com um **Painel Administrativo Web** que permite simulação de mensagens, visualização em tempo real do estado da triagem dos pacientes e diagnósticos gerais.

---

## 🏗️ Arquitetura do Projeto

O projeto foi totalmente reestruturado sob princípios de **Clean Architecture** e modularidade para garantir alta testabilidade e facilidade de manutenção:

```text
src/
├── server.ts              # Ponto de entrada do servidor Express
├── config/                # Gerenciamento de variáveis de ambiente e constantes (.env)
├── core/                  # Regras de Negócio Puras (Enterprise Rules)
│   ├── triage/            # Lógica de triagem, FAQ e fluxo de perguntas
│   ├── scheduler/         # Lógica da agenda, cotas, idades e categorias
│   └── domain/            # Interfaces e tipos globais
├── services/              # Gateways e Adaptadores de Integração Externa
│   ├── llm/               # Orquestrador de IA (LM Studio / Gemini Studio)
│   ├── google/            # Integrações com APIs Google Sheets, Docs e Calendar
│   └── whatsapp/          # API Oficial do WhatsApp Cloud
└── views/                 # Arquivos estáticos e Painel de Controle (/setup)
```

---

## 🚀 Como Iniciar (Servidor Local)

### 1. Instalação de Dependências
Certifique-se de ter o [Node.js](https://nodejs.org/) instalado na máquina. No terminal do projeto, execute:
```bash
npm install
```

### 2. Configuração do `.env`
Duplique o arquivo `.env.example` e renomeie-o para `.env`. Configure as suas credenciais:
* **LLM:** Defina se usará `gemini` (API Key do Google AI Studio) ou `lm-studio` (LLM rodando localmente).
* **Google Cloud:** Insira o Client ID, Client Secret e Redirect URI configurados no seu painel do Google Cloud Console.
* **WhatsApp Cloud API:** Configure o ID do número de telefone, o token de acesso temporário/permanente da Meta e o token de verificação.

### 3. Execução
Inicie o servidor em ambiente de desenvolvimento:
```bash
npm run dev
```
O servidor estará disponível por padrão em `http://localhost:3000`.

---

## 🌐 Integração com WhatsApp & Webhook (ngrok)

Para testar localmente as mensagens reais enviadas ao WhatsApp, você deve expor a porta local usando um túnel como o **ngrok**:

```bash
ngrok http 3000 --domain=unworn-kristina-unrecorded.ngrok-free.dev
```

No painel de desenvolvedores da Meta (**Facebook Developers** > seu app do WhatsApp):
1. **Webhook URL (URL de Retorno):** `https://unworn-kristina-unrecorded.ngrok-free.dev/webhook/whatsapp`
2. **Token de Verificação:** `clinica_chatbot_verify_token_123` (ou o configurado no seu `.env`).

---

## 💻 Painel Administrativo (`/setup`)

Acesse **`http://localhost:3000/setup`** no seu navegador para gerenciar e testar o bot visualmente:
* **Transparência de Conversas:** Veja em tempo real todas as mensagens e o estado da máquina de triagem dos pacientes.
* **Simulador de Mensagens:** Envie mensagens de teste fingindo ser um paciente diretamente pelo navegador, sem custos ou necessidade de celulares físicos.
* **Configuração Dinâmica:** Edite perguntas, fluxos da triagem e altere chaves de API / arquivos `.env`.

---

## 🧪 Suíte de Testes e Simulações

Adotamos a filosofia de **Extreme Programming (XP)**, mantendo testes automatizados robustos e simulações completas do comportamento da triagem.

### 1. Testes de Unidade e Integração (Vitest)
Rode a suíte de testes com o comando:
```bash
npm run test
```
Para ver a cobertura de testes:
```bash
npm run test:coverage
```

### 2. Simulações Completas via Script
* **Validação do Checklist Geral:** Valida dezenas de cenários de fluxos esperados descritos em `Check List.md`:
  ```bash
  npx ts-node run_checklist.ts
  ```
* **Jornadas de Paciente Completas:** Roda simulações de jornadas realistas no terminal e exporta o histórico para `manual_test_transcript.txt`:
  ```bash
  npx ts-node test_manual_simulation.ts
  ```

---

## 🛠️ Tecnologias Utilizadas

* **Runtime:** Node.js, TypeScript, Express
* **Orquestração de IA:** SDK Google Gen AI (`@google/genai`) e APIs compatíveis com OpenAI (LM Studio)
* **Ferramentas Google:** `googleapis` v134 (Google Sheets API, Google Calendar API, Google Drive API, Google Docs API)
* **Testes:** Vitest
* **Interface Administrativa:** HTML5, Vanilla CSS e Vanilla JavaScript
