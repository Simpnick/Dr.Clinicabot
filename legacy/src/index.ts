import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { initializeSheets } from './lib/google/sheets';
import { runAgent, clearChatHistory } from './lib/ai/agent';
import { confirmAppointmentByPhone, cancelAppointmentByPhone, getEventById, cancelAppointment, createAppointment } from './lib/google/calendar';
import { sendDailyReminders } from './lib/google/reminders';
import { getAuthUrl, oauth2Client, saveCredentials, isGoogleAuthenticated } from './lib/google/client';
import axios from 'axios';
import { getEnvConfig, updateEnvConfig } from './lib/utils/env-manager';
import { sendWhatsAppMessage, normalizeBrazilianPhone, markWhatsAppMessageAsRead } from './lib/whatsapp/client';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// O número do WhatsApp do médico cadastrado nas configurações (apenas números com DDD)
const DOCTOR_PHONE = normalizeBrazilianPhone(process.env.DOCTOR_PHONE || '');

// Conjunto em memória para rastrear se o médico está simulando um paciente
const doctorAsPatientSet = new Set<string>();

/**
 * Função auxiliar para processar qualquer mensagem recebida (real ou simulada)
 */
async function processIncomingMessage(senderPhone: string, text: string, isDoctor: boolean): Promise<string> {
  let trimmedText = text.replace(/[*~]/g, '').trim();
  trimmedText = trimmedText.replace(/^_+|_+$/g, '');
  console.log(`[DEBUG] processIncomingMessage: senderPhone="${senderPhone}", DOCTOR_PHONE="${DOCTOR_PHONE}", text="${text}", trimmedText="${trimmedText}"`);
  
  // 1. Comando de alternância de modo e aprovação de agendamento via WhatsApp (apenas do número real do médico)
  if (senderPhone === DOCTOR_PHONE) {
    if (trimmedText === '#modo_paciente') {
      doctorAsPatientSet.add(senderPhone);
      console.log(`[Role Toggle] Médico ${senderPhone} alternou para o MODO PACIENTE via WhatsApp.`);
      
      // Limpa o histórico de teste do paciente para evitar que mensagens de testes anteriores interfiram
      clearChatHistory(`${senderPhone}_patient`);
      
      const responseText = 'Modo Paciente ativado. Suas mensagens agora serão tratadas como se você fosse um paciente.';
      await sendWhatsAppMessage(senderPhone, responseText);
      return responseText;
    } else if (trimmedText === '#modo_medico') {
      doctorAsPatientSet.delete(senderPhone);
      console.log(`[Role Toggle] Médico ${senderPhone} alternou para o MODO MÉDICO via WhatsApp.`);
      const responseText = 'Modo Médico reativado. Você agora tem acesso total a todos os recursos administrativos.';
      await sendWhatsAppMessage(senderPhone, responseText);
      return responseText;
    } else if (trimmedText.startsWith('#cancelar_')) {
      const eventId = trimmedText.replace('#cancelar_', '').trim();
      console.log(`[Webhook WhatsApp] Médico solicitou cancelamento do compromisso: ${eventId}`);
      
      try {
        const event = await getEventById(eventId);
        const desc = event.description || '';
        let patientPhone = '';
        const phoneMatch = desc.match(/WhatsApp:\s*(\d+)/);
        if (phoneMatch && phoneMatch[1]) {
          patientPhone = phoneMatch[1];
        }
        
        const patientName = event.summary?.replace('Consulta: ', '') || 'Paciente';
        const apptDateStr = new Date(event.start.dateTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        await cancelAppointment(eventId);
        
        const doctorConfirmMsg = `✅ *[Cancelamento Efetuado]*\nA consulta de *${patientName}* no dia *${apptDateStr}* foi cancelada com sucesso na agenda.`;
        await sendWhatsAppMessage(senderPhone, doctorConfirmMsg);
        
        if (patientPhone) {
          const patientNoticeMsg = `Olá! Informamos que a sua consulta que estava agendada para *${apptDateStr}* foi cancelada a pedido do médico/clínica. Se desejar reagendar, por favor envie uma mensagem.`;
          await sendWhatsAppMessage(patientPhone, patientNoticeMsg);
        }
        
        return doctorConfirmMsg;
      } catch (err: any) {
        console.error('Erro ao efetuar cancelamento via comando do médico:', err);
        const errorMsg = `❌ Erro ao cancelar compromisso: ${err.message || err}`;
        await sendWhatsAppMessage(senderPhone, errorMsg);
        return errorMsg;
      }
    } else if (trimmedText.startsWith('#reagendar_')) {
      const parts = trimmedText.replace('#reagendar_', '').split('_');
      const eventId = parts[0];
      const newStartIso = parts.slice(1).join('_');
      
      console.log(`[Webhook WhatsApp] Médico solicitou reagendamento do compromisso: ${eventId} para ${newStartIso}`);
      
      try {
        const event = await getEventById(eventId);
        const desc = event.description || '';
        let patientPhone = '';
        const phoneMatch = desc.match(/WhatsApp:\s*(\d+)/);
        if (phoneMatch && phoneMatch[1]) {
          patientPhone = phoneMatch[1];
        }
        const patientName = event.summary?.replace('Consulta: ', '') || 'Paciente';
        const oldDateStr = new Date(event.start.dateTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const newDateStr = new Date(newStartIso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        await cancelAppointment(eventId);
        await createAppointment(patientName, patientPhone, newStartIso);
        
        const doctorConfirmMsg = `✅ *[Reagendamento Efetuado]*\nA consulta de *${patientName}* foi alterada:\n❌ Antes: *${oldDateStr}*\n✅ Agora: *${newDateStr}*`;
        await sendWhatsAppMessage(senderPhone, doctorConfirmMsg);
        
        if (patientPhone) {
          const patientNoticeMsg = `Olá! A sua consulta foi reagendada pelo Dr. com sucesso!\n\n📅 Nova Data/Hora: *${newDateStr}*\n\nEsperamos você!`;
          await sendWhatsAppMessage(patientPhone, patientNoticeMsg);
        }
        
        return doctorConfirmMsg;
      } catch (err: any) {
        console.error('Erro ao efetuar reagendamento via comando do médico:', err);
        const errorMsg = `❌ Erro ao reagendar compromisso: ${err.message || err}`;
        await sendWhatsAppMessage(senderPhone, errorMsg);
        return errorMsg;
      }
    }
  }

  // 2. Resposta de confirmação/cancelamento direta do paciente (1 ou 2) para agendamentos de amanhã
  if (!isDoctor && (trimmedText === '1' || trimmedText === '2')) {
    console.log(`[Webhook WhatsApp] Paciente ${senderPhone} respondeu confirmando/cancelando consulta de amanhã com: ${trimmedText}`);
    let responseText = '';
    if (trimmedText === '1') {
      const success = await confirmAppointmentByPhone(senderPhone);
      responseText = success 
        ? 'Sua consulta de amanhã foi confirmada com sucesso! Obrigado.'
        : 'Não encontramos nenhuma consulta agendada para amanhã para este número. Se precisar, você pode solicitar um novo agendamento com nosso assistente virtual.';
    } else {
      const success = await cancelAppointmentByPhone(senderPhone);
      responseText = success
        ? 'Sua consulta de amanhã foi desmarcada com sucesso. Caso queira reagendar no futuro, basta mandar uma nova mensagem para nosso assistente.'
        : 'Não encontramos nenhuma consulta agendada para amanhã para este número. Se precisar, você pode solicitar um novo agendamento com nosso assistente virtual.';
    }
    await sendWhatsAppMessage(senderPhone, responseText);
    return responseText;
  }

  // 3. Processamento geral via Agente de IA
  const aiResponse = await runAgent(senderPhone, text, isDoctor);
  await sendWhatsAppMessage(senderPhone, aiResponse);
  return aiResponse;
}

// O método sendWhatsAppMessage agora é importado de './lib/whatsapp/client' e consome as chaves do .env automaticamente.

/**
 * Rota de validação do Webhook da API Oficial do WhatsApp (GET)
 */
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
    console.log('WhatsApp: Webhook verificado com sucesso pelo Facebook!');
    return res.status(200).send(challenge);
  } else {
    console.warn('WhatsApp: Falha na verificação do Webhook. Token incorreto.');
    return res.sendStatus(403);
  }
});

