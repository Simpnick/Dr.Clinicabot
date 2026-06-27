import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

import { config, validateEnv } from './config/env-manager';
import { initializeSheets } from './services/google/sheets';
import { getAuthUrl, oauth2Client, saveCredentials, isGoogleAuthenticated } from './services/google/client';
import { sendWhatsAppMessage, markWhatsAppMessageAsRead, normalizeBrazilianPhone, isWhatsAppConnected, setWhatsAppTokenValid } from './services/whatsapp/client';
import { TriageSession, loadTriageConfig, saveTriageConfig } from './core/triage/triage-flow';
import { routeTriageMessage } from './core/triage/triage-router';
import { getDb } from './services/db/database';
import { createAppointment, cancelAppointment, listEvents } from './services/google/calendar';

// Buffer para capturar logs do console em tempo real no painel administrativo
const MAX_LOG_LINES = 350;
const serverLogs: string[] = [];

function addServerLog(type: 'INFO' | 'ERROR' | 'WARN', message: string) {
  const timestamp = new Date().toLocaleTimeString('pt-BR');
  const logLine = `[${timestamp}] [${type}] ${message}`;
  serverLogs.push(logLine);
  if (serverLogs.length > MAX_LOG_LINES) {
    serverLogs.shift();
  }
}

// Guarda referências aos console.* originais
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args: any[]) => {
  originalLog(...args);
  const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  addServerLog('INFO', msg);
};

console.error = (...args: any[]) => {
  originalError(...args);
  const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  addServerLog('ERROR', msg);
};

console.warn = (...args: any[]) => {
  originalWarn(...args);
  const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  addServerLog('WARN', msg);
};

const app = express();
app.use(cors());
app.use(express.json());

function basicAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Clinica Admin"');
    return res.status(401).send('Acesso não autorizado. Insira o usuário e senha.');
  }

  try {
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const user = auth[0];
    const pass = auth[1];

    const expectedUser = config.ADMIN_USERNAME || 'admin';
    const expectedPass = config.ADMIN_PASSWORD || 'drtonelli2026';

    if (user === expectedUser && pass === expectedPass) {
      return next();
    }
  } catch (err) {
    // erro ao decodificar
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Clinica Admin"');
  return res.status(401).send('Credenciais inválidas.');
}

// Protege as rotas administrativas e APIs contra acessos não autorizados
app.use('/dashboard', basicAuthMiddleware);
app.use('/setup', basicAuthMiddleware);
app.use('/auth/google', basicAuthMiddleware);
app.use('/auth/google/callback', basicAuthMiddleware);
app.use('/api', basicAuthMiddleware);

const PORT = config.PORT || 3000;
const DOCTOR_PHONE = normalizeBrazilianPhone(config.DOCTOR_PHONE || '');

// Banco de dados em memória para sessões de triagem (salvo em disco)
const TRIAGE_SESSIONS_FILE = path.join(process.cwd(), 'triage_sessions.json');
const CHAT_HISTORIES_FILE = path.join(process.cwd(), 'chat_histories.json');

// médico atuando como paciente (ativo por padrão)
const doctorAsPatientSet = new Set<string>();
if (DOCTOR_PHONE) {
  doctorAsPatientSet.add(DOCTOR_PHONE);
}

// Fila de processamento por telefone para evitar race conditions de mensagens concorrentes
const webhookLocks = new Map<string, Promise<any>>();
const accumulatedTexts = new Map<string, string[]>();
const debounceTimeouts = new Map<string, NodeJS.Timeout>();

let db: Database | null = null;

