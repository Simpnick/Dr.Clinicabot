import { calendar, setTokenValid } from './client';
import { config } from '../../config/env-manager';

const CALENDAR_ID = config.GOOGLE_CALENDAR_ID || 'primary';

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string;
}

/**
 * Tratador de erros centralizado para chamadas do Google API (Calendar).
 * Identifica se o erro é de autenticação (ex: token revogado ou expirado) e invalida o token local.
 */
function handleCalendarApiError(error: any, context: string) {
  console.error(`Erro em Google Calendar (${context}):`, error);
  
  const errStr = String(error?.message || '').toLowerCase();
  const errDesc = String(error?.response?.data?.error_description || '').toLowerCase();
  const status = error?.status || error?.response?.status;

  const isAuthError = errStr.includes('invalid_grant') || 
                      errStr.includes('auth') || 
                      errStr.includes('expired') ||
                      errStr.includes('revoked') ||
                      errDesc.includes('invalid_grant') ||
                      errDesc.includes('auth') ||
                      errDesc.includes('expired') ||
                      errDesc.includes('revoked') ||
                      status === 400 || 
                      status === 401;

  if (isAuthError) {
    console.warn(`[Google OAuth] Token de autenticação identificado como inválido durante: ${context}`);
    setTokenValid(false);
  }
}

/**
 * Cria um agendamento (evento) no Google Calendar
 */
export async function createAppointment(
  patientName: string,
  patientPhone: string,
  startIsoString: string,
  durationMinutes: number = 30
): Promise<{ eventId: string; start: string; htmlLink: string }> {
  try {
    const startDate = new Date(startIsoString);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

    const event = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: `Consulta: ${patientName}`,
        description: `Paciente: ${patientName}\nWhatsApp: ${patientPhone}\nAgendado automaticamente pelo Chatbot de IA.`,
        start: {
          dateTime: startDate.toISOString(),
          timeZone: 'America/Sao_Paulo'
        },
        end: {
          dateTime: endDate.toISOString(),
          timeZone: 'America/Sao_Paulo'
        },
        reminders: {
          useDefault: true
        }
      }
    });

    console.log(`Google Calendar: Compromisso criado para ${patientName} às ${startDate.toLocaleString('pt-BR')}`);

    return {
      eventId: event.data.id || '',
      start: startDate.toISOString(),
      htmlLink: event.data.htmlLink || ''
    };
  } catch (error) {
    handleCalendarApiError(error, 'criar evento no Google Calendar');
    throw error;
  }
}

/**
 * Cancela um agendamento pelo ID do evento
 */
export async function cancelAppointment(eventId: string): Promise<void> {
  try {
    await calendar.events.delete({
      calendarId: CALENDAR_ID,
      eventId: eventId
    });
    console.log(`Google Calendar: Evento ${eventId} cancelado.`);
  } catch (error) {
    handleCalendarApiError(error, 'deletar evento no Google Calendar');
    throw error;
  }
}

/**
 * Busca o compromisso de amanhã para um determinado paciente com base no número de telefone
 */
export async function findTomorrowAppointmentByPhone(patientPhone: string): Promise<any> {
  const cleanPhone = patientPhone.replace(/\D/g, '');
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const timeMin = new Date(tomorrow);
  timeMin.setHours(0, 0, 0, 0);
  
  const timeMax = new Date(tomorrow);
  timeMax.setHours(23, 59, 59, 999);
  
  try {
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    const events = response.data.items || [];
    
    for (const event of events) {
      const desc = event.description || '';
      const summary = event.summary || '';
      const cleanDesc = desc.replace(/\D/g, '');
      const cleanSummary = summary.replace(/\D/g, '');
      
      if (
        desc.includes(patientPhone) || 
        cleanDesc.includes(cleanPhone) || 
        summary.includes(patientPhone) || 
        cleanSummary.includes(cleanPhone)
      ) {
        return event;
      }
    }
  } catch (error) {
    handleCalendarApiError(error, 'buscar compromisso de amanhã por telefone');
  }
  
  return null;
}

/**
 * Busca compromissos futuros para um determinado paciente com base no número de telefone (próximos 30 dias)
 */