// Conjunto em memória para rastrear e ignorar IDs de mensagens duplicadas (deduplicação)
const processedMessageIds = new Set<string>();

// Fila sequencial de mensagens por usuário para evitar race-conditions e respostas fora de ordem
class MessageQueue {
  private queue: Promise<any> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const nextPromise = this.queue.then(() => task());
    this.queue = nextPromise.catch(() => {}); // captura erros para não travar a fila
    return nextPromise;
  }
}

const userQueues = new Map<string, MessageQueue>();

function getUserQueue(phone: string): MessageQueue {
  let q = userQueues.get(phone);
  if (!q) {
    q = new MessageQueue();
    userQueues.set(phone, q);
  }
  return q;
}


/**
 * Rota de eventos do Webhook da API Oficial do WhatsApp (POST)
 */
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const payload = req.body;

    // Estrutura de eventos do WhatsApp Cloud API
    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      // Silenciosamente ignora eventos que não sejam mensagens diretas (ex: status de entrega)
      return res.status(200).json({ status: 'ignored_non_message_event' });
    }

    const messageId = message.id;
    let senderPhone = message.from;
    if (!senderPhone) {
      return res.status(200).json({ status: 'ignored_no_sender' });
    }
    senderPhone = normalizeBrazilianPhone(senderPhone);

    // Verifica se a mensagem já foi processada recentemente para evitar duplicidade (webhook retries)
    if (messageId) {
      if (processedMessageIds.has(messageId)) {
        console.log(`\n📥 [WEBHOOK WHATSAPP] Ignorando webhook duplicado para a mensagem ID: ${messageId}`);
        return res.status(200).json({ status: 'ignored_duplicate' });
      }
      processedMessageIds.add(messageId);
      
      // Mantém no máximo os últimos 200 IDs para economizar memória
      if (processedMessageIds.size > 200) {
        const firstValue = processedMessageIds.values().next().value;
        if (firstValue !== undefined) {
          processedMessageIds.delete(firstValue);
        }
      }
    }

    // Extrai o conteúdo do texto de diferentes tipos de mensagens
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
      return res.status(200).json({ status: 'ignored_no_text' });
    }

    const isDoctor = senderPhone === DOCTOR_PHONE && !doctorAsPatientSet.has(senderPhone);
    
    console.log(`\n📥 [WEBHOOK WHATSAPP] Nova mensagem recebida!`);
    console.log(`🆔 ID da Mensagem: ${messageId}`);
    console.log(`👤 De: ${senderPhone} (Médico? ${isDoctor})`);
    console.log(`💬 Conteúdo: "${text}"`);
    console.log(`⚡ Respondendo 200 OK para o Meta imediatamente e processando em segundo plano...`);

    // Responde 200 OK imediatamente ao Meta para evitar o timeout de 15 segundos
    res.status(200).json({ status: 'received_and_processing' });

    // Marca a mensagem recebida como lida na API do WhatsApp (double check azul)
    if (messageId) {
      markWhatsAppMessageAsRead(messageId).catch(err => {
        console.error('Erro ao marcar mensagem como lida no webhook:', err);
      });
    }

    // Processamento assíncrono em segundo plano sequencial por usuário
    const userQueue = getUserQueue(senderPhone);
    userQueue.enqueue(async () => {
      try {
        const startTime = Date.now();
        await processIncomingMessage(senderPhone, text, isDoctor);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n📤 [WEBHOOK WHATSAPP] Processamento concluído para ${senderPhone}! Tempo de resposta: ${duration}s`);
      } catch (err: any) {
        console.error(`❌ Erro no processamento assíncrono para ${senderPhone}:`, err);
      }
    });

  } catch (error) {
    console.error('Erro ao processar Webhook:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

/**
 * Rota raiz: Redireciona para o painel de Setup
 */
app.get('/', (req, res) => {
  res.redirect('/setup');
});

/**
 * Rota do painel de Setup Visual
 */
app.get('/setup', (req, res) => {
  const srcPath = path.join(process.cwd(), 'src', 'views', 'setup.html');
  const distPath = path.join(process.cwd(), 'dist', 'views', 'setup.html');
  
  let finalPath = srcPath;
  if (fs.existsSync(distPath)) {
    finalPath = distPath;
  }

  if (!fs.existsSync(finalPath)) {
    return res.status(404).send('O arquivo setup.html não foi encontrado.');
  }

  res.sendFile(finalPath);
});

/**
 * Rota da API para retornar o status da simulação do médico atuando como paciente
 */
app.get('/api/test/doctor-as-patient', (req, res) => {
  res.json({ active: doctorAsPatientSet.has(DOCTOR_PHONE) });
});

/**
 * Rota da API para alternar a simulação do médico atuando como paciente
 */
app.post('/api/test/toggle-doctor-as-patient', (req, res) => {
  try {
    const { active } = req.body;
    if (active) {
      doctorAsPatientSet.add(DOCTOR_PHONE);
    } else {
      doctorAsPatientSet.delete(DOCTOR_PHONE);
    }
    console.log(`[Role Toggle] Status de médico atuando como paciente alterado via painel para: ${doctorAsPatientSet.has(DOCTOR_PHONE)}`);
    res.json({ success: true, active: doctorAsPatientSet.has(DOCTOR_PHONE) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao alternar modo.' });
  }
});

/**
 * Rota da API para retornar configurações e status atualizado
 */
app.get('/api/config', async (req, res) => {
  const config = getEnvConfig();
  const googleAuthenticated = isGoogleAuthenticated();
  
  let sheetsConnected = false;
  let sheetsError = '';
  if (googleAuthenticated && config.GOOGLE_SPREADSHEET_ID && config.GOOGLE_SPREADSHEET_ID !== 'id_da_sua_planilha_sheets_aqui') {
    try {
      await initializeSheets();
      sheetsConnected = true;
    } catch (err: any) {
      sheetsError = err.message || 'Erro ao conectar à planilha.';
    }
  }

  let whatsappConnected = false;
  const simulationActive = process.env.WHATSAPP_SIMULATION_MODE === 'true';
  
  if (simulationActive) {
    whatsappConnected = true;
  } else if (config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_ACCESS_TOKEN) {
    try {
      // Valida a validade do token de acesso buscando os detalhes do número no Meta Graph API
      const stateResponse = await axios.get(
        `https://graph.facebook.com/v20.0/${config.WHATSAPP_PHONE_NUMBER_ID}`,
        {
          headers: {
            'Authorization': `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`
          },
          timeout: 2000
        }
      );
      if (stateResponse.data?.id) {
        whatsappConnected = true;
      }
    } catch (err) {
      // Mantém whatsappConnected como false
    }
  }

  res.json({
    config,
    status: {
      googleAuthenticated,
      sheetsConnected,
      sheetsError,
      whatsappConnected,
      simulationActive
    }
  });
});

