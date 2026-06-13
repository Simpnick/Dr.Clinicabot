import { calendar } from './client';
import * as dotenv from 'dotenv';

dotenv.config();

// Se não houver ID específico da agenda, usa a agenda principal ('primary')
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

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
    console.error('Erro ao criar evento no Google Calendar:', error);
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
    console.error('Erro ao deletar evento no Google Calendar:', error);
    throw error;
  }
}

/**
 * Busca o compromisso de amanhã para um determinado paciente com base no número de telefone
 */
export async function findTomorrowAppointmentByPhone(patientPhone: string): Promise<any> {
  const cleanPhone = patientPhone.replace(/\D/g, '');
  
  // Define o período de amanhã (00:00:00 até 23:59:59) no fuso local/servidor
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const timeMin = new Date(tomorrow);
  timeMin.setHours(0, 0, 0, 0);
  
  const timeMax = new Date(tomorrow);
  timeMax.setHours(23, 59, 59, 999);
  
  const response = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime'
  });
  
  const events = response.data.items || [];
  
  // Procurar o evento que contenha o telefone no description ou summary
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
  
  return null;
}

/**
 * Busca compromissos futuros para um determinado paciente com base no número de telefone (próximos 30 dias)
 */
export async function findUpcomingAppointmentByPhone(patientPhone: string): Promise<any> {
  const cleanPhone = patientPhone.replace(/\D/g, '');
  
  const now = new Date();
  const timeMin = now.toISOString();
  
  // Próximos 30 dias
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
    console.error('Erro ao buscar compromissos futuros:', error);
  }
  
  return null;
}

/**
 * Obtém os detalhes de um evento pelo ID
 */
export async function getEventById(eventId: string): Promise<any> {
  try {
    const res = await calendar.events.get({
      calendarId: CALENDAR_ID,
      eventId: eventId
    });
    return res.data;
  } catch (error) {
    console.error(`Erro ao buscar evento ${eventId}:`, error);
    throw error;
  }
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
    
    // Atualiza o resumo
    let summary = event.summary || '';
    if (!summary.includes('[CONFIRMADA]')) {
      summary = `[CONFIRMADA] ${summary}`;
    }
    
    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId: event.id,
      requestBody: {
        summary: summary,
        colorId: '10' // Cor verde no Google Calendar (Basil/Green)
      }
    });
    
    console.log(`Google Calendar: Agendamento de amanhã para ${patientPhone} confirmado com sucesso.`);
    return true;
  } catch (error) {
    console.error('Erro ao confirmar agendamento no Google Calendar:', error);
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
    console.error('Erro ao cancelar agendamento no Google Calendar:', error);
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
    console.error('Erro ao buscar horários ocupados no Google Calendar:', error);
    return [];
  }
}

/**
 * Retorna os slots disponíveis em um determinado dia dentro do horário comercial (08:00 às 18:00)
 * @param dateStr String de data no formato 'YYYY-MM-DD'
 * @param slotDurationMinutes Duração do slot (padrão 30 min)
 */
export async function getFreeSlots(dateStr: string, slotDurationMinutes: number = 60): Promise<string[]> {
  try {
    // Horário comercial: 08:00 às 18:00
    const startHour = 8;
    const endHour = 18;

    // Configura início e fim do dia no fuso de SP
    const timeMin = new Date(`${dateStr}T00:00:00-03:00`);
    const timeMax = new Date(`${dateStr}T23:59:59-03:00`);

    const busyTimes = await getBusyTimes(timeMin.toISOString(), timeMax.toISOString());

    // Gerar todos os slots possíveis comerciais para o dia
    const possibleSlots: Date[] = [];
    const currentSlot = new Date(`${dateStr}T08:00:00-03:00`);
    const limitTime = new Date(`${dateStr}T18:00:00-03:00`);

    // Não sugere horários no passado se for hoje
    const now = new Date();

    while (currentSlot.getTime() < limitTime.getTime()) {
      if (currentSlot.getTime() > now.getTime()) {
        possibleSlots.push(new Date(currentSlot.getTime()));
      }
      currentSlot.setMinutes(currentSlot.getMinutes() + slotDurationMinutes);
    }

    // Filtrar slots que não tenham sobreposição com os horários ocupados (busyTimes)
    const freeSlots = possibleSlots.filter(slot => {
      const slotStart = slot.getTime();
      const slotEnd = slotStart + slotDurationMinutes * 60 * 1000;

      // Retorna false se houver interseção com qualquer período ocupado
      const overlaps = busyTimes.some(busy => {
        const busyStart = busy.start.getTime();
        const busyEnd = busy.end.getTime();
        
        // Verifica sobreposição
        return (slotStart < busyEnd && slotEnd > busyStart);
      });

      return !overlaps;
    });

    // Formata o retorno das datas em strings legíveis para o robô/paciente
    return freeSlots.map(slot => {
      return slot.toISOString(); // Retorna ISO para podermos converter de volta no agendamento, depois formatamos em texto amigável
    });
  } catch (error) {
    console.error('Erro ao gerar horários livres:', error);
    return [];
  }
}

/**
 * Lista todos os compromissos agendados em um intervalo de datas
 * @param startDateStr String de data no formato 'YYYY-MM-DD'
 * @param endDateStr String de data no formato 'YYYY-MM-DD' (opcional)
 */
export async function listAppointments(startDateStr: string, endDateStr?: string): Promise<Array<{ id: string; summary: string; start: string; end: string; description: string }>> {
  try {
    const timeMin = new Date(`${startDateStr}T00:00:00-03:00`);
    const timeMax = new Date(`${endDateStr || startDateStr}T23:59:59-03:00`);

    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items || [];
    return events.map(event => ({
      id: event.id || '',
      summary: event.summary || 'Sem Título',
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      description: event.description || ''
    }));
  } catch (error) {
    const dateRangeStr = endDateStr ? `${startDateStr} a ${endDateStr}` : startDateStr;
    console.error(`Erro ao listar consultas para o período ${dateRangeStr}:`, error);
    throw error;
  }
}