async function initDatabase() {
  try {
    db = await getDb();

    // Tabela de Pacientes (Prontuário)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS patients (
        phone TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        age INTEGER NOT NULL,
        health_plan TEXT NOT NULL,
        card_number TEXT,
        complaint TEXT NOT NULL,
        medication TEXT NOT NULL,
        agreed_to_terms INTEGER NOT NULL,
        completed_at TEXT NOT NULL
      );
    `);

    // Tabela de Evoluções / Notas de Prontuário
    await db.exec(`
      CREATE TABLE IF NOT EXISTS patient_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_phone TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        author TEXT,
        FOREIGN KEY (patient_phone) REFERENCES patients(phone) ON DELETE CASCADE
      );
    `);

    // Tabela de Agendamentos
    await db.exec(`
      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        patient_phone TEXT NOT NULL,
        patient_name TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL
      );
    `);

    // Tabela de Solicitações de Agendamento (Modo Semi-Automático)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS booking_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_phone TEXT NOT NULL,
        patient_name TEXT NOT NULL,
        patient_age INTEGER NOT NULL,
        health_plan TEXT NOT NULL,
        complaint TEXT NOT NULL,
        medication TEXT NOT NULL,
        suggested_start TEXT NOT NULL,
        suggested_end TEXT NOT NULL,
        quota TEXT NOT NULL,
        duration INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL
      );
    `);

    // Tabela de Fila Virtual
    await db.exec(`
      CREATE TABLE IF NOT EXISTS virtual_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_phone TEXT NOT NULL,
        patient_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        arrival_time TEXT NOT NULL
      );
    `);

    // Tabela de Configurações Gerais
    await db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Insere o intervalo de agendamento padrão (15 minutos) se não existir
    await db.run(`
      INSERT OR IGNORE INTO settings (key, value)
      VALUES ('appointment_interval', '15')
    `);

    console.log('[SQLite] Banco de dados inicializado com sucesso.');

    // Migração automática de chat_histories.json para SQLite se a tabela chat_messages estiver vazia
    const chatHistoryPath = path.join(process.cwd(), 'chat_histories.json');
    if (fs.existsSync(chatHistoryPath)) {
      const countResult = await db.get('SELECT COUNT(*) as count FROM chat_messages');
      if (countResult && countResult.count === 0) {
        console.log('[SQLite Migration] Iniciando migração de chat_histories.json para SQLite...');
        try {
          const fileContent = fs.readFileSync(chatHistoryPath, 'utf8');
          const histories = JSON.parse(fileContent);
          
          let migratedCount = 0;
          await db.run('BEGIN TRANSACTION;');
          for (const phone of Object.keys(histories)) {
            const msgs = histories[phone] || [];
            for (const msg of msgs) {
              const role = msg.role === 'model' ? 'assistant' : msg.role;
              const content = msg.content || (msg.parts && msg.parts[0]?.text) || '';
              const timestamp = msg.timestamp || new Date().toISOString();
              
              await db.run(`
                INSERT INTO chat_messages (patient_phone, role, content, timestamp)
                VALUES (?, ?, ?, ?)
              `, [phone, role, content, timestamp]);
              migratedCount++;
            }
          }
          await db.run('COMMIT;');
          console.log(`[SQLite Migration] Migração concluída com sucesso: ${migratedCount} mensagens importadas.`);
          
          // Renomeia o arquivo original como backup
          fs.renameSync(chatHistoryPath, chatHistoryPath + '.bak');
          console.log(`[SQLite Migration] Arquivo original renomeado para chat_histories.json.bak`);
        } catch (migErr: any) {
          await db.run('ROLLBACK;');
          console.error('[SQLite Migration] Erro durante a migração de histórico de conversas:', migErr);
        }
      }
    }
  } catch (error) {
    console.error('[SQLite] Erro ao inicializar o banco de dados:', error);
  }
}

async function savePatientToDatabase(phone: string, data: any) {
  if (!db) {
    console.error('[SQLite] Conexão com o banco de dados não inicializada.');
    return;
  }
  try {
    const agreedVal = data.agreedToTerms === true || data.agreedToTerms === 'true' || data.agreedToTerms === 1 ? 1 : 0;
    
    await db.run(`
      INSERT INTO patients (phone, name, age, health_plan, card_number, complaint, medication, agreed_to_terms, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        name = excluded.name,
        age = excluded.age,
        health_plan = excluded.health_plan,
        card_number = excluded.card_number,
        complaint = excluded.complaint,
        medication = excluded.medication,
        agreed_to_terms = excluded.agreed_to_terms,
        completed_at = excluded.completed_at;
    `, [
      phone,
      data.name || 'Sem nome',
      Number(data.age) || 0,
      data.healthPlan || 'Particular',
      data.cardNumber || 'Não aplicável',
      data.complaint || 'Não informada',
      data.medication || 'Não necessita',
      agreedVal,
      new Date().toISOString()
    ]);
    console.log(`[SQLite] Paciente ${phone} salvo/atualizado no SQLite com sucesso.`);
  } catch (error) {
    console.error(`[SQLite] Erro ao salvar paciente ${phone} no SQLite:`, error);
  }
}


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

// Salva histórico de conversa
async function saveChatMessage(phone: string, role: 'user' | 'model' | 'system' | 'assistant', content: string) {
  if (!db) {
    console.error('[SQLite] Banco de dados não disponível para salvar mensagem.');
    return;
  }
  try {
    const roleNormalized = role === 'model' ? 'assistant' : role;
    await db.run(`
      INSERT INTO chat_messages (patient_phone, role, content, timestamp)
      VALUES (?, ?, ?, ?)
    `, [phone, roleNormalized, content, new Date().toISOString()]);
  } catch (error) {
    console.error('Erro ao salvar mensagem no histórico SQLite:', error);
  }
}

