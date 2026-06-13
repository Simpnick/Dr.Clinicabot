import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFreeSlotsForPatient } from '../../src/core/scheduler/scheduler-service';
import { classifyPatient } from '../../src/config/agenda';

// Mock do módulo do calendário do Google para isolar os testes
vi.mock('../../src/services/google/calendar', () => {
  return {
    getBusyTimes: vi.fn(async (startStr: string, endStr: string) => {
      // Simula que existe um compromisso agendado no dia 2026-06-01 (Segunda-feira) às 15:00
      if (startStr.includes('2026-06-01')) {
        return [
          {
            start: new Date('2026-06-01T15:00:00-03:00'),
            end: new Date('2026-06-01T15:30:00-03:00')
          }
        ];
      }
      return [];
    })
  };
});

describe('Lógica do Classificador de Pacientes', () => {
  it('Deve classificar Unimed Criança se idade < 16', () => {
    expect(classifyPatient('Unimed', 10)).toBe('UNIMED_CRIANCA');
    expect(classifyPatient('unimed plano basico', 15)).toBe('UNIMED_CRIANCA');
  });

  it('Deve classificar Unimed Adulto se idade >= 16', () => {
    expect(classifyPatient('Unimed cooperativo', 16)).toBe('UNIMED_ADULTO');
    expect(classifyPatient('UNIMED', 35)).toBe('UNIMED_ADULTO');
  });

  it('Deve classificar Saúde São José corretamente', () => {
    expect(classifyPatient('Saúde São José', 8)).toBe('SSJ_CRIANCA');
    expect(classifyPatient('ssj', 20)).toBe('SSJ_ADULTO');
  });

  it('Deve classificar CISAMREC e Celk corretamente', () => {
    expect(classifyPatient('CISAMREC', 30)).toBe('CISAMREC');
    expect(classifyPatient('Celk Criciúma', 45)).toBe('CELK_CRICIUMA');
  });

  it('Deve classificar como Particular qualquer outro caso', () => {
    expect(classifyPatient('Bradesco', 40)).toBe('PARTICULAR');
    expect(classifyPatient('Nenhum', 19)).toBe('PARTICULAR');
  });
});

describe('Scheduler Service - Busca de Slots Livres', () => {
  it('Não deve retornar horários para Sextas, Sábados ou Domingos', async () => {
    // 2026-06-05 é uma Sexta-feira
    const slotsSexta = await getFreeSlotsForPatient('2026-06-05', 'Unimed', 30);
    expect(slotsSexta).toEqual([]);

    // 2026-06-06 é um Sábado
    const slotsSabado = await getFreeSlotsForPatient('2026-06-06', 'Unimed', 30);
    expect(slotsSabado).toEqual([]);
  });

  it('Deve retornar os slots teóricos corretos para Segunda-feira se não houver conflitos', async () => {
    // 2026-06-01 é uma Segunda-feira
    // Unimed Adulto (30 anos): slots ['14:45', '15:15', '15:45', '17:00', '18:00']
    // O mock simula que o slot das 15:00 a 15:30 está ocupado.
    // Como Unimed Adulto tem duração de 30 min, o slot das 14:45 (que termina 15:15) e o das 15:15 (que termina 15:45) sofrem sobreposição.
    // Sobram apenas 15:45, 17:00 e 18:00 (total de 3 slots).
    const slots = await getFreeSlotsForPatient('2026-06-01', 'Unimed', 30);
    expect(slots).toContain('2026-06-01T15:45:00-03:00');
    expect(slots).toContain('2026-06-01T17:00:00-03:00');
    expect(slots.length).toBe(3);
  });

  it('Deve filtrar slots ocupados pelo calendário real', async () => {
    // 2026-06-01 (Segunda-feira) - Unimed Criança (10 anos)
    // slots teóricos: ['15:00', '15:30', '16:00', '17:15', '17:30', '18:15', '18:45', '19:00']
    // O slot das 15:00 está simulado como ocupado.
    const slots = await getFreeSlotsForPatient('2026-06-01', 'Unimed', 10);
    
    // O slot das 15:00:00-03:00 não deve estar presente
    expect(slots).not.toContain('2026-06-01T15:00:00-03:00');
    // Outros slots de Unimed Criança devem estar presentes
    expect(slots).toContain('2026-06-01T15:30:00-03:00');
    expect(slots).toContain('2026-06-01T19:00:00-03:00');
    expect(slots.length).toBe(7); // 8 - 1 ocupado = 7 livres
  });
});