/**
 * Rota da API para atualizar configurações no arquivo .env
 */
app.post('/api/config', async (req, res) => {
  try {
    const updates = req.body;
    
    // Sanitize spreadsheet ID if a full URL is provided
    if (updates.GOOGLE_SPREADSHEET_ID) {
      const match = updates.GOOGLE_SPREADSHEET_ID.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        updates.GOOGLE_SPREADSHEET_ID = match[1];
      }
    }

    updateEnvConfig(updates);
    
    // Se o ID da planilha mudou e o Google está autenticado, reinicializa
    if (isGoogleAuthenticated() && updates.GOOGLE_SPREADSHEET_ID && updates.GOOGLE_SPREADSHEET_ID !== 'id_da_sua_planilha_sheets_aqui') {
      try {
        await initializeSheets();
      } catch (err) {
        console.warn('Erro ao inicializar planilha após update:', err);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao atualizar configurações.' });
  }
});

/**
 * Rota da API para testar o envio de uma mensagem de texto oficial ao médico
 */
app.post('/api/test-whatsapp', async (req, res) => {
  try {
    if (!DOCTOR_PHONE) {
      return res.status(400).json({ error: 'O número de telefone do médico (DOCTOR_PHONE) precisa estar configurado no painel.' });
    }
    
    const text = 'Olá! Esta é uma mensagem de teste enviada pela API Oficial do WhatsApp Cloud a partir do seu painel do Chatbot Clínico. 🚀';
    await sendWhatsAppMessage(DOCTOR_PHONE, text);
    
    res.json({ success: true, message: `Mensagem de teste enviada com sucesso para o médico (${DOCTOR_PHONE}).` });
  } catch (error: any) {
    res.status(500).json({ error: error.response?.data?.error?.message || error.message || 'Erro ao enviar mensagem de teste.' });
  }
});

/**
 * Rota da API para simular o recebimento de uma mensagem do paciente/médico localmente
 */
app.post('/api/simulate-incoming', async (req, res) => {
  try {
    const { phone, text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'O texto da mensagem é obrigatório.' });
    }

    const senderPhone = normalizeBrazilianPhone(phone || DOCTOR_PHONE || '5548996633846');
    const isDoctor = senderPhone === DOCTOR_PHONE && !doctorAsPatientSet.has(senderPhone);

    console.log(`[Simulador WhatsApp] Recebido de ${senderPhone} (Médico? ${isDoctor}): "${text}"`);

    const userQueue = getUserQueue(senderPhone);
    const aiResponse = await userQueue.enqueue(async () => {
      return await processIncomingMessage(senderPhone, text, isDoctor);
    });

    res.json({ success: true, response: aiResponse });
  } catch (error: any) {
    console.error('Erro na simulação do webhook:', error);
    res.status(500).json({ error: error.message || 'Erro interno na simulação.' });
  }
});