// Limpa histórico de conversa
async function clearChatHistory(phone: string) {
  if (!db) return;
  try {
    await db.run('DELETE FROM chat_messages WHERE patient_phone = ?', [phone]);
  } catch (error) {
    console.error('Erro ao limpar histórico de conversa no SQLite:', error);
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
    await clearChatHistory(cleanPhone);
    const session = new TriageSession(cleanPhone);
    const response = await routeTriageMessage(session, textTrimmed);
    saveTriageSession(cleanPhone, session);
    await saveChatMessage(cleanPhone, 'user', textTrimmed);
    await saveChatMessage(cleanPhone, 'assistant', response);
    await sendWhatsAppMessage(cleanPhone, response);
    return response;
  }

  // Carrega ou inicializa a sessão de triagem
  const sessions = loadTriageSessions();
  let sessionData = sessions[cleanPhone];
  let session = new TriageSession(cleanPhone);

  if (sessionData) {
    Object.assign(session, sessionData);

    // Se a conversa foi assumida por um humano, salvamos a mensagem do usuário mas NÃO respondemos com a IA
    if (session.humanTakeover) {
      console.log(`[Triage] Conversa de ${cleanPhone} está sob controle humano. Apenas salvando mensagem.`);
      await saveChatMessage(cleanPhone, 'user', textTrimmed);
      return 'HUMAN_TAKEOVER';
    }

    // Configura os tempos limite (timeouts) de inatividade para resetar a triagem
    const lastUpdate = new Date(session.updatedAt).getTime();
    const now = new Date().getTime();
    const diffMinutes = (now - lastUpdate) / (1000 * 60);

    if (session.state !== 'DONE' && diffMinutes > 60) {   // 1 hora de inatividade no meio da triagem
      console.log(`[Triage] Resetando sessão inativa incompleta de ${cleanPhone} por tempo limite (${diffMinutes.toFixed(1)} minutos).`);
      session = new TriageSession(cleanPhone);
      await clearChatHistory(cleanPhone);
      saveTriageSession(cleanPhone, session);
    }
  }

  // Registra a mensagem do usuário no histórico de transparência
  await saveChatMessage(cleanPhone, 'user', textTrimmed);

  // Executa o passo da triagem na máquina de estados
  const response = await routeTriageMessage(session, textTrimmed);

  // Salva o novo estado da triagem
  saveTriageSession(cleanPhone, session);

  // Se a triagem foi concluída nesta mensagem, salva o paciente no SQLite
  if (session.state === 'DONE') {
    savePatientToDatabase(cleanPhone, session.data).catch(err => {
      console.error('[SQLite] Erro ao salvar paciente da triagem concluída:', err);
    });

    // Se o modo for automático ou semi-automático, arquiva a triagem imediatamente (limpa das sessões ativas)
    if (config.BOOKING_MODE === 'auto' || config.BOOKING_MODE === 'semi') {
      clearTriageSession(cleanPhone);
    }
  }

  // Registra a resposta da IA no histórico de transparência
  await saveChatMessage(cleanPhone, 'assistant', response);

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
    const isDoctorPhone = senderPhone === DOCTOR_PHONE;
    const isDoctorAdminMode = isDoctorPhone && !doctorAsPatientSet.has(senderPhone);
    const trimmed = text.trim();

    if (isDoctorPhone && (trimmed === '#modo_paciente' || trimmed === '#modo_medico')) {
      if (trimmed === '#modo_paciente') {
        doctorAsPatientSet.add(senderPhone);
        await sendWhatsAppMessage(senderPhone, 'Modo Paciente ativado. Suas mensagens agora passarão pela triagem de testes.');
      } else if (trimmed === '#modo_medico') {
        doctorAsPatientSet.delete(senderPhone);
        await sendWhatsAppMessage(senderPhone, 'Modo Médico ativado. Comandos administrativos liberados.');
      }
    } else if (isDoctorAdminMode) {
      // Como o foco inicial é triagem, respondemos que ele deve usar o painel ou WhatsApp normal
      await sendWhatsAppMessage(senderPhone, 'Você está em modo administrativo. Envie #modo_paciente para testar a triagem.');
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
 * Apresentação UI
 */
app.get('/apresentacao', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'src', 'views', 'apresentacao.html'));
});

