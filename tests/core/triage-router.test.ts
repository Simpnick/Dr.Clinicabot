import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeTriageMessage } from '../../src/core/triage/triage-router';
import { TriageSession } from '../../src/core/triage/triage-flow';
import { generateLLMResponse } from '../../src/services/llm/llm-service';

// Mock da configuração de triagem — responde com campos padrão
vi.mock('../../src/core/triage/triage-flow', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    loadTriageConfig: vi.fn(() => ({
      welcomeMessage: 'Olá! Seja bem-vindo à Clínica Médica do Dr. Carlos Tonelli. Como posso ajudar você hoje?',
      faqs: 'O Dr. Carlos André Tonelli NÃO realiza avaliação de exames pelo WhatsApp. Atestados médicos somente durante consulta.',
      clinicName: 'Clínica Médica do Dr. Carlos Tonelli',
      doctorName: 'Dr. Carlos Tonelli',
      fields: [
        {
          key: 'name',
          label: 'Nome Completo',
          type: 'string',
          questionPrompt: 'Poderia, por gentileza, fornecer o seu nome completo?',
          validationInstruction: 'Deve ser um nome completo com pelo menos nome e sobrenome.',
          order: 1,
          required: true
        },
        {
          key: 'age',
          label: 'Idade',
          type: 'number',
          questionPrompt: 'Poderia informar a sua idade?',
          validationInstruction: 'Deve ser um número inteiro positivo.',
          order: 2,
          required: true
        },
        {
          key: 'healthPlan',
          label: 'Convênio',
          type: 'choice',
          choices: ['Unimed', 'Saúde São José', 'CISAMREC', 'Particular'],
          questionPrompt: 'Qual é o seu plano ou convênio de saúde?',
          validationInstruction: 'Deve ser Unimed, Saúde São José, CISAMREC ou Particular.',
          order: 3,
          required: true
        }
      ]
    }))
  };
});

// Mock do serviço de LLM — diferencia extrator de diálogo
vi.mock('../../src/services/llm/llm-service', () => {
  return {
    generateLLMResponse: vi.fn(async (history: any[], systemInstruction: string) => {
      const lastMessage = history[history.length - 1]?.content || '';
      const isValidator = systemInstruction.includes('Agente de Validação');

      if (isValidator) {
        // Respostas do Agente Validador (JSON)
        if (lastMessage.includes('exame') || lastMessage.includes('glicose')) {
          return '{"isValid": false, "extractedValue": null, "errorMessage": "", "isFAQ": true, "isCorrection": false, "correctedFieldKey": "", "correctedFieldValue": null}';
        }
        if (lastMessage.includes('atestado') || lastMessage.includes('laudo')) {
          return '{"isValid": false, "extractedValue": null, "errorMessage": "", "isFAQ": true, "isCorrection": false, "correctedFieldKey": "", "correctedFieldValue": null}';
        }
        if (lastMessage.includes('não entendi')) {
          return '{"isValid": false, "extractedValue": null, "errorMessage": "", "isFAQ": false, "isCorrection": false, "correctedFieldKey": "", "correctedFieldValue": null}';
        }
        if (lastMessage.includes('agendar') || lastMessage.includes('marca') || lastMessage.includes('marcar')) {
          return '{"isValid": false, "extractedValue": null, "errorMessage": "", "isFAQ": false, "isCorrection": false, "correctedFieldKey": "", "correctedFieldValue": null}';
        }
        if (lastMessage.includes('João da Silva')) {
          return '{"isValid": true, "extractedValue": "João da Silva", "errorMessage": "", "isFAQ": false, "isCorrection": false, "correctedFieldKey": "", "correctedFieldValue": null}';
        }
        return '{"isValid": false, "extractedValue": null, "errorMessage": "Resposta não reconhecida.", "isFAQ": false, "isCorrection": false, "correctedFieldKey": "", "correctedFieldValue": null}';
      } else {
        // Respostas do Agente de Diálogo (texto)
        if (lastMessage.includes('exame') || lastMessage.includes('glicose')) {
          return 'O Dr. Carlos André Tonelli não realiza avaliação de exames pelo WhatsApp. Essas situações necessitam de consulta médica previamente agendada. Poderia, por gentileza, fornecer o seu nome completo?';
        }
        if (lastMessage.includes('atestado') || lastMessage.includes('laudo')) {
          return 'Atestados médicos, declarações de doenças e laudos somente podem ser emitidos durante consulta médica previamente agendada. Poderia, por gentileza, fornecer o seu nome completo?';
        }
        if (lastMessage.includes('não entendi')) {
          return 'Peço desculpas pela falta de clareza. Poderia, por gentileza, fornecer o seu nome completo?';
        }
        if (lastMessage.includes('agendar') || lastMessage.includes('marca') || lastMessage.includes('marcar')) {
          return 'Com prazer. Poderia, por gentileza, fornecer o seu nome completo?';
        }
        if (lastMessage.includes('João da Silva')) {
          return 'Obrigado, João. Poderia informar a sua idade?';
        }
        return 'Resposta educativa geral. Como posso ajudar?';
      }
    })
  };
});