/**
 * Rota de Health Check e status
 */
app.get('/status', (req, res) => {
  res.status(200).json({
    status: 'online',
    googleAuthenticated: isGoogleAuthenticated(),
    doctorPhoneConfigured: !!process.env.DOCTOR_PHONE,
    whatsappOfficialConfigured: !!process.env.WHATSAPP_PHONE_NUMBER_ID && !!process.env.WHATSAPP_ACCESS_TOKEN
  });
});

/**
 * Rota para iniciar o fluxo de login do Google (OAuth 2.0)
 */
app.get('/auth/google', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

/**
 * Rota de callback do Google OAuth 2.0
 */
app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    return res.status(400).send('Código de autorização ausente.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    saveCredentials(tokens);

    // Inicializa a planilha na conta conectada
    console.log('Google Auth: Inicializando tabelas de controle...');
    await initializeSheets();

    res.send(`
      <div style="font-family: sans-serif; text-align: center; margin-top: 100px; padding: 30px; background-color: #f9f9f9; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 600px; margin-left: auto; margin-right: auto;">
        <h1 style="color: #2e7d32; font-size: 28px; margin: 0 0 15px 0;">✅ Conexão Efetuada com Sucesso!</h1>
        <p style="font-size: 18px; color: #37474f; margin: 0 0 15px 0;">O chatbot clínico foi devidamente conectado à sua conta do Google.</p>
        <p style="color: #78909c; font-size: 14px; margin: 0 0 25px 0;">As planilhas de gestão e a pasta de prontuários foram geradas.</p>
        <a href="/setup" style="display: inline-block; padding: 12px 28px; background-color: #1e88e5; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; transition: background-color 0.2s;">
          Voltar para o Painel de Setup
        </a>
      </div>
    `);
  } catch (error: any) {
    console.error('Erro no callback do Google Auth:', error);
    res.status(500).send(`Erro na autorização: ${error.message}`);
  }
});

/**
 * Rota para disparar os lembretes do dia seguinte
 */
app.post('/reminders/send', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await sendDailyReminders();
    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Erro ao enviar lembretes.' });
  }
});

// Inicialização e escuta da porta
app.listen(PORT, async () => {
  console.log(`\n==================================================`);
  console.log(`Servidor rodando com sucesso na porta ${PORT}!`);
  console.log(`Acesse http://localhost:${PORT}/status para verificar.`);
  console.log(`Faça login do médico em http://localhost:${PORT}/auth/google`);
  console.log(`==================================================\n`);

  if (isGoogleAuthenticated()) {
    console.log('Google Auth: Inicializando planilhas de controle...');
    await initializeSheets();
  } else {
    console.log('Google Auth: Sem credenciais ativas. Aguardando login do médico em /auth/google');
  }
});
