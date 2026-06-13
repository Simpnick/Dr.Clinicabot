import { calendar } from './client';
import * as dotenv from 'dotenv';
import { sendWhatsAppMessage } from '../whatsapp/client';

dotenv.config();

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

/**
 * Dispara lembretes de consulta para todos os pacientes agendados para o dia de amanhã
 */
export async function sendDailyReminders(): Promise<{ sentCount: number; errors: string[] }> {
  const errors: string[] = [];
  let sentCount = 0;

  try {
    // Configura início e fim do dia de amanhã
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const startOfTomorrow = new Date(tomorrow);
    startOfTomorrow.setHours(0, 0, 0, 0);

    const endOfTomorrow = new Date(tomorrow);
    endOfTomorrow.setHours(23, 59, 59, 999);

    console.log(`Lembretes: Buscando consultas para amanhã (${startOfTomorrow.toLocaleDateString('pt-BR')})...`);

    // Listar eventos do Google Calendar para amanhã
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: startOfTomorrow.toISOString(),
      timeMax: endOfTomorrow.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items || [];
    console.log(`Lembretes: Encontrados ${events.length} eventos amanhã.`);

    for (const event of events) {
      const summary = event.summary || '';
      const description = event.description || '';

      // Verifica se é um evento de consulta cadastrado pelo bot
      if (summary.startsWith('Consulta:') && description.includes('WhatsApp:')) {
        try {
          // Extrair informações do paciente do corpo da descrição
          const nameMatch = description.match(/Paciente:\s*(.*)/);
          const phoneMatch = description.match(/WhatsApp:\s*([^\n]*)/);

          const patientName = nameMatch ? nameMatch[1].trim() : 'Paciente';
          const rawPhone = phoneMatch ? phoneMatch[1].trim() : '';
          const cleanPhone = rawPhone.replace(/\D/g, '');

          if (!cleanPhone) {
            console.warn(`Lembretes: WhatsApp não encontrado para o evento: "${summary}"`);
            continue;
          }

          // Obter o horário formatado (SP timezone)
          const startDateTimeStr = event.start?.dateTime || '';
          if (!startDateTimeStr) continue;

          const startDateTime = new Date(startDateTimeStr);
          const timeFormatted = startDateTime.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Sao_Paulo'
          });

          // Mensagem de lembrete com chamada para ação interativa
          const reminderMessage = 
`Olá, *${patientName}*! Tudo bem?
Este é um lembrete automático da sua consulta marcada para amanhã (*${startOfTomorrow.toLocaleDateString('pt-BR')}*) às *${timeFormatted}*.

Por favor, responda a esta mensagem confirmando o seu comparecimento:
👉 Digite *1* para *Confirmar* a consulta.
👉 Digite *2* para *Desmarcar/Cancelar* a consulta.

Agradecemos desde já!`;

          // Disparar o texto via API Oficial do WhatsApp
          try {
            await sendWhatsAppMessage(cleanPhone, reminderMessage);
            console.log(`Lembretes: Mensagem enviada para ${patientName} (${cleanPhone}) às ${timeFormatted}.`);
            sentCount++;
          } catch (whatsappError: any) {
            console.error(`Lembretes: Falha ao enviar mensagem para ${cleanPhone}:`, whatsappError.message);
            throw whatsappError;
          }
        } catch (eventError: any) {
          console.error(`Erro ao enviar lembrete para evento "${summary}":`, eventError.message);
          errors.push(`Erro no evento "${summary}": ${eventError.message}`);
        }
      }
    }

    return { sentCount, errors };
  } catch (error: any) {
    console.error('Erro na rotina de envio de lembretes diários:', error);
    throw error;
  }
}
