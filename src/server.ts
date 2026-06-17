import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

import { config, validateEnv } from './config/env-manager';
import { initializeSheets } from './services/google/sheets';
import { getAuthUrl, oauth2Client, saveCredentials, isGoogleAuthenticated } from './services/google/client';
import { sendWhatsAppMessage, markWhatsAppMessageAsRead, normalizeBrazilianPhone, isWhatsAppConnected, setWhatsAppTokenValid } from './services/whatsapp/client';
import { TriageSession, loadTriageConfig, saveTriageConfig } from './core/triage/triage-flow';
import { routeTriageMessage } from './core/triage/triage-router';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = config.PORT || 3000;
const DOCTOR_PHONE = normalizeBrazilianPhone(config.DOCTOR_PHONE || '');

// Banco de dados em memória para sessões de triagem (salvo em disco)
const TRIAGE_SESSIONS_FILE = path.join(process.cwd(), 'triage_sessions.json');
const CHAT_HISTORIES_FILE = path.join(process.cwd(), 'chat_histories.json');

// médico atuando como paciente
const doctorAsPatientSet = new Set<string>();

// Fila de processamento por telefone para evitar race conditions de mensagens concorrentes
const webhookLocks = new Map<string, Promise<any>>();
const accumulatedTexts = new Map<string, string[]>();
const debounceTimeouts = new Map<string, NodeJS.Timeout>();

