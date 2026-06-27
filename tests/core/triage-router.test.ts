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
          key: 'isExistingPatient',
          label: 'Já é Paciente da Clínica',
          type: 'boolean',
          questionPrompt: 'Você já é paciente da clínica?',
          validationInstruction: 'Se o paciente responder que já é paciente, registre como true.',
          order: 2,
          required: true
        },
        {
          key: 'age',
          label: 'Idade',
          type: 'number',
          questionPrompt: 'Poderia informar a sua idade?',
          validationInstruction: 'Deve ser um número inteiro positivo.',
          order: 3,
          required: true
        },
        {
          key: 'healthPlan',
          label: 'Convênio',
          type: 'choice',
          choices: ['Unimed', 'Saúde São José', 'CISAMREC', 'Particular'],
          questionPrompt: 'Qual é o seu plano ou convênio de saúde?',
          validationInstruction: 'Deve ser Unimed, Saúde São José, CISAMREC ou Particular.',
          order: 4,
          required: true
        },
        {
          key: 'medication',
          label: 'Necessidade de Receita de Medicamento Controlado',
          type: 'text',
          questionPrompt: 'Qual o medicamento e dosagem?',
          validationInstruction: 'O paciente deve indicar o medicamento desejado.',
          order: 5,
          required: true
        }
      ]
    }))
  };
});

// Comportamento padrão do mock de LLM
const defaultMockImplementation = async (history: any[], systemInstruction: string) => {
  const lastMessage = history[history.length - 1]?.content || '';
  const isValidator = systemInstruction.includes('Agente de Validação');
  const isClassifier = systemInstruction.includes('Classificador de Intenção');

  if (isClassifier) {
    if (lastMessage.includes('receita') || lastMessage.includes('Wegovy') || lastMessage.includes('Mounjaro')) {
      return 'receita';
    }
    if (lastMessage.includes('atestado') || lastMessage.includes('laudo')) {
      return 'laudo_atestado';
    }
    if (lastMessage.includes('endereço') || lastMessage.includes('atende') || lastMessage.includes('valor')) {
      return 'faq';
    }
    if (lastMessage.includes('oi') || lastMessage.includes('olá') || lastMessage.includes('bom dia')) {
      return 'saudacao';
    }
    return 'consulta';
  }

  if (isValidator) {
    // Respostas do Agente Validador (JSON)
    if (systemInstruction.includes('Chave: "isExistingPatient"') && (lastMessage.includes('já sou') || lastMessage.includes('paciente antigo') || lastMessage.includes('Sim') || lastMessage.includes('sim'))) {
      return '{"isValid": true, "extractedValue": true, "errorMessage": "", "isFAQ": false, "isCorrection": false, "correctedFieldKey": "", "correctedFieldValue": null}';
    }
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
    if (lastMessage.includes('Wegovy 2.4')) {
      return '{"isValid": true, "extractedValue": "Wegovy 2.4mg", "errorMessage": "", "isFAQ": false, "isCorrection": false, "correctedFieldKey": "", "correctedFieldValue": null}';
    }
    return '{"isValid": false, "extractedValue": null, "errorMessage": "Resposta não reconhecida.", "isFAQ": false, "isCorrection": false, "correctedFieldKey": "", "correctedFieldValue": null}';
  } else {
    // Respostas do Agente de Diálogo (texto)
    if ((systemInstruction.includes('isExistingPatient') || systemInstruction.includes('healthPlan')) && (lastMessage.includes('já sou') || lastMessage.includes('paciente antigo') || lastMessage.includes('Sim') || lastMessage.includes('sim'))) {
      return 'Entendido. Como você já é paciente, qual é o seu convênio de saúde?';
    }
    if (lastMessage.includes('receita') || lastMessage.includes('Wegovy') || lastMessage.includes('Mounjaro')) {
      if (lastMessage.includes('Wegovy 2.4')) {
        return 'Solicitação de receita de Wegovy 2.4mg registrada com sucesso.';
      }
      return 'Para prosseguir com sua solicitação de receita, por gentileza, informe seu nome completo.';
    }
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
};

vi.mock('../../src/services/llm/llm-service', () => {
  return {
    generateLLMResponse: vi.fn((history: any[], systemInstruction: string) => defaultMockImplementation(history, systemInstruction))
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
    vi.mocked(generateLLMResponse).mockImplementation(defaultMockImplementation);
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
    expect(session.state).toMatch(/^AWAITING_FIELD:(age|isExistingPatient)|DONE/);
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

  it('Deve redirecionar para fluxo de receita se paciente inicia pedindo receita, auto-preenchendo outros campos', async () => {
    expect(session.state).toBe('START');
    const response = await routeTriageMessage(session, 'Gostaria de uma receita do Wegovy');
    
    // O fluxo de receita deve estar ativo
    expect(session.data.flow).toBe('prescription');
    // Deve ir para coleta de nome
    expect(session.state).toBe('AWAITING_FIELD:name');
    expect(response).toContain('nome completo');
    
    // Simula envio do nome
    await routeTriageMessage(session, 'João da Silva');
    expect(session.data.name).toBe('João da Silva');
    // Como estamos no fluxo de receita, pula os campos isExistingPatient, age, healthPlan, etc.
    // O próximo campo unfilled deve ser medication
    expect(session.state).toBe('AWAITING_FIELD:medication');
    
    // Simula envio do medicamento
    await routeTriageMessage(session, 'Preciso de Wegovy 2.4');
    expect(session.data.medication).toBe('Wegovy 2.4mg');
    // Todos os outros campos foram auto-preenchidos, então deve estar DONE!
    expect(session.state).toBe('DONE');
  });

  it('Deve oferecer agendamento e ir para AWAITING_LAUDO_CONFIRM se paciente pede atestado ou laudo no START', async () => {
    expect(session.state).toBe('START');
    const response = await routeTriageMessage(session, 'Preciso de um laudo médico');
    
    expect(session.state).toBe('AWAITING_LAUDO_CONFIRM');
    expect(session.data.flow).toBe('document');
    expect(response).toContain('atestados médicos, laudos e preenchimento de documentos só podem ser emitidos');
    expect(response).toContain('Gostaria de agendar uma consulta');

    // Se responder "sim", deve resetar e ir para o fluxo de booking normal iniciando com o nome
    const confirmResponse = await routeTriageMessage(session, 'Sim, quero agendar');
    expect(session.data.flow).toBe('booking');
    expect(session.state).toBe('AWAITING_FIELD:name');
    expect(confirmResponse).toContain('nome completo');
  });

  it('Deve pular idade e carteirinha se o paciente responder que ja e paciente antigo', async () => {
    // Simulamos que o paciente ja informou o nome e o estado e AWAITING_FIELD:isExistingPatient
    session.state = 'AWAITING_FIELD:isExistingPatient';
    session.data = { name: 'João da Silva' };

    // Executa a transicao
    const response = await routeTriageMessage(session, 'Sim, ja sou paciente');
    
    // Verificações
    // Deve auto-preencher age = 30
    expect(session.data.age).toBe(30);
    // E pular diretamente para healthPlan
    expect(session.state).toBe('AWAITING_FIELD:healthPlan');
    expect(response).toContain('qual é o seu convênio de saúde');
  });
});