// Mock do serviço de WhatsApp
vi.mock('../../src/services/whatsapp/client', () => {
  return {
    sendWhatsAppMessage: vi.fn(async () => ({ messageId: 'msg_mock_123' })),
    normalizeBrazilianPhone: vi.fn((phone: string) => phone.replace(/\D/g, ''))
  };
});

describe('Roteador de Triagem Dual-Agent (Modular)', () => {
  let session: TriageSession;

  beforeEach(() => {
    session = new TriageSession('5548988888888');
  });

  it('Deve responder com mensagem de boas-vindas para saudação inicial sem avançar triagem', async () => {
    expect(session.state).toBe('START');
    const response = await routeTriageMessage(session, 'Oi bom dia');
    expect(session.state).toBe('START');
    expect(response).toContain('bem-vindo');
  });

  it('Deve responder com mensagem de boas-vindas para saudação inicial "Olá, boa tarde!" sem avançar triagem', async () => {
    expect(session.state).toBe('START');
    const response = await routeTriageMessage(session, 'Olá, boa tarde!');
    expect(session.state).toBe('START');
    expect(response).toContain('bem-vindo');
  });

  it('Deve responder com mensagem de boas-vindas para saudação inicial "Bom dia" sem avançar triagem', async () => {
    expect(session.state).toBe('START');
    const response = await routeTriageMessage(session, 'Bom dia');
    expect(session.state).toBe('START');
    expect(response).toContain('bem-vindo');
  });

  it('Deve avançar para coleta do primeiro campo quando paciente indica desejo de agendar', async () => {
    expect(session.state).toBe('START');
    const response = await routeTriageMessage(session, 'Quero agendar uma consulta');
    expect(session.state).toMatch(/^AWAITING_FIELD:/);
    expect(response).toContain('nome completo');
  });

  it('Deve responder FAQ de exame sem avançar o estado da triagem', async () => {
    session.state = 'AWAITING_FIELD:name';
    const stateBefore = session.state;
    const response = await routeTriageMessage(session, 'Dr, veja se meu exame de glicose está normal.');
    expect(session.state).toBe(stateBefore);
    expect(response).toContain('não realiza avaliação de exames pelo WhatsApp');
  });

  it('Deve responder FAQ de atestado sem alterar o estado da triagem', async () => {
    session.state = 'AWAITING_FIELD:name';
    const stateBefore = session.state;
    const response = await routeTriageMessage(session, 'Você me manda um atestado de comparecimento por aqui?');
    expect(session.state).toBe(stateBefore);
    expect(response).toContain('somente podem ser emitidos durante consulta');
  });

  it('Deve manter o estado travado se o paciente disser "não entendi"', async () => {
    session.state = 'AWAITING_FIELD:name';
    session.data = { healthPlan: 'Particular', cardNumber: 'Não aplicável', complaint: 'Dor nas costas', medication: 'Não necessita' };
    const response = await routeTriageMessage(session, 'não entendi');
    expect(session.state).toBe('AWAITING_FIELD:name');
    expect(session.data.healthPlan).toBe('Particular');
  });

  it('Deve preencher o campo name e avançar ao receber nome completo válido', async () => {
    session.state = 'AWAITING_FIELD:name';
    await routeTriageMessage(session, 'João da Silva');
    expect(session.data.name).toBe('João da Silva');
    expect(session.state).toMatch(/^AWAITING_FIELD:age|DONE/);
  });

  it('Deve reverter o estado e retornar mensagem de indisponibilidade se o LLM falhar (Fail-Closed)', async () => {
    const mockGenerate = vi.mocked(generateLLMResponse);
    mockGenerate.mockRejectedValue(new Error('LM Studio is offline'));

    session.state = 'AWAITING_FIELD:name';
    session.data = { someField: 'someValue' };

    const response = await routeTriageMessage(session, 'João da Silva');

    expect(session.state).toBe('AWAITING_FIELD:name');
    expect(session.data).toEqual({ someField: 'someValue' });
    expect(response).toContain('Desculpe o inconveniente');
  });
});