// Carrega sessões de triagem salvas
function loadTriageSessions(): Record<string, any> {
  try {
    if (fs.existsSync(TRIAGE_SESSIONS_FILE)) {
      const data = fs.readFileSync(TRIAGE_SESSIONS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Erro ao carregar sessões de triagem:', error);
  }
  return {};
}

// Salva sessão de triagem
function saveTriageSession(phone: string, session: TriageSession) {
  try {
    const sessions = loadTriageSessions();
    sessions[phone] = session;
    fs.writeFileSync(TRIAGE_SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (error) {
    console.error('Erro ao salvar sessão de triagem:', error);
  }
}

// Limpa sessão de triagem
function clearTriageSession(phone: string) {
  try {
    const sessions = loadTriageSessions();
    if (phone in sessions) {
      delete sessions[phone];
      fs.writeFileSync(TRIAGE_SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    }
  } catch (error) {
    console.error('Erro ao limpar sessão de triagem:', error);
  }
}

// Carrega históricos de conversa
function loadChatHistories(): Record<string, any[]> {
  try {
    if (fs.existsSync(CHAT_HISTORIES_FILE)) {
      const data = fs.readFileSync(CHAT_HISTORIES_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Erro ao carregar histórico de conversas:', error);
  }
  return {};
}

// Salva histórico de conversa
function saveChatMessage(phone: string, role: 'user' | 'model' | 'system' | 'assistant', content: string) {
  try {
    const histories = loadChatHistories();
    if (!histories[phone]) {
      histories[phone] = [];
    }
    histories[phone].push({
      role,
      content,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(CHAT_HISTORIES_FILE, JSON.stringify(histories, null, 2), 'utf8');
  } catch (error) {
    console.error('Erro ao salvar mensagem no histórico:', error);
  }
}

// Limpa histórico de conversa
function clearChatHistory(phone: string) {
  try {
    const histories = loadChatHistories();
    if (phone in histories) {
      delete histories[phone];
      fs.writeFileSync(CHAT_HISTORIES_FILE, JSON.stringify(histories, null, 2), 'utf8');
    }
  } catch (error) {
    console.error('Erro ao limpar histórico de conversa:', error);
  }
}

/**
 * Processamento central de mensagens do paciente
 */
async function handleIncomingMessage(senderPhone: string, text: string): Promise<string> {
  const cleanPhone = normalizeBrazilianPhone(senderPhone);
  const textTrimmed = text.trim();

  // Se o paciente digitar 'reiniciar', limpamos a triagem antiga para ele recomeçar
  if (textTrimmed.toLowerCase() === 'reiniciar') {
    clearTriageSession(cleanPhone);
    clearChatHistory(cleanPhone);
    const session = new TriageSession(cleanPhone);
    const response = await routeTriageMessage(session, textTrimmed);
    saveTriageSession(cleanPhone, session);
    saveChatMessage(cleanPhone, 'user', textTrimmed);
    saveChatMessage(cleanPhone, 'assistant', response);
    await sendWhatsAppMessage(cleanPhone, response);
    return response;
  }

  // Carrega ou inicializa a sessão de triagem
  const sessions = loadTriageSessions();
  let sessionData = sessions[cleanPhone];
  let session = new TriageSession(cleanPhone);

  if (sessionData) {
    Object.assign(session, sessionData);

    // Configura os tempos limite (timeouts) de inatividade para resetar a triagem
    const lastUpdate = new Date(session.updatedAt).getTime();
    const now = new Date().getTime();
    const diffMinutes = (now - lastUpdate) / (1000 * 60);

    if (session.state !== 'DONE' && diffMinutes > 60) {   // 1 hora de inatividade no meio da triagem
      console.log(`[Triage] Resetando sessão inativa incompleta de ${cleanPhone} por tempo limite (${diffMinutes.toFixed(1)} minutos).`);
      session = new TriageSession(cleanPhone);
      clearChatHistory(cleanPhone);
      saveTriageSession(cleanPhone, session);
    }
  }

  // Registra a mensagem do usuário no histórico de transparência
  saveChatMessage(cleanPhone, 'user', textTrimmed);

  // Executa o passo da triagem na máquina de estados
  const response = await routeTriageMessage(session, textTrimmed);

  // Salva o novo estado da triagem
  saveTriageSession(cleanPhone, session);

  // Registra a resposta da IA no histórico de transparência
  saveChatMessage(cleanPhone, 'assistant', response);

  // Dispara a resposta para o WhatsApp do paciente
  await sendWhatsAppMessage(cleanPhone, response);

  return response;
}

/**
 * Rota GET: Verificação de Webhook do WhatsApp (Meta)
 */
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.WHATSAPP_VERIFY_TOKEN) {
    console.log('WhatsApp Webhook: Verificado com sucesso pela Meta!');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/**
 * Rota POST: Eventos de mensagem do WhatsApp
 */
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const payload = req.body;
    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return res.status(200).json({ status: 'ignored_non_message' });
    }

    const messageId = message.id;
    let senderPhone = message.from;
    if (!senderPhone) {
      return res.status(200).json({ status: 'ignored_no_sender' });
    }

    senderPhone = normalizeBrazilianPhone(senderPhone);
    let text = '';

    if (message.type === 'text') {
      text = message.text?.body || '';
    } else if (message.type === 'button') {
      text = message.button?.text || '';
    } else if (message.type === 'interactive') {
      const interactive = message.interactive;
      if (interactive?.type === 'button_reply') {
        text = interactive.button_reply?.title || '';
      } else if (interactive?.type === 'list_reply') {
        text = interactive.list_reply?.title || '';
      }
    }

    if (!text || text.trim() === '') {
      return res.status(200).json({ status: 'ignored_empty_text' });
    }

    // Responde 200 OK imediatamente para evitar timeouts do Facebook
    res.status(200).json({ status: 'processing' });

    // Marca como lido (double check)
    if (messageId) {
      await markWhatsAppMessageAsRead(messageId).catch(() => {});
    }

    // Processamento
    const isDoctor = senderPhone === DOCTOR_PHONE && !doctorAsPatientSet.has(senderPhone);

    if (isDoctor) {
      // Comandos administrativos via WhatsApp do médico
      const trimmed = text.trim();
      if (trimmed === '#modo_paciente') {
        doctorAsPatientSet.add(senderPhone);
        await sendWhatsAppMessage(senderPhone, 'Modo Paciente ativado. Suas mensagens agora passarão pela triagem de testes.');
      } else if (trimmed === '#modo_medico') {
        doctorAsPatientSet.delete(senderPhone);
        await sendWhatsAppMessage(senderPhone, 'Modo Médico ativado. Comandos administrativos liberados.');
      } else {
        // Como o foco inicial é triagem, respondemos que ele deve usar o painel ou WhatsApp normal
        await sendWhatsAppMessage(senderPhone, 'Você está em modo administrativo. Envie #modo_paciente para testar a triagem.');
      }
    } else {
      // Fluxo padrão de triagem com debounce (aguarda 5 segundos sem mensagens para processar tudo junto)
      const list = accumulatedTexts.get(senderPhone) || [];
      list.push(text);
      accumulatedTexts.set(senderPhone, list);

      // Cancela timer de debounce anterior, se houver
      const existingTimeout = debounceTimeouts.get(senderPhone);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Agenda novo processamento para 5 segundos após a última mensagem recebida
      const timeout = setTimeout(() => {
        // Retira as mensagens acumuladas e limpa referências
        const texts = accumulatedTexts.get(senderPhone) || [];
        accumulatedTexts.delete(senderPhone);
        debounceTimeouts.delete(senderPhone);

        if (texts.length === 0) return;

        // Une todas as mensagens acumuladas em um único texto (separadas por linha)
        const combinedText = texts.join('\n');
        console.log(`[Debounce] Processando ${texts.length} mensagens acumuladas para ${senderPhone}: "${combinedText.replace(/\n/g, ' | ')}"`);

        // Executa de forma sequencial na fila de promessas por telefone
        const currentPromise = webhookLocks.get(senderPhone) || Promise.resolve();
        const nextPromise = currentPromise.then(async () => {
          try {
            await handleIncomingMessage(senderPhone, combinedText);
          } catch (err) {
            console.error(`[Webhook Lock] Erro ao processar mensagens acumuladas para ${senderPhone}:`, err);
          }
        });

        webhookLocks.set(senderPhone, nextPromise);

        nextPromise.finally(() => {
          if (webhookLocks.get(senderPhone) === nextPromise) {
            webhookLocks.delete(senderPhone);
          }
        });
      }, 5000);

      debounceTimeouts.set(senderPhone, timeout);
    }

  } catch (err) {
    console.error('Erro no processamento do Webhook:', err);
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
});

/**
 * Setup Admin UI
 */
app.get('/setup', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'src', 'views', 'setup.html'));
});

app.get('/', (req, res) => {
  res.redirect('/setup');
});

/**
 * API: Configurações do arquivo .env
 */
app.get('/api/config', (req, res) => {
  res.json({
    config: {
      WHATSAPP_SIMULATION_MODE: process.env.WHATSAPP_SIMULATION_MODE || 'false',
      GEMINI_API_KEY: config.GEMINI_API_KEY,
      GOOGLE_SPREADSHEET_ID: config.GOOGLE_SPREADSHEET_ID,
      DOCTOR_PHONE: config.DOCTOR_PHONE,
      WHATSAPP_PHONE_NUMBER_ID: config.WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: config.WHATSAPP_ACCESS_TOKEN,
      WHATSAPP_VERIFY_TOKEN: config.WHATSAPP_VERIFY_TOKEN,
      BOOKING_MODE: config.BOOKING_MODE
    },
    status: {
      googleAuthenticated: isGoogleAuthenticated(),
      sheetsConnected: isGoogleAuthenticated() && !!config.GOOGLE_SPREADSHEET_ID,
      sheetsError: '',
      whatsappConnected: isWhatsAppConnected(),
      simulationActive: process.env.WHATSAPP_SIMULATION_MODE === 'true'
    }
  });
});

app.post('/api/config', (req, res) => {
  try {
    const updates = req.body;
    
    // Atualiza as chaves em memória e no arquivo .env
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    for (const key in updates) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const val = updates[key];
      
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${val}`);
      } else {
        envContent += `\n${key}=${val}`;
      }
      process.env[key] = val;
      
      // Atualiza o objeto config em runtime
      if (key in config) {
        (config as any)[key] = val;
      }
    }

    if ('WHATSAPP_ACCESS_TOKEN' in updates || 'WHATSAPP_PHONE_NUMBER_ID' in updates) {
      setWhatsAppTokenValid(null);
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Retorna todas as conversas do histórico para o painel de transparência
 */
app.get('/api/chats', (req, res) => {
  try {
    const histories = loadChatHistories();
    const sessions = loadTriageSessions();
    
    // Agrupa e enriquece os dados das conversas para exibir no front
    const chatList = Object.keys(histories).map(phone => {
      const rawMsgs = histories[phone] || [];
      const normalizedMsgs = rawMsgs.map(msg => {
        let content = msg.content;
        if (content === undefined && msg.parts && Array.isArray(msg.parts) && msg.parts.length > 0) {
          content = msg.parts[0]?.text || '';
        }
        return {
          role: msg.role === 'model' ? 'assistant' : msg.role,
          content: content || '',
          timestamp: msg.timestamp || new Date(0).toISOString()
        };
      });
      const session = sessions[phone] || {};
      
      const patientName = session.data?.name || session.name || 'Paciente Anônimo';
      return {
        phone,
        name: patientName,
        state: session.state || 'Desconhecido',
        data: session.data || {},
        lastMessage: normalizedMsgs[normalizedMsgs.length - 1]?.content || '',
        updatedAt: session.updatedAt || new Date().toISOString(),
        messages: normalizedMsgs
      };
    });

    res.json(chatList);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Simulação local de envio de mensagens
 */
app.post('/api/simulate-incoming', async (req, res) => {
  const { phone, text } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'Texto é obrigatório' });
  }

  const cleanPhone = normalizeBrazilianPhone(phone || DOCTOR_PHONE || '5548999991234');
  
  try {
    const response = await handleIncomingMessage(cleanPhone, text);
    res.json({ success: true, response });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/test-whatsapp', async (req, res) => {
  try {
    const phone = config.DOCTOR_PHONE;
    if (!phone) {
      return res.status(400).json({ error: 'Número do médico não configurado.' });
    }
    const text = 'Olá! Esta é uma mensagem de teste enviada pela API Oficial do WhatsApp Cloud do seu novo Chatbot Clínico modular. 🚀';
    await sendWhatsAppMessage(phone, text);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/test/doctor-as-patient', (req, res) => {
  res.json({ active: doctorAsPatientSet.has(DOCTOR_PHONE) });
});

app.post('/api/test/toggle-doctor-as-patient', (req, res) => {
  const { active } = req.body;
  if (active) {
    doctorAsPatientSet.add(DOCTOR_PHONE);
  } else {
    doctorAsPatientSet.delete(DOCTOR_PHONE);
  }
  res.json({ success: true, active: doctorAsPatientSet.has(DOCTOR_PHONE) });
});

/**
 * API: Retorna a configuração dinâmica de triagem
 */
app.get('/api/triage-config', (req, res) => {
  try {
    const triageConfig = loadTriageConfig();
    res.json(triageConfig);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Salva a configuração dinâmica de triagem
 */
app.post('/api/triage-config', (req, res) => {
  try {
    const newConfig = req.body;
    if (!newConfig || !Array.isArray(newConfig.fields)) {
      return res.status(400).json({ error: 'Configuração inválida: "fields" deve ser um array.' });
    }
    saveTriageConfig(newConfig);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Limpa TODO o histórico de conversas e sessões de triagem
 */
app.post('/api/clear-all-data', (req, res) => {
  try {
    fs.writeFileSync(TRIAGE_SESSIONS_FILE, '{}', 'utf8');
    fs.writeFileSync(CHAT_HISTORIES_FILE, '{}', 'utf8');
    console.log('[Admin] Todos os dados de triagem e histórico foram apagados via painel.');
    res.json({ success: true, message: 'Todos os dados foram limpos com sucesso.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Limpa dados de um paciente específico por telefone
 */
app.post('/api/clear-patient-data', (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Telefone é obrigatório.' });

    const cleanPhone = normalizeBrazilianPhone(phone);

    const sessions = loadTriageSessions();
    if (cleanPhone in sessions) delete sessions[cleanPhone];
    fs.writeFileSync(TRIAGE_SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');

    const histories = loadChatHistories();
    if (cleanPhone in histories) delete histories[cleanPhone];
    fs.writeFileSync(CHAT_HISTORIES_FILE, JSON.stringify(histories, null, 2), 'utf8');

    console.log(`[Admin] Dados do paciente ${cleanPhone} apagados via painel.`);
    res.json({ success: true, message: `Dados do paciente ${cleanPhone} removidos.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Retorna resumo dos dados armazenados (para o painel de diagnóstico)
 */
app.get('/api/data-summary', (req, res) => {
  try {
    const sessions = loadTriageSessions();
    const histories = loadChatHistories();
    const sessionCount = Object.keys(sessions).length;
    const historyCount = Object.keys(histories).length;

    const sessionList = Object.entries(sessions).map(([phone, s]: [string, any]) => ({
      phone,
      state: s.state || 'Desconhecido',
      name: s.data?.name || s.name || 'Sem nome',
      updatedAt: s.updatedAt || null
    }));

    res.json({ sessionCount, historyCount, sessions: sessionList });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Autenticação Google OAuth2
app.get('/auth/google', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    return res.status(400).send('Código ausente.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    saveCredentials(tokens);
    await initializeSheets();

    res.send(`
      <div style="font-family: sans-serif; text-align: center; margin-top: 100px; padding: 30px; background-color: #f9f9f9; border-radius: 12px; max-width: 600px; margin-left: auto; margin-right: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <h1 style="color: #2e7d32; font-size: 28px; margin-bottom: 15px;">✅ Autenticado com Sucesso!</h1>
        <p style="font-size: 16px; color: #37474f; margin-bottom: 25px;">O chatbot modular agora tem acesso às ferramentas do Google.</p>
        <a href="/setup" style="display: inline-block; padding: 10px 24px; background-color: #1e88e5; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Voltar ao Painel</a>
      </div>
    `);
  } catch (err: any) {
    res.status(500).send(`Erro na autorização: ${err.message}`);
  }
});

// Boot do servidor
app.listen(PORT, async () => {
  console.log(`\n==================================================`);
  console.log(`Servidor rodando com sucesso na porta ${PORT}!`);
  console.log(`Painel Administrativo: http://localhost:${PORT}/setup`);
  console.log(`==================================================\n`);
  
  validateEnv();
  
  if (isGoogleAuthenticated()) {
    console.log('Google Auth: Inicializando planilhas de controle...');
    await initializeSheets();
  }
});