export async function findUpcomingAppointmentByPhone(patientPhone: string): Promise<any> {
  const cleanPhone = patientPhone.replace(/\D/g, '');
  
  const now = new Date();
  const timeMin = now.toISOString();
  
  const farFuture = new Date();
  farFuture.setDate(now.getDate() + 30);
  const timeMax = farFuture.toISOString();
  
  try {
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    const events = response.data.items || [];
    
    for (const event of events) {
      const desc = event.description || '';
      const summary = event.summary || '';
      const cleanDesc = desc.replace(/\D/g, '');
      const cleanSummary = summary.replace(/\D/g, '');
      
      if (
        desc.includes(patientPhone) || 
        cleanDesc.includes(cleanPhone) || 
        summary.includes(patientPhone) || 
        cleanSummary.includes(cleanPhone)
      ) {
        return event;
      }
    }
  } catch (error) {
    handleCalendarApiError(error, 'buscar compromissos futuros');
  }
  
  return null;
}

/**
 * Confirma o agendamento de amanhã para o paciente (adiciona [CONFIRMADA] ao título e muda a cor para verde se disponível)
 */
export async function confirmAppointmentByPhone(patientPhone: string): Promise<boolean> {
  try {
    const event = await findTomorrowAppointmentByPhone(patientPhone);
    if (!event || !event.id) {
      console.log(`Nenhum agendamento encontrado para amanhã para o telefone ${patientPhone}`);
      return false;
    }
    
    let summary = event.summary || '';
    if (!summary.includes('[CONFIRMADA]')) {
      summary = `[CONFIRMADA] ${summary}`;
    }
    
    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId: event.id,
      requestBody: {
        summary: summary,
        colorId: '10' // Basil/Green
      }
    });
    
    console.log(`Google Calendar: Agendamento de amanhã para ${patientPhone} confirmado com sucesso.`);
    return true;
  } catch (error) {
    handleCalendarApiError(error, 'confirmar agendamento no Google Calendar');
    return false;
  }
}

/**
 * Cancela o agendamento de amanhã para o paciente (deleta o evento)
 */
export async function cancelAppointmentByPhone(patientPhone: string): Promise<boolean> {
  try {
    const event = await findTomorrowAppointmentByPhone(patientPhone);
    if (!event || !event.id) {
      console.log(`Nenhum agendamento encontrado para amanhã para o telefone ${patientPhone}`);
      return false;
    }
    
    await calendar.events.delete({
      calendarId: CALENDAR_ID,
      eventId: event.id
    });
    
    console.log(`Google Calendar: Agendamento de amanhã para ${patientPhone} cancelado com sucesso.`);
    return true;
  } catch (error) {
    handleCalendarApiError(error, 'cancelar agendamento no Google Calendar');
    return false;
  }
}

/**
 * Lista todos os horários ocupados em um determinado intervalo
 */
export async function getBusyTimes(startIsoString: string, endIsoString: string): Promise<Array<{ start: Date; end: Date }>> {
  try {
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: startIsoString,
        timeMax: endIsoString,
        timeZone: 'America/Sao_Paulo',
        items: [{ id: CALENDAR_ID }]
      }
    });

    const busyList = response.data.calendars?.[CALENDAR_ID]?.busy || [];
    return busyList.map(item => ({
      start: new Date(item.start || ''),
      end: new Date(item.end || '')
    }));
  } catch (error) {
    handleCalendarApiError(error, 'buscar horários ocupados no Google Calendar');
    return [];
  }
}

/**
 * Lista eventos do Google Calendar no intervalo especificado
 */
export async function listEvents(timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  try {
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: 'startTime'
    });
    const items = response.data.items || [];
    return items.map(item => ({
      id: item.id || '',
      summary: item.summary || 'Consulta Sem Título',
      start: item.start?.dateTime || item.start?.date || '',
      end: item.end?.dateTime || item.end?.date || '',
      description: item.description || ''
    }));
  } catch (error) {
    handleCalendarApiError(error, 'listar eventos no Google Calendar');
    return [];
  }
}
