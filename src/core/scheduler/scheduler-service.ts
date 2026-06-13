import { classifyPatient, AGENDA_2026, PatientCategory } from '../../config/agenda';
import { getBusyTimes } from '../../services/google/calendar';

/**
 * Retorna a duração padrão de consulta em minutos com base na categoria
 */
function getSlotDurationMinutes(category: PatientCategory): number {
  switch (category) {
    case 'CELK_CRICIUMA':
      return 10;
    case 'CISAMREC':
    case 'PARTICULAR':
    case 'UNIMED_CRIANCA':
    case 'SSJ_CRIANCA':
      return 15;
    case 'UNIMED_ADULTO':
    case 'SSJ_ADULTO':
      return 30;
    default:
      return 30;
  }
}

/**
 * Busca os horários livres reais para um paciente em uma data específica
 * @param dateStr Data no formato 'YYYY-MM-DD'
 * @param healthPlan Nome do convênio de saúde
 * @param age Idade do paciente em anos
 */
export async function getFreeSlotsForPatient(
  dateStr: string,
  healthPlan: string,
  age: number
): Promise<string[]> {
  try {
    // 1. Validação do dia da semana (Segunda a Quinta: 1 a 4)
    // Usamos um formato que evite problemas de fuso horário local na criação da data
    const dateObj = new Date(`${dateStr}T12:00:00-03:00`);
    const dayOfWeek = dateObj.getDay(); // 0 = Domingo, 1 = Segunda, ..., 5 = Sexta, 6 = Sábado

    if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) {
      console.log(`[Scheduler] Data ${dateStr} cai em final de semana ou sexta-feira. Dr. Carlos não atende neste dia.`);
      return [];
    }

    // 2. Classifica o paciente e obtém os horários teóricos de cotas
    const category = classifyPatient(healthPlan, age);
    const rule = AGENDA_2026[category];
    const duration = getSlotDurationMinutes(category);

    if (!rule || rule.slots.length === 0) {
      return [];
    }

    // 3. Busca horários ocupados no calendário para este dia
    const startOfDay = `${dateStr}T00:00:00-03:00`;
    const endOfDay = `${dateStr}T23:59:59-03:00`;
    const busyTimes = await getBusyTimes(startOfDay, endOfDay);

    // 4. Converte e filtra os horários livres contra os ocupados
    const freeSlots: string[] = [];

    for (const timeStr of rule.slots) {
      const slotStart = new Date(`${dateStr}T${timeStr}:00-03:00`);
      const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

      const slotStartTime = slotStart.getTime();
      const slotEndTime = slotEnd.getTime();

      // Verifica se o slot está no passado se a data pesquisada for hoje
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const parts = formatter.formatToParts(now);
      const day = parts.find(p => p.type === 'day')?.value || '';
      const month = parts.find(p => p.type === 'month')?.value || '';
      const year = parts.find(p => p.type === 'year')?.value || '';
      const todayStr = `${year}-${month}-${day}`;

      if (dateStr === todayStr && slotStartTime <= now.getTime()) {
        continue; // Ignora slots passados
      }

      // Verifica se há sobreposição com algum período ocupado
      const isOverlapping = busyTimes.some(busy => {
        const busyStartTime = busy.start.getTime();
        const busyEndTime = busy.end.getTime();

        // Formula de interseção: slotStart < busyEnd && slotEnd > busyStart
        return slotStartTime < busyEndTime && slotEndTime > busyStartTime;
      });

      if (!isOverlapping) {
        freeSlots.push(`${dateStr}T${timeStr}:00-03:00`);
      }
    }

    return freeSlots;
  } catch (error) {
    console.error(`[Scheduler] Erro ao buscar slots livres para a data ${dateStr}:`, error);
    return [];
  }
}
