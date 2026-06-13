import { describe, it, expect, vi } from 'vitest';
import {
  TriageSession,
  getFirstName,
  getNextUnfilledField,
  updateDynamicSessionState,
  buildTriageSummary,
  TriageConfig
} from '../../src/core/triage/triage-flow';

// Mock do serviço de envio de WhatsApp
vi.mock('../../src/services/whatsapp/client', () => {
  return {
    sendWhatsAppMessage: vi.fn(async () => ({ messageId: 'msg_123' }))
  };
});

vi.mock('../../src/config/env-manager', () => {
  return {
    config: {
      BOOKING_MODE: 'manual',
      DOCTOR_PHONE: '5548999999999'
    }
  };
});

// Configuração de triagem padrão para os testes
const mockConfig: TriageConfig = {
  welcomeMessage: 'Olá!',
  faqs: '',
  clinicName: 'Clínica Teste',
  doctorName: 'Dr. Teste',
  fields: [
    {
      key: 'name',
      label: 'Nome Completo',
      type: 'string',
      questionPrompt: 'Qual o seu nome?',
      validationInstruction: 'Nome e sobrenome.',
      order: 1,
      required: true
    },
    {
      key: 'age',
      label: 'Idade',
      type: 'number',
      questionPrompt: 'Qual a sua idade?',
      validationInstruction: 'Número inteiro.',
      order: 2,
      required: true
    },
    {
      key: 'healthPlan',
      label: 'Convênio',
      type: 'choice',
      choices: ['Unimed', 'Particular'],
      questionPrompt: 'Qual o seu convênio?',
      validationInstruction: 'Unimed ou Particular.',
      order: 3,
      required: true
    },
    {
      key: 'cardNumber',
      label: 'Carteirinha',
      type: 'string',
      questionPrompt: 'Qual o número da carteirinha?',
      validationInstruction: 'Número ou código.',
      order: 4,
      required: true,
      skipCondition: {
        field: 'healthPlan',
        value: 'Particular',
        autoFill: 'Não aplicável (Particular)'
      }
    }
  ]
};

describe('Modelo de Sessão e Helpers de Triagem Dinâmica', () => {
  it('Deve inicializar sessão com estado START e data vazio', () => {
    const session = new TriageSession('5548988888888');
    expect(session.state).toBe('START');
    expect(session.data).toEqual({});
  });

  it('getFirstName deve retornar o primeiro nome corretamente', () => {
    expect(getFirstName('João da Silva')).toBe('João');
    expect(getFirstName('Maria')).toBe('Maria');
    expect(getFirstName('')).toBe('Paciente');
  });

  it('getNextUnfilledField deve retornar o primeiro campo pendente (name)', () => {
    const session = new TriageSession('5548988888888');
    const nextField = getNextUnfilledField(session, mockConfig);
    expect(nextField?.key).toBe('name');
  });

  it('Deve pular para o segundo campo quando o primeiro está preenchido', () => {
    const session = new TriageSession('5548988888888');
    session.data = { name: 'João da Silva' };
    const nextField = getNextUnfilledField(session, mockConfig);
    expect(nextField?.key).toBe('age');
  });

  it('Deve auto-preencher cardNumber e pulá-lo quando healthPlan = Particular', () => {
    const session = new TriageSession('5548988888888');
    session.data = { name: 'João', age: 30, healthPlan: 'Particular' };
    const nextField = getNextUnfilledField(session, mockConfig);
    // Deve ter auto-preenchido cardNumber e retornado null (todos preenchidos)
    expect(session.data.cardNumber).toBe('Não aplicável (Particular)');
    expect(nextField).toBeNull();
  });

  it('Deve retornar null quando todos os campos estão preenchidos', () => {
    const session = new TriageSession('5548988888888');
    session.data = { name: 'João', age: 30, healthPlan: 'Unimed', cardNumber: '123456' };
    const nextField = getNextUnfilledField(session, mockConfig);
    expect(nextField).toBeNull();
  });

  it('updateDynamicSessionState deve definir o estado corretamente baseado nos campos preenchidos', () => {
    const session = new TriageSession('5548988888888');
    updateDynamicSessionState(session, mockConfig);
    expect(session.state).toBe('AWAITING_FIELD:name');

    session.data = { name: 'João' };
    updateDynamicSessionState(session, mockConfig);
    expect(session.state).toBe('AWAITING_FIELD:age');
  });

  it('updateDynamicSessionState deve definir DONE quando todos os campos estão preenchidos', () => {
    const session = new TriageSession('5548988888888');
    session.data = { name: 'João', age: 30, healthPlan: 'Unimed', cardNumber: '123456' };
    updateDynamicSessionState(session, mockConfig);
    expect(session.state).toBe('DONE');
  });

  it('buildTriageSummary deve gerar um resumo com todos os campos coletados', () => {
    const session = new TriageSession('5548988888888');
    session.data = { name: 'João da Silva', age: 30, healthPlan: 'Unimed', cardNumber: '123456' };
    const summary = buildTriageSummary(session, mockConfig);
    expect(summary).toContain('João da Silva');
    expect(summary).toContain('30');
    expect(summary).toContain('Unimed');
  });
});
