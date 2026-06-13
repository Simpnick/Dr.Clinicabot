export type PatientCategory =
  | 'CELK_CRICIUMA'
  | 'CISAMREC'
  | 'UNIMED_ADULTO'
  | 'UNIMED_CRIANCA'
  | 'SSJ_ADULTO'
  | 'SSJ_CRIANCA'
  | 'PARTICULAR';

export interface AgendaSlotRule {
  category: PatientCategory;
  displayName: string;
  slots: string[]; // Horários no formato "HH:MM"
}

export const CHILD_AGE_LIMIT = 16; // Criança é menor de 16 anos (< 16)

export const AGENDA_2026: Record<PatientCategory, AgendaSlotRule> = {
  CELK_CRICIUMA: {
    category: 'CELK_CRICIUMA',
    displayName: 'Criciúma Celk',
    slots: ['13:30', '13:40', '13:50', '14:00'] // 4 slots definidos, expansível para 5
  },
  CISAMREC: {
    category: 'CISAMREC',
    displayName: 'CISAMREC',
    slots: ['14:00', '14:15', '14:30']
  },
  UNIMED_ADULTO: {
    category: 'UNIMED_ADULTO',
    displayName: 'Unimed Adulto',
    slots: ['14:45', '15:15', '15:45', '17:00', '18:00']
  },
  UNIMED_CRIANCA: {
    category: 'UNIMED_CRIANCA',
    displayName: 'Unimed Criança',
    slots: ['15:00', '15:30', '16:00', '17:15', '17:30', '18:15', '18:45', '19:00']
  },
  SSJ_ADULTO: {
    category: 'SSJ_ADULTO',
    displayName: 'Saúde São José Adulto',
    slots: ['16:15', '17:45']
  },
  SSJ_CRIANCA: {
    category: 'SSJ_CRIANCA',
    displayName: 'Saúde São José Criança',
    slots: ['16:30', '16:45', '18:30']
  },
  PARTICULAR: {
    category: 'PARTICULAR',
    displayName: 'Particular',
    slots: ['19:15', '19:30', '19:45', '20:00']
  }
};

/**
 * Classifica um paciente em uma categoria com base no plano de saúde e idade
 */
export function classifyPatient(healthPlan: string, age: number): PatientCategory {
  const planClean = healthPlan.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  if (planClean.includes('celk') || planClean.includes('criciuma')) {
    return 'CELK_CRICIUMA';
  }
  if (planClean.includes('cisamrec')) {
    return 'CISAMREC';
  }
  if (planClean.includes('unimed')) {
    return age < CHILD_AGE_LIMIT ? 'UNIMED_CRIANCA' : 'UNIMED_ADULTO';
  }
  if (planClean.includes('jose') || planClean.includes('ssj') || planClean.includes('sao jose')) {
    return age < CHILD_AGE_LIMIT ? 'SSJ_CRIANCA' : 'SSJ_ADULTO';
  }

  // Padrão: Particular
  return 'PARTICULAR';
}
