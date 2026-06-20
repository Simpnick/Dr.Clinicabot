import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeTriageMessage } from '../../src/core/triage/triage-router';
import { TriageSession } from '../../src/core/triage/triage-flow';
import { generateLLMResponse } from '../../src/services/llm/llm-service';
import { config } from '../../src/config/env-manager';
import { getDb } from '../../src/services/db/database';
import { createAppointment } from '../../src/services/google/calendar';
import { getFreeSlotsForPatient } from '../../src/core/scheduler/scheduler-service';

// Mock do banco de dados SQLite
const dbMock = {
  run: vi.fn(async () => ({ lastID: 1, changes: 1 })),
  get: vi.fn(async () => null),
  all: vi.fn(async () => []),
  exec: vi.fn(async () => {})
};

vi.mock('../../src/services/db/database', () => {
  return {
    getDb: vi.fn(async () => dbMock)
  };
});

// Mock da configuração de triagem
vi.mock('../../src/core/triage/triage-flow', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    loadTriageConfig: vi.fn(() => ({
      welcomeMessage: 'Olá! Seja bem-vindo à Clínica do Dr. Carlos Tonelli.',
      faqs: 'Dúvidas e regras.',
      clinicName: 'Clínica Tonelli',
      doctorName: 'Dr. Carlos Tonelli',
      fields: [
        {
          key: 'name',
          label: 'Nome Completo',
          type: 'string',
          questionPrompt: 'Poderia fornecer o seu nome completo?',
          validationInstruction: 'Nome e sobrenome.',
          order: 1,
          required: true
        },
        {
          key: 'age',
          label: 'Idade',
          type: 'number',
          questionPrompt: 'Poderia informar a sua idade?',
          validationInstruction: 'Um número inteiro.',
          order: 2,
          required: true
        },
        {
          key: 'healthPlan',
          label: 'Convênio',
          type: 'choice',
          choices: ['Particular'],
          questionPrompt: 'Qual é o seu plano de saúde?',
          validationInstruction: 'Deve ser Particular.',
          order: 3,
          required: true
        }
      ]
    }))
  };
});

// Mock do scheduler para retornar um slot livre
vi.mock('../../src/core/scheduler/scheduler-service', () => {
  return {
    getFreeSlotsForPatient: vi.fn(async () => {
      return ['2026-06-22T13:30:00-03:00'];
    })
  };
});

// Mock do Google Calendar
vi.mock('../../src/services/google/calendar', () => {
  return {
    createAppointment: vi.fn(async () => {
      return {
        eventId: 'evt_auto_123',
        start: '2026-06-22T13:30:00-03:00',
        htmlLink: 'http://test-link'
      };
    })
  };
});

// Mock do LLM
vi.mock('../../src/services/llm/llm-service', () => {
  return {
    generateLLMResponse: vi.fn(async (history: any[], systemInstruction: string) => {
      const isValidator = systemInstruction.includes('Agente de Validação');
      if (isValidator) {
        // Validador extrai o convênio "Particular"
        return '{"isValid": true, "extractedValue": "Particular", "errorMessage": "", "isFAQ": false, "isCorrection": false, "correctedFieldKey": "", "correctedFieldValue": null}';
      } else {
        // Diálogo confirma a conclusão
        return 'Consulta agendada/sugerida com sucesso.';
      }
    })
  };
});

// Mock do WhatsApp
vi.mock('../../src/services/whatsapp/client', () => {
  return {
    sendWhatsAppMessage: vi.fn(async () => ({ messageId: 'msg_123' })),
    normalizeBrazilianPhone: vi.fn((phone: string) => phone.replace(/\D/g, ''))
  };
});

describe('Testes dos Modos de Agendamento (Auto, Semi, Off)', () => {
  let session: TriageSession;

  beforeEach(() => {
    vi.clearAllMocks();
    session = new TriageSession('5548999991234');
    // Preenche todos os campos exceto o último (healthPlan)
    session.state = 'AWAITING_FIELD:healthPlan';
    session.data = {
      name: 'João da Silva',
      age: 30
    };
  });

  it('Modo AUTO: Deve criar compromisso no Calendar e no SQLite local ao finalizar triagem', async () => {
    // Altera o modo no config mockado
    config.BOOKING_MODE = 'auto';

    const response = await routeTriageMessage(session, 'Particular');

    // Valida que o estado mudou para DONE
    expect(session.state).toBe('DONE');

    // Valida que chamou o scheduler para buscar vagas
    expect(getFreeSlotsForPatient).toHaveBeenCalled();

    // Valida que criou o compromisso no Google Calendar
    expect(createAppointment).toHaveBeenCalledWith('João da Silva', '5548999991234', '2026-06-22T13:30:00-03:00', 15);

    // Valida que inseriu o appointment na tabela appointments local
    expect(dbMock.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO appointments'),
      expect.arrayContaining([
        'evt_auto_123',
        '5548999991234',
        'João da Silva',
        '2026-06-22T13:30:00-03:00'
      ])
    );
  });

  it('Modo SEMI: Deve registrar solicitação pendente no SQLite e não criar agendamento direto no Calendar', async () => {
    config.BOOKING_MODE = 'semi';

    const response = await routeTriageMessage(session, 'Particular');

    expect(session.state).toBe('DONE');
    expect(getFreeSlotsForPatient).toHaveBeenCalled();

    // Não deve chamar o Calendar diretamente
    expect(createAppointment).not.toHaveBeenCalled();

    // Deve salvar a solicitação na tabela booking_requests
    expect(dbMock.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO booking_requests'),
      expect.arrayContaining([
        '5548999991234',
        'João da Silva',
        30,
        'Particular',
        '2026-06-22T13:30:00-03:00',
        'pending'
      ])
    );
  });

  it('Modo OFF (Manual): Não deve buscar vagas livres nem interagir com Calendar ou booking_requests', async () => {
    config.BOOKING_MODE = 'off';

    const response = await routeTriageMessage(session, 'Particular');

    expect(session.state).toBe('DONE');
    expect(getFreeSlotsForPatient).not.toHaveBeenCalled();
    expect(createAppointment).not.toHaveBeenCalled();
    expect(dbMock.run).not.toHaveBeenCalled();
  });
});
