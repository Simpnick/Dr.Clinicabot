# 📖 Manual de Execução e Testes do Chatbot Clínico

Este guia explica de forma simples e direta como rodar o chatbot, configurar o ambiente, executar testes automatizados e realizar simulações de atendimento.

---

## 🚀 1. Como Iniciar o Chatbot (Servidor Local)

### Pré-requisitos
Certifique-se de ter o [Node.js](https://nodejs.org/) instalado na máquina.

### Passos para rodar:
1. Abra um terminal na pasta raiz do projeto (`c:\AI\clinica-chatbot`).
2. Se for a primeira vez ou se houver novas dependências, instale-as:
```
npm install
```
3. Inicie o servidor em modo de desenvolvimento:
```
npm run dev
```
4. O servidor iniciará por padrão na porta `3000`. Você verá a mensagem no console:
```text
Servidor rodando com sucesso na porta 3000!
Painel Administrativo: http://localhost:3000/setup
```

### 🌐 1.1. Como Iniciar o Túnel do Webhook (ngrok)

Para que o WhatsApp envie as mensagens ao seu chatbot rodando localmente, inicie o túnel utilizando o seu domínio estático configurado:

```
ngrok http 3000 --domain=unworn-kristina-unrecorded.ngrok-free.dev
```

1. Acesse o painel do [**Facebook Developers**](https://developers.facebook.com/apps/) (entre no seu aplicativo e vá em **WhatsApp > Configuração**).
2. Configure a URL de retorno e o token com os dados abaixo:
   * **URL de retorno (Webhook URL):** `https://unworn-kristina-unrecorded.ngrok-free.dev/webhook/whatsapp`
   * **Token de Verificação:** `clinica_chatbot_verify_token_123`

---

## 💻 2. Painéis Administrativos e Workspace do Médico

O sistema possui duas interfaces principais de controle protegidas por credenciais de autenticação básica (Usuário: `admin` | Senha: `drtonelli2026` — configuráveis via `.env`):

### 🌐 2.1. Painel de Configurações (/setup)
Acesse **`http://localhost:3000/setup`** no seu navegador para gerenciar e testar o bot visualmente:
*   **Aba Transparência de Conversas:** Veja em tempo real todas as mensagens enviadas/recebidas e o estado atual da triagem para cada telefone.
*   **Aba Simulação de Mensagem:** Envie mensagens de teste simulando a perspectiva do paciente diretamente pelo navegador (sem custos de API do WhatsApp).
*   **Aba Configuração do Bot:** Altere os campos e ordem da triagem dinamicamente.
*   **Aba Credenciais & Configurações:** Altere as chaves de API (Gemini, Google OAuth, WhatsApp Cloud API) e gerencie o arquivo `.env`.
*   **Aba Dados & Diagnóstico:** 
    *   **Apagar Tudo:** Botão para limpar todas as sessões e históricos no disco. Use esta opção para reiniciar os testes do zero e evitar que estados antigos involuntários interrompam os novos testes.

### 🩺 2.2. Workspace Centralizado do Médico (/dashboard)
Acesse **`http://localhost:3000/dashboard`** no seu navegador para abrir a área de trabalho unificada do Dr. Carlos Tonelli. Ela é dividida em **três colunas interativas integradas na mesma tela**:

1.  **Coluna 1 — Fila Virtual de Espera:**
    *   Gerenciamento em tempo real dos pacientes que chegaram fisicamente à clínica.
    *   Crachás visuais com o status atual: `Aguardando` (laranja), `Em Consulta` (roxo) ou `Atendido` (verde).
    *   Ações rápidas:
        *   **Chamar:** Altera o status para *Em Consulta* e carrega o prontuário do paciente automaticamente no centro (Coluna 2).
        *   **Finalizar:** Conclui a consulta do paciente.
        *   **Remover:** Tira o paciente da fila de espera física.
    *   **Entrada de Paciente:** Caixa de busca com dropdown autocompletar que pesquisa no banco local e adiciona o paciente selecionado na fila de espera com um clique.
    *   **Busca de Prontuários:** Permite pesquisar e carregar o prontuário de qualquer paciente do consultório a qualquer momento.

2.  **Coluna 2 — Prontuário & Evolução Clínica:**
    *   Exibe os dados cadastrais (Nome, Idade, Convênio, Número de Carteirinha e se aceitou os termos da clínica).
    *   Mostra em destaque a **Queixa Principal** coletada na triagem do WhatsApp e a **Receita/Medicamento** solicitado.
    *   **Histórico de Evoluções (Timeline):** Linha do tempo mostrando as anotações e evoluções clínicas anteriores com data, hora e autoria.
    *   **Nova Evolução:** Caixa de texto para o médico registrar o prontuário da consulta atual. O salvamento é instantâneo e assinado automaticamente pelo *Dr. Carlos Tonelli*.

3.  **Coluna 3 — Agenda Diária de Horários:**
    *   Exibe o calendário diário organizado em grandes faixas de horários das 13h às 20h.
    *   Os slots ocupados exibem apenas as informações críticas definidas pelo Dr. Carlos: **Nome do Paciente**, **Idade** e **Queixa/Sintoma**.
    *   Clicar em um slot ocupado carrega na hora o prontuário correspondente no centro (Coluna 2).
    *   Clicar em um slot vazio abre o assistente de agendamento manual rápido.
    *   **Controle de Intervalo:** Seletor dinâmico para ajustar o tempo de intervalo das consultas (15m, 20m, 30m ou 60m). Ao mudar, o valor é persistido nas configurações gerais e a grade de horários da tela é recalculada na hora.

---

## 🧪 3. Como Executar Testes

Temos três formas de testar o chatbot: **Testes de Código (Vitest)**, **Simulações Automatizadas por Script** e **Testes Manuais via WhatsApp**.

### 3.1. Testes de Código (Vitest)
São testes unitários e de integração que validam as funções isoladas do código (como a lógica de agendamento e triagem).

*   **Executar todos os testes uma vez:**
```
npm run test
```
*   **Executar em modo contínuo (Watch Mode - roda sozinho ao alterar arquivos):**
```
npm run test:watch
```
*   **Verificar a cobertura de testes (Test Coverage):**
```
npm run test:coverage
```

### 3.2. Simulações Automatizadas (Scripts)
Esses scripts simulam conversas inteiras pela máquina de estados sem precisar subir o servidor web.

*   **Roteiro de Checklist Geral (`run_checklist.ts`):**
    Valida dezenas de casos de teste (Grupo A ao M) descritos em `Check List.md`.
```
npx ts-node run_checklist.ts
```
*   **Jornadas de Paciente Completas (`test_manual_simulation.ts`):**
    Roda 4 cenários realistas e grava a transcrição completa da conversa no arquivo `manual_test_transcript.txt`.
```
npx ts-node test_manual_simulation.ts
```
*   **Teste de Reprodução Rápido (`test_reproduce.ts`):**
    Um script simples de 4 passos para verificar a saudação e início do agendamento.
```
npx ts-node test_reproduce.ts
```

### 3.3. Testes Manuais via WhatsApp Real
Se o WhatsApp Cloud API estiver configurado:
1. Envie a mensagem `#modo_paciente` a partir do número do médico configurado no `.env` (`DOCTOR_PHONE`). Isso fará com que o bot ative a triagem para o seu número.
2. Para reiniciar a sua própria triagem a qualquer momento, envie a palavra **`reiniciar`** no chat.
3. Para voltar a receber comandos administrativos do médico, envie a mensagem `#modo_medico`.

---

## ⚙️ 4. Principais Arquivos de Configuração

*   [**`.env`**](file:///c:/AI/clinica-chatbot/.env): Arquivo com variáveis de ambiente (portas, tokens, chaves de API, provedor de LLM).
*   [**`Check List.md`**](file:///c:/AI/clinica-chatbot/Check%20List.md): Planilha com todos os cenários esperados na triagem.
*   [**`triage_config.json`**](file:///c:/AI/clinica-chatbot/triage_config.json): Estrutura dinâmica de perguntas que a máquina de estados de triagem percorre.
*   [**`chat_histories.json`**](file:///c:/AI/clinica-chatbot/chat_histories.json): Histórico em formato JSON das conversas salvas no servidor.
*   [**`triage_sessions.json`**](file:///c:/AI/clinica-chatbot/triage_sessions.json): O estado atualizado da triagem de cada número de telefone.