/**
 * Setup Admin UI
 */
app.get('/setup', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'src', 'views', 'setup.html'));
});

app.get('/', (req, res) => {
  res.redirect('/apresentacao');
});

function maskSecret(val: string | undefined): string {
  if (!val) return '';
  if (val.length <= 8) return '********';
  return val.substring(0, 6) + '...' + '********';
}

function isMasked(val: string): boolean {
  return val === '********' || (val.includes('...') && val.endsWith('********'));
}

/**
 * API: Configurações do arquivo .env
 */
app.get('/api/config', (req, res) => {
  res.json({
    config: {
      WHATSAPP_SIMULATION_MODE: process.env.WHATSAPP_SIMULATION_MODE || 'false',
      GEMINI_API_KEY: maskSecret(config.GEMINI_API_KEY),
      GOOGLE_SPREADSHEET_ID: config.GOOGLE_SPREADSHEET_ID,
      DOCTOR_PHONE: config.DOCTOR_PHONE,
      WHATSAPP_PHONE_NUMBER_ID: config.WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: maskSecret(config.WHATSAPP_ACCESS_TOKEN),
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
      const val = updates[key];

      // Se for uma chave sensível mascarada, ignora a atualização para preservar o valor atual no .env
      if ((key === 'GEMINI_API_KEY' || key === 'WHATSAPP_ACCESS_TOKEN') && isMasked(val)) {
        console.log(`[Config] Ignorando atualização de valor mascarado para a chave: ${key}`);
        continue;
      }

      const regex = new RegExp(`^${key}=.*$`, 'm');
      
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
      // Somente invalida o token se o token enviado não for mascarado
      if (!('WHATSAPP_ACCESS_TOKEN' in updates && isMasked(updates.WHATSAPP_ACCESS_TOKEN))) {
        setWhatsAppTokenValid(null);
      }
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
app.get('/api/chats', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  try {
    // Busca todas as mensagens ordenadas cronologicamente
    const messages = await db.all('SELECT * FROM chat_messages ORDER BY timestamp ASC');
    const sessions = loadTriageSessions();
    
    // Agrupa as mensagens por telefone
    const histories: Record<string, any[]> = {};
    for (const m of messages) {
      if (!histories[m.patient_phone]) {
        histories[m.patient_phone] = [];
      }
      histories[m.patient_phone].push({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
      });
    }

    // Busca nomes dos pacientes no prontuário e nos agendamentos para manter os nomes nas conversas arquivadas/agendadas
    const patients = await db.all('SELECT phone, name FROM patients');
    const patientsMap: Record<string, string> = {};
    for (const p of patients) {
      patientsMap[p.phone] = p.name;
    }

    const appointments = await db.all('SELECT patient_phone, patient_name FROM appointments');
    const appointmentsMap: Record<string, string> = {};
    for (const a of appointments) {
      appointmentsMap[a.patient_phone] = a.patient_name;
    }

    // Agrupa e enriquece os dados das conversas para exibir no front
    const chatList = Object.keys(histories).map(phone => {
      const rawMsgs = histories[phone] || [];
      const normalizedMsgs = rawMsgs.map(msg => {
        let content = msg.content;
        return {
          role: msg.role === 'model' ? 'assistant' : msg.role,
          content: content || '',
          timestamp: msg.timestamp || new Date(0).toISOString()
        };
      });
      const session = sessions[phone] || {};
      
      const patientName = session.data?.name || 
                          session.name || 
                          patientsMap[phone] || 
                          appointmentsMap[phone] || 
                          'Paciente Anônimo';
      return {
        phone,
        name: patientName,
        state: session.state || 'Desconhecido',
        data: session.data || {},
        lastMessage: normalizedMsgs[normalizedMsgs.length - 1]?.content || '',
        updatedAt: session.updatedAt || new Date().toISOString(),
        messages: normalizedMsgs,
        humanTakeover: session.humanTakeover || false
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
 * Rota GET: Servidor do Painel da Secretária
 */
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'src', 'views', 'dashboard.html'));
});

/**
 * API: Retorna todos os pacientes cadastrados no banco de dados SQLite
 */
app.get('/api/patients', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  try {
    const patients = await db.all('SELECT * FROM patients ORDER BY completed_at DESC');
    res.json(patients);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Retorna os detalhes de um paciente específico e suas evoluções
 */
app.get('/api/patients/:phone', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  const { phone } = req.params;
  const cleanPhone = normalizeBrazilianPhone(phone);
  try {
    const patient = await db.get('SELECT * FROM patients WHERE phone = ?', [cleanPhone]);
    if (!patient) {
      return res.status(404).json({ error: 'Paciente não encontrado no prontuário.' });
    }
    const notes = await db.all('SELECT * FROM patient_notes WHERE patient_phone = ? ORDER BY created_at DESC', [cleanPhone]);
    res.json({ patient, notes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Adiciona uma nota/evolução no prontuário do paciente no SQLite
 */
app.post('/api/patients/:phone/notes', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  const { phone } = req.params;
  const { content, author } = req.body;
  const cleanPhone = normalizeBrazilianPhone(phone);

  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'O conteúdo da nota é obrigatório.' });
  }

  try {
    // Verifica se o paciente existe
    const patient = await db.get('SELECT phone FROM patients WHERE phone = ?', [cleanPhone]);
    if (!patient) {
      return res.status(404).json({ error: 'Paciente não cadastrado no prontuário.' });
    }
    
    await db.run(`
      INSERT INTO patient_notes (patient_phone, content, created_at, author)
      VALUES (?, ?, ?, ?)
    `, [
      cleanPhone,
      content.trim(),
      new Date().toISOString(),
      author || 'Secretária'
    ]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Arquiva a triagem de um paciente (salva no SQLite se ainda não estiver e remove das sessões ativas)
 */
app.post('/api/archive-triage', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Telefone é obrigatório.' });
  const cleanPhone = normalizeBrazilianPhone(phone);

  try {
    const sessions = loadTriageSessions();
    const session = sessions[cleanPhone];
    if (session) {
      // Salva no SQLite
      await savePatientToDatabase(cleanPhone, session.data);
      
      // Limpa das sessões ativas
      delete sessions[cleanPhone];
      fs.writeFileSync(TRIAGE_SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
      console.log(`[Admin] Triagem de ${cleanPhone} arquivada e removida da fila ativa.`);
    }
    res.json({ success: true, message: `Triagem de ${cleanPhone} arquivada com sucesso.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Envia mensagem manual de WhatsApp pelo atendente e insere no histórico
 */
app.post('/api/send-whatsapp-manual', async (req, res) => {
  const { phone, text } = req.body;
  if (!phone || !text) {
    return res.status(400).json({ error: 'Telefone e texto são obrigatórios.' });
  }
  const cleanPhone = normalizeBrazilianPhone(phone);
  
  try {
    // Registra no histórico de mensagens (assistant)
    await saveChatMessage(cleanPhone, 'assistant', text.trim());
    
    // Envia via API Oficial
    await sendWhatsAppMessage(cleanPhone, text.trim());
    
    res.json({ success: true });
  } catch (err: any) {
    console.error(`[Manual Chat] Erro ao enviar mensagem para ${cleanPhone}:`, err.message);
    res.status(500).json({ error: err.message });
  }
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
app.post('/api/clear-all-data', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  try {
    fs.writeFileSync(TRIAGE_SESSIONS_FILE, '{}', 'utf8');
    await db.run('DELETE FROM chat_messages');
    console.log('[Admin] Todos os dados de triagem e histórico foram apagados via painel.');
    res.json({ success: true, message: 'Todos os dados foram limpos com sucesso.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Limpa dados de um paciente específico por telefone
 */
app.post('/api/clear-patient-data', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Telefone é obrigatório.' });

    const cleanPhone = normalizeBrazilianPhone(phone);

    const sessions = loadTriageSessions();
    if (cleanPhone in sessions) delete sessions[cleanPhone];
    fs.writeFileSync(TRIAGE_SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');

    await db.run('DELETE FROM chat_messages WHERE patient_phone = ?', [cleanPhone]);

    console.log(`[Admin] Dados do paciente ${cleanPhone} apagados via painel.`);
    res.json({ success: true, message: `Dados do paciente ${cleanPhone} removidos.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Remove um prontuário (paciente) específico do banco SQLite e suas evoluções
 */
app.post('/api/delete-patient-record', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Telefone é obrigatório.' });

    const cleanPhone = normalizeBrazilianPhone(phone);

    // 1. Deleta da tabela patients
    await db.run('DELETE FROM patients WHERE phone = ?', [cleanPhone]);

    // 2. Deleta evoluções/notas associadas
    await db.run('DELETE FROM patient_notes WHERE patient_phone = ?', [cleanPhone]);

    console.log(`[Admin] Prontuário do paciente ${cleanPhone} removido do banco SQLite.`);
    res.json({ success: true, message: `Prontuário e evoluções do paciente ${cleanPhone} removidos com sucesso do SQLite.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Ativa/desativa o controle humano da conversa
 */
app.post('/api/triage/toggle-takeover', (req, res) => {
  try {
    const { phone, active } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Telefone é obrigatório.' });
    }
    const cleanPhone = normalizeBrazilianPhone(phone);
    const sessions = loadTriageSessions();
    
    // Se a sessão não existir, cria uma inicial em START
    if (!sessions[cleanPhone]) {
      sessions[cleanPhone] = new TriageSession(cleanPhone);
    }
    
    sessions[cleanPhone].humanTakeover = active === true;
    sessions[cleanPhone].updatedAt = new Date().toISOString();
    
    fs.writeFileSync(TRIAGE_SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    console.log(`[Triage] Controle humano para ${cleanPhone} alterado para: ${active === true}`);
    res.json({ success: true, humanTakeover: sessions[cleanPhone].humanTakeover });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Busca e sincroniza consultas do Google Calendar com o banco SQLite local
 */
app.get('/api/appointments', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'Parâmetros start e end são obrigatórios (ISO Strings).' });
    }

    const timeMin = start as string;
    const timeMax = end as string;

    // 1. Busca eventos da API Oficial do Google Calendar
    const events = await listEvents(timeMin, timeMax);

    // 2. Sincroniza com o banco de dados SQLite local (Upsert)
    // Limpa o cache do intervalo selecionado primeiro para evitar duplicados ou excluídos
    await db.run('DELETE FROM appointments WHERE start_time >= ? AND start_time <= ?', [timeMin, timeMax]);

    for (const event of events) {
      let phone = '0000000000000';
      const desc = event.description || '';
      // Tenta extrair telefone do campo de descrição
      const phoneMatch = /(?:whatsapp|telefone|fone):\s*\+?(\d+)/i.exec(desc);
      if (phoneMatch) {
        phone = phoneMatch[1];
      } else {
        const phoneMatchTitle = /\+?(\d{10,13})/g.exec(event.summary || '');
        if (phoneMatchTitle) {
          phone = phoneMatchTitle[1];
        }
      }

      const name = (event.summary || 'Consulta').replace(/^consulta:\s*/i, '').trim();

      await db.run(`
        INSERT OR REPLACE INTO appointments (id, patient_phone, patient_name, start_time, end_time, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        event.id,
        phone,
        name,
        event.start,
        event.end,
        event.description || '',
        new Date().toISOString()
      ]);
    }

    // 3. Retorna os agendamentos salvos localmente juntando com dados do prontuário
    const appointments = await db.all(
      `SELECT a.*, p.age, p.complaint 
       FROM appointments a 
       LEFT JOIN patients p ON a.patient_phone = p.phone 
       WHERE a.start_time >= ? AND a.start_time <= ? 
       ORDER BY a.start_time ASC`,
      [timeMin, timeMax]
    );
    res.json(appointments);
  } catch (err: any) {
    console.error('[API Appointments] Erro ao sincronizar consultas:', err);
    try {
      // Fallback para cache local se API do Google falhar
      const appointments = await db!.all(
        `SELECT a.*, p.age, p.complaint 
         FROM appointments a 
         LEFT JOIN patients p ON a.patient_phone = p.phone 
         WHERE a.start_time >= ? AND a.start_time <= ? 
         ORDER BY a.start_time ASC`,
        [req.query.start as string, req.query.end as string]
      );
      res.json(appointments);
    } catch (dbErr: any) {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * API: Cria um novo agendamento no Google Calendar e salva no SQLite local
 */
app.post('/api/appointments', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  try {
    const { name, phone, startTime, durationMinutes } = req.body;
    if (!name || !phone || !startTime) {
      return res.status(400).json({ error: 'Campos name, phone e startTime são obrigatórios.' });
    }

    const duration = durationMinutes ? parseInt(durationMinutes) : 30;
    const cleanPhone = normalizeBrazilianPhone(phone);

    // 1. Cria o compromisso no Google Calendar
    const googleResult = await createAppointment(name, cleanPhone, startTime, duration);

    const endTime = new Date(new Date(startTime).getTime() + duration * 60 * 1000).toISOString();
    const description = `Paciente: ${name}\nWhatsApp: ${phone}\nAgendado pelo Painel de Controle.`;

    // 2. Insere no SQLite local
    await db.run(`
      INSERT INTO appointments (id, patient_phone, patient_name, start_time, end_time, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      googleResult.eventId,
      cleanPhone,
      name,
      startTime,
      endTime,
      description,
      new Date().toISOString()
    ]);

    // 3. Se houver sessão de triagem ativa concluída (DONE), arquiva automaticamente
    const sessions = loadTriageSessions();
    if (sessions[cleanPhone]) {
      await savePatientToDatabase(cleanPhone, sessions[cleanPhone].data);
      delete sessions[cleanPhone];
      fs.writeFileSync(TRIAGE_SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
      console.log(`[Appointments] Triagem ativa de ${cleanPhone} arquivada automaticamente no agendamento.`);
    }

    res.json({ success: true, appointment: { id: googleResult.eventId, name, phone: cleanPhone, startTime, endTime } });
  } catch (err: any) {
    console.error('[API Appointments] Erro ao criar consulta:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Cancela um agendamento no Google Calendar e remove do SQLite local
 */
app.delete('/api/appointments/:id', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'ID do agendamento é obrigatório.' });
    }

    // 1. Cancela no Google Calendar
    await cancelAppointment(id);

    // 2. Remove do SQLite local
    await db.run('DELETE FROM appointments WHERE id = ?', [id]);

    res.json({ success: true, message: 'Agendamento cancelado com sucesso.' });
  } catch (err: any) {
    console.error('[API Appointments] Erro ao cancelar consulta:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Retorna todas as solicitações de agendamento pendentes (Semi-Automático)
 */
app.get('/api/booking-requests', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  try {
    const requests = await db.all("SELECT * FROM booking_requests WHERE status = 'pending' ORDER BY created_at DESC");
    res.json(requests);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Aprova uma solicitação de agendamento, criando o evento no Google Calendar e SQLite local
 */
app.post('/api/booking-requests/:id/approve', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  const { id } = req.params;
  const { startTime, durationMinutes } = req.body;
  
  try {
    const request = await db.get("SELECT * FROM booking_requests WHERE id = ?", [id]);
    if (!request) {
      return res.status(404).json({ error: 'Solicitação de agendamento não encontrada.' });
    }

    const finalStartTime = startTime || request.suggested_start;
    const finalDuration = durationMinutes ? parseInt(durationMinutes, 10) : request.duration;
    const finalEndTime = new Date(new Date(finalStartTime).getTime() + finalDuration * 60 * 1000).toISOString();
    
    const cleanPhone = normalizeBrazilianPhone(request.patient_phone);

    // 1. Cria compromisso no Google Calendar
    const googleResult = await createAppointment(request.patient_name, cleanPhone, finalStartTime, finalDuration);

    const description = `Paciente: ${request.patient_name}\nWhatsApp: ${request.patient_phone}\nAgendado pelo Painel de Controle (Aprovação de IA).`;

    // 2. Insere na tabela local de appointments
    await db.run(`
      INSERT INTO appointments (id, patient_phone, patient_name, start_time, end_time, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      googleResult.eventId,
      cleanPhone,
      request.patient_name,
      finalStartTime,
      finalEndTime,
      description,
      new Date().toISOString()
    ]);

    // 3. Salva o paciente no SQLite
    const patientData = {
      name: request.patient_name,
      age: request.patient_age,
      healthPlan: request.health_plan,
      cardNumber: 'Não aplicável',
      complaint: request.complaint,
      medication: request.medication,
      agreedToTerms: true
    };
    await savePatientToDatabase(cleanPhone, patientData);

    // 4. Atualiza status da solicitação
    await db.run("UPDATE booking_requests SET status = 'approved' WHERE id = ?", [id]);

    // 5. Envia mensagem de confirmação de agendamento ao paciente
    const dateObj = new Date(finalStartTime);
    const weekdayName = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' }).format(dateObj);
    const weekdayCapitalized = weekdayName.charAt(0).toUpperCase() + weekdayName.slice(1);
    
    const dateParts = dateObj.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split(', ');
    const formattedDate = dateParts[0].substring(0, 5);
    const formattedTime = dateParts[1].substring(0, 5);

    const confirmMsg = `Olá *${request.patient_name}*, sua triagem foi concluída com sucesso! Agendamos sua consulta para *${weekdayCapitalized}*, *${formattedDate}* às *${formattedTime}* com o Dr. Carlos Tonelli. Caso necessite desmarcar, por favor responda.`;

    await sendWhatsAppMessage(cleanPhone, confirmMsg);
    await saveChatMessage(cleanPhone, 'assistant', confirmMsg);

    res.json({ success: true, message: 'Solicitação aprovada e consulta agendada.' });
  } catch (err: any) {
    console.error('[API Approve Booking] Erro ao aprovar solicitação:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Rejeita uma solicitação de agendamento e notifica o paciente
 */
app.post('/api/booking-requests/:id/reject', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  const { id } = req.params;

  try {
    const request = await db.get("SELECT * FROM booking_requests WHERE id = ?", [id]);
    if (!request) {
      return res.status(404).json({ error: 'Solicitação de agendamento não encontrada.' });
    }

    const cleanPhone = normalizeBrazilianPhone(request.patient_phone);

    // 1. Atualiza status da solicitação
    await db.run("UPDATE booking_requests SET status = 'rejected' WHERE id = ?", [id]);

    // 2. Envia mensagem de remarcação via WhatsApp ao paciente
    const rejectMsg = `Olá *${request.patient_name}*, identificamos que o horário sugerido para sua consulta não está mais disponível ou precisou ser alterado. Por gentileza, aguarde um momento que nossa recepção entrará em contato para encontrar o melhor horário para você.`;
    
    await sendWhatsAppMessage(cleanPhone, rejectMsg);
    await saveChatMessage(cleanPhone, 'assistant', rejectMsg);

    res.json({ success: true, message: 'Solicitação rejeitada com sucesso.' });
  } catch (err: any) {
    console.error('[API Reject Booking] Erro ao rejeitar solicitação:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Retorna a fila virtual de pacientes fisicamente na clínica
 */
app.get('/api/virtual-queue', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  try {
    const queue = await db.all("SELECT * FROM virtual_queue ORDER BY id ASC");
    res.json(queue);
  } catch (err: any) {
    console.error('[API Get Virtual Queue] Erro:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Adiciona um paciente à fila virtual
 */
app.post('/api/virtual-queue', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  const { phone, name } = req.body;
  if (!phone || !name) {
    return res.status(400).json({ error: 'Telefone e nome são obrigatórios.' });
  }

  try {
    const cleanPhone = normalizeBrazilianPhone(phone);
    const arrivalTime = new Date().toISOString();
    
    // Insere na fila
    const result = await db.run(
      "INSERT INTO virtual_queue (patient_phone, patient_name, status, arrival_time) VALUES (?, ?, 'waiting', ?)",
      [cleanPhone, name, arrivalTime]
    );

    res.json({ success: true, id: result.lastID, message: 'Paciente adicionado à fila virtual.' });
  } catch (err: any) {
    console.error('[API Add Virtual Queue] Erro:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Atualiza status do paciente na fila virtual
 */
app.post('/api/virtual-queue/:id/status', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  const { id } = req.params;
  const { status } = req.body; // 'waiting', 'in_consultation', 'completed', ou 'remove'

  try {
    if (status === 'remove') {
      await db.run("DELETE FROM virtual_queue WHERE id = ?", [id]);
      return res.json({ success: true, message: 'Paciente removido da fila virtual.' });
    }

    if (!['waiting', 'in_consultation', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    await db.run("UPDATE virtual_queue SET status = ? WHERE id = ?", [status, id]);
    res.json({ success: true, message: `Status da fila atualizado para ${status}.` });
  } catch (err: any) {
    console.error('[API Update Virtual Queue] Erro:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Retorna configurações gerais da clínica
 */
app.get('/api/settings', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  try {
    const rows = await db.all("SELECT * FROM settings");
    const settingsObj: Record<string, string> = {};
    rows.forEach(r => {
      settingsObj[r.key] = r.value;
    });
    res.json(settingsObj);
  } catch (err: any) {
    console.error('[API Get Settings] Erro:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Salva ou atualiza uma configuração da clínica
 */
app.post('/api/settings', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'Chave e valor são obrigatórios.' });
  }

  try {
    await db.run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, String(value)]
    );
    res.json({ success: true, message: `Configuração ${key} atualizada para ${value}.` });
  } catch (err: any) {
    console.error('[API Save Setting] Erro:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * API: Retorna resumo dos dados armazenados (para o painel de diagnóstico)
 */
app.get('/api/data-summary', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Banco de dados não disponível' });
  try {
    const sessions = loadTriageSessions();
    const messages = await db.all('SELECT DISTINCT patient_phone FROM chat_messages');
    const sessionCount = Object.keys(sessions).length;
    const historyCount = messages.length;

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

/**
 * API: Retorna os logs do console em tempo real capturados no servidor
 */
app.get('/api/server-logs', (req, res) => {
  res.json({ logs: serverLogs });
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
  
  // Inicializa o banco SQLite
  await initDatabase();
  
  if (isGoogleAuthenticated()) {
    console.log('Google Auth: Inicializando planilhas de controle...');
    await initializeSheets();
  }
});
