import { routeTriageMessage } from './src/core/triage/triage-router';
import { TriageSession } from './src/core/triage/triage-flow';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Garante o carregamento do .env do projeto
import { config } from './src/config/env-manager';

interface TestCase {
  id: string;
  group: string;
  input: string;
  expected: string;
  preSetup?: (session: TriageSession) => void;
  assert: (response: string, session: TriageSession) => { pass: boolean; note: string };
}

const testCases: TestCase[] = [
  // ────────────────────────────────────────────────────────────
  // GRUPO A — Saudação e Início de Conversa
  // ────────────────────────────────────────────────────────────
  {
    id: 'A1',
    group: 'A',
    input: 'Oi',
    expected: 'Boas-vindas. Não pede nome. Pergunta como ajudar.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('como posso') || res.toLowerCase().includes('ajudar'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'A2',
    group: 'A',
    input: 'Bom dia',
    expected: 'Boas-vindas. Não pede nome. Pergunta como ajudar.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('como posso') || res.toLowerCase().includes('ajudar'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'A3',
    group: 'A',
    input: 'Olá, boa tarde!',
    expected: 'Boas-vindas. Não pede nome. Pergunta como ajudar.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('como posso') || res.toLowerCase().includes('ajudar'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'A4',
    group: 'A',
    input: 'Quero marcar uma consulta',
    expected: 'Inicia triagem. Pede nome completo.',
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:name';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'A5',
    group: 'A',
    input: 'Gostaria de agendar',
    expected: 'Inicia triagem. Pede nome completo.',
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:name';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'A6',
    group: 'A',
    input: 'Preciso de atendimento',
    expected: 'Inicia triagem. Pede nome completo.',
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:name';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'A7',
    group: 'A',
    input: 'Tô precisando de uma consulta com o Dr.',
    expected: 'Inicia triagem. Pede nome completo.',
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:name';
      return { pass, note: `State: ${session.state}` };
    }
  },

  // ────────────────────────────────────────────────────────────
  // GRUPO B — Coleta de Nome (Campo 1)
  // ────────────────────────────────────────────────────────────
  {
    id: 'B1',
    group: 'B',
    input: 'João Silva',
    expected: 'Aceita. Pergunta se já é paciente.',
    preSetup: (session) => { session.state = 'AWAITING_FIELD:name'; },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:isExistingPatient' && session.data.name === 'João Silva';
      return { pass, note: `State: ${session.state}, Name: ${session.data.name}` };
    }
  },
  {
    id: 'B2',
    group: 'B',
    input: 'Me chamo Maria Aparecida de Souza',
    expected: 'Extrai o nome completo e avança.',
    preSetup: (session) => { session.state = 'AWAITING_FIELD:name'; },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:isExistingPatient' && session.data.name === 'Maria Aparecida de Souza';
      return { pass, note: `State: ${session.state}, Name: ${session.data.name}` };
    }
  },
  {
    id: 'B3',
    group: 'B',
    input: 'João',
    expected: 'Rejeita. Pede nome completo (nome + sobrenome).',
    preSetup: (session) => { session.state = 'AWAITING_FIELD:name'; },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:name';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'B4',
    group: 'B',
    input: 'Só o João mesmo',
    expected: 'Rejeita. Pede nome completo.',
    preSetup: (session) => { session.state = 'AWAITING_FIELD:name'; },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:name';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'B5',
    group: 'B',
    input: '12345',
    expected: 'Rejeita. Informa que o nome deve conter letras.',
    preSetup: (session) => { session.state = 'AWAITING_FIELD:name'; },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:name';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'B6',
    group: 'B',
    input: 'meu nome é Pedro Alves',
    expected: 'Extrai "Pedro Alves" e avança.',
    preSetup: (session) => { session.state = 'AWAITING_FIELD:name'; },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:isExistingPatient' && session.data.name === 'Pedro Alves';
      return { pass, note: `State: ${session.state}, Name: ${session.data.name}` };
    }
  },

  // ────────────────────────────────────────────────────────────
  // GRUPO C — Já é Paciente? (Campo 2)
  // ────────────────────────────────────────────────────────────
  {
    id: 'C1',
    group: 'C',
    input: 'Sim, já fui lá antes',
    expected: 'Registra retornante (true). Avança para idade.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:isExistingPatient';
      session.data.name = 'Maria Souza';
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:age' && session.data.isExistingPatient === true;
      return { pass, note: `State: ${session.state}, Patient: ${session.data.isExistingPatient}` };
    }
  },
  {
    id: 'C2',
    group: 'C',
    input: 'Não, nunca fui',
    expected: 'Registra novo (false). Pergunta somente idade.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:isExistingPatient';
      session.data.name = 'Maria Souza';
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:age' && session.data.isExistingPatient === false;
      return { pass, note: `State: ${session.state}, Patient: ${session.data.isExistingPatient}` };
    }
  },
  {
    id: 'C3',
    group: 'C',
    input: 'Primeira vez',
    expected: 'Registra novo (false). Avança.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:isExistingPatient';
      session.data.name = 'Maria Souza';
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:age' && session.data.isExistingPatient === false;
      return { pass, note: `State: ${session.state}, Patient: ${session.data.isExistingPatient}` };
    }
  },
  {
    id: 'C4',
    group: 'C',
    input: 'Já sou paciente do Dr. Carlos',
    expected: 'Registra retornante (true). Avança.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:isExistingPatient';
      session.data.name = 'Maria Souza';
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:age' && session.data.isExistingPatient === true;
      return { pass, note: `State: ${session.state}, Patient: ${session.data.isExistingPatient}` };
    }
  },
  {
    id: 'C5',
    group: 'C',
    input: 'Não sei, acho que sim',
    expected: 'Registra retornante (true). Avança.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:isExistingPatient';
      session.data.name = 'Maria Souza';
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:age' && session.data.isExistingPatient === true;
      return { pass, note: `State: ${session.state}, Patient: ${session.data.isExistingPatient}` };
    }
  },

  // ────────────────────────────────────────────────────────────
  // GRUPO D — Coleta de Idade (Campo 3)
  // ────────────────────────────────────────────────────────────
  {
    id: 'D1',
    group: 'D',
    input: '28',
    expected: 'Aceita. Pergunta convênio.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:age';
      session.data = { name: 'Maria Souza', isExistingPatient: true };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan' && session.data.age === 28;
      return { pass, note: `State: ${session.state}, Age: ${session.data.age}` };
    }
  },
  {
    id: 'D2',
    group: 'D',
    input: 'Tenho 35 anos',
    expected: 'Extrai 35. Avança.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:age';
      session.data = { name: 'Maria Souza', isExistingPatient: true };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan' && session.data.age === 35;
      return { pass, note: `State: ${session.state}, Age: ${session.data.age}` };
    }
  },
  {
    id: 'D3',
    group: 'D',
    input: 'Minha filha tem 8 anos',
    expected: 'Extrai 8. Avança.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:age';
      session.data = { name: 'Maria Souza', isExistingPatient: true };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan' && session.data.age === 8;
      return { pass, note: `State: ${session.state}, Age: ${session.data.age}` };
    }
  },
  {
    id: 'D4',
    group: 'D',
    input: 'abc',
    expected: 'Rejeita. Pede número válido.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:age';
      session.data = { name: 'Maria Souza', isExistingPatient: true };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:age';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'D5',
    group: 'D',
    input: '200',
    expected: 'Rejeita. Idade fora do range.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:age';
      session.data = { name: 'Maria Souza', isExistingPatient: true };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:age';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'D6',
    group: 'D',
    input: '-5',
    expected: 'Rejeita. Idade positiva.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:age';
      session.data = { name: 'Maria Souza', isExistingPatient: true };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:age';
      return { pass, note: `State: ${session.state}` };
    }
  },

  // ────────────────────────────────────────────────────────────
  // GRUPO E — Convênio (Campo 4)
  // ────────────────────────────────────────────────────────────
  {
    id: 'E1',
    group: 'E',
    input: 'Unimed',
    expected: 'Aceita. Pergunta carteirinha.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:cardNumber' && session.data.healthPlan === 'Unimed';
      return { pass, note: `State: ${session.state}, Plan: ${session.data.healthPlan}` };
    }
  },
  {
    id: 'E2',
    group: 'E',
    input: 'Saúde São José',
    expected: 'Aceita. Pergunta carteirinha.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:cardNumber' && session.data.healthPlan === 'Saúde São José';
      return { pass, note: `State: ${session.state}, Plan: ${session.data.healthPlan}` };
    }
  },
  {
    id: 'E3',
    group: 'E',
    input: 'CISAMREC',
    expected: 'Aceita. Pergunta carteirinha.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:cardNumber' && session.data.healthPlan === 'CISAMREC';
      return { pass, note: `State: ${session.state}, Plan: ${session.data.healthPlan}` };
    }
  },
  {
    id: 'E4',
    group: 'E',
    input: 'Particular',
    expected: 'Aceita. Pula carteirinha para queixa.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:complaint' && session.data.healthPlan === 'Particular';
      return { pass, note: `State: ${session.state}, Plan: ${session.data.healthPlan}` };
    }
  },
  {
    id: 'E5',
    group: 'E',
    input: 'Tenho Unimed',
    expected: 'Aceita Unimed.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:cardNumber' && session.data.healthPlan === 'Unimed';
      return { pass, note: `State: ${session.state}, Plan: ${session.data.healthPlan}` };
    }
  },
  {
    id: 'E6',
    group: 'E',
    input: 'SUS',
    expected: 'Rejeita e lista planos aceitos.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'E7',
    group: 'E',
    input: 'Ipasesc',
    expected: 'Rejeita.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'E8',
    group: 'E',
    input: 'Bradesco Saúde',
    expected: 'Rejeita.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'E9',
    group: 'E',
    input: 'Não tenho convênio',
    expected: 'Aceita como Particular. Pula carteirinha.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:complaint' && session.data.healthPlan === 'Particular';
      return { pass, note: `State: ${session.state}, Plan: ${session.data.healthPlan}` };
    }
  },

  // ────────────────────────────────────────────────────────────
  // GRUPO F — Carteirinha (Campo 5)
  // ────────────────────────────────────────────────────────────
  {
    id: 'F1',
    group: 'F',
    input: '123456789',
    expected: 'Aceita. Pergunta a queixa.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:cardNumber';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Unimed' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:complaint' && session.data.cardNumber === '123456789';
      return { pass, note: `State: ${session.state}, Card: ${session.data.cardNumber}` };
    }
  },
  {
    id: 'F2',
    group: 'F',
    input: 'Não sei o número',
    expected: 'Aceita como Não informado.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:cardNumber';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Unimed' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:complaint' && session.data.cardNumber === 'Não informado';
      return { pass, note: `State: ${session.state}, Card: ${session.data.cardNumber}` };
    }
  },
  {
    id: 'F3',
    group: 'F',
    input: 'Não tenho a carteirinha aqui',
    expected: 'Aceita como Não informado.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:cardNumber';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Unimed' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:complaint' && session.data.cardNumber === 'Não informado';
      return { pass, note: `State: ${session.state}, Card: ${session.data.cardNumber}` };
    }
  },

  // ────────────────────────────────────────────────────────────
  // GRUPO G — Queixa / Motivo da Consulta (Campo 6)
  // ────────────────────────────────────────────────────────────
  {
    id: 'G1',
    group: 'G',
    input: 'Dor no joelho',
    expected: 'Aceita. Pergunta receita.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:complaint';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:medication' && !!session.data.complaint;
      return { pass, note: `State: ${session.state}, Complaint: ${session.data.complaint}` };
    }
  },
  {
    id: 'G2',
    group: 'G',
    input: 'Hipotireoidismo',
    expected: 'Aceita. Avança.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:complaint';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:medication';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'G3',
    group: 'G',
    input: 'Check-up geral',
    expected: 'Aceita. Avança.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:complaint';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:medication';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'G4',
    group: 'G',
    input: 'Minha filha tem puberdade precoce',
    expected: 'Aceita. Avança.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:complaint';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:medication';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'G5',
    group: 'G',
    input: 'Sim',
    expected: 'Rejeita (muito curta).',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:complaint';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:complaint';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'G6',
    group: 'G',
    input: 'Não sei',
    expected: 'Rejeita.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:complaint';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:complaint';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'G7',
    group: 'G',
    input: 'Baixa estatura, diabetes e check-up hormonal',
    expected: 'Aceita múltiplas queixas.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:complaint';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:medication';
      return { pass, note: `State: ${session.state}` };
    }
  },

  // ────────────────────────────────────────────────────────────
  // GRUPO H — Receita Controlada (Campo 7)
  // ────────────────────────────────────────────────────────────
  {
    id: 'H1',
    group: 'H',
    input: 'Não',
    expected: 'Registra Não necessita e avança.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:medication';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular', complaint: 'Dor no joelho' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:agreedToTerms' && session.data.medication === 'Não necessita';
      return { pass, note: `State: ${session.state}, Med: ${session.data.medication}` };
    }
  },
  {
    id: 'H2',
    group: 'H',
    input: 'Não preciso',
    expected: 'Registra Não necessita.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:medication';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular', complaint: 'Dor no joelho' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:agreedToTerms' && session.data.medication === 'Não necessita';
      return { pass, note: `State: ${session.state}, Med: ${session.data.medication}` };
    }
  },
  {
    id: 'H3',
    group: 'H',
    input: 'Sim, Ritalina 10mg',
    expected: 'Aceita medicamento + dosagem.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:medication';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular', complaint: 'Dor no joelho' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:agreedToTerms' && session.data.medication.toLowerCase().includes('ritalina');
      return { pass, note: `State: ${session.state}, Med: ${session.data.medication}` };
    }
  },
  {
    id: 'H4',
    group: 'H',
    input: 'Preciso de rivotril',
    expected: 'Aceita e pede dosagem se não informada.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:medication';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular', complaint: 'Dor no joelho' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:agreedToTerms' || session.state === 'AWAITING_FIELD:medication';
      return { pass, note: `State: ${session.state}, Med: ${session.data.medication}` };
    }
  },
  {
    id: 'H5',
    group: 'H',
    input: 'Sim',
    expected: 'Rejeita (pede nome do remédio).',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:medication';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular', complaint: 'Dor no joelho' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:medication';
      return { pass, note: `State: ${session.state}` };
    }
  },

  // ────────────────────────────────────────────────────────────
  // GRUPO I — Concordância com as Diretrizes (Campo 8)
  // ────────────────────────────────────────────────────────────
  {
    id: 'I1',
    group: 'I',
    input: 'Sim',
    expected: 'Conclui triagem (DONE).',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:agreedToTerms';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular', complaint: 'Dor no joelho', medication: 'Não necessita' };
    },
    assert: (res, session) => {
      const pass = session.state === 'DONE' && session.data.agreedToTerms === true;
      return { pass, note: `State: ${session.state}, Agreed: ${session.data.agreedToTerms}` };
    }
  },
  {
    id: 'I2',
    group: 'I',
    input: 'Concordo',
    expected: 'Conclui triagem (DONE).',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:agreedToTerms';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular', complaint: 'Dor no joelho', medication: 'Não necessita' };
    },
    assert: (res, session) => {
      const pass = session.state === 'DONE' && session.data.agreedToTerms === true;
      return { pass, note: `State: ${session.state}, Agreed: ${session.data.agreedToTerms}` };
    }
  },
  {
    id: 'I3',
    group: 'I',
    input: 'Ok, pode ser',
    expected: 'Conclui triagem.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:agreedToTerms';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular', complaint: 'Dor no joelho', medication: 'Não necessita' };
    },
    assert: (res, session) => {
      const pass = session.state === 'DONE' && session.data.agreedToTerms === true;
      return { pass, note: `State: ${session.state}, Agreed: ${session.data.agreedToTerms}` };
    }
  },
  {
    id: 'I4',
    group: 'I',
    input: 'Não concordo',
    expected: 'Registra false e encerra ou direciona.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:agreedToTerms';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular', complaint: 'Dor no joelho', medication: 'Não necessita' };
    },
    assert: (res, session) => {
      const pass = session.data.agreedToTerms === false;
      return { pass, note: `State: ${session.state}, Agreed: ${session.data.agreedToTerms}` };
    }
  },
  {
    id: 'I5',
    group: 'I',
    input: 'Poderia explicar melhor?',
    expected: 'FAQ: Explica modelo e reapresenta pergunta.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:agreedToTerms';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular', complaint: 'Dor no joelho', medication: 'Não necessita' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:agreedToTerms' && (res.toLowerCase().includes('retorno') || res.toLowerCase().includes('resolutivo'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'I6',
    group: 'I',
    input: 'Como assim exames antes da consulta?',
    expected: 'FAQ: Explica modelo.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:agreedToTerms';
      session.data = { name: 'Maria Souza', isExistingPatient: true, age: 30, healthPlan: 'Particular', complaint: 'Dor no joelho', medication: 'Não necessita' };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:agreedToTerms' && res.toLowerCase().includes('exame');
      return { pass, note: `State: ${session.state}` };
    }
  },

  // ────────────────────────────────────────────────────────────
  // GRUPO J — FAQs Durante a Triagem
  // ────────────────────────────────────────────────────────────
  {
    id: 'J1',
    group: 'J',
    input: 'Vocês atendem pelo SUS?',
    expected: 'FAQ: Informa planos aceitos. Retorna.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan' && (res.toLowerCase().includes('particular') || res.toLowerCase().includes('unimed'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'J2',
    group: 'J',
    input: 'Qual o valor da consulta particular?',
    expected: 'FAQ: R$ 350,00.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan' && res.includes('350');
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'J3',
    group: 'J',
    input: 'Vocês atendem crianças?',
    expected: 'FAQ: Sim, até 16 anos.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan' && (res.toLowerCase().includes('criança') || res.includes('16'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'J4',
    group: 'J',
    input: 'Qual o horário de atendimento?',
    expected: 'FAQ: Segunda a quinta, 13h30 às 19h15.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan' && (res.toLowerCase().includes('quinta') || res.includes('13h30'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'J5',
    group: 'J',
    input: 'O Dr. atende adultos?',
    expected: 'FAQ: Sim.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan' && res.toLowerCase().includes('adulto');
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'J6',
    group: 'J',
    input: 'Atende Bradesco?',
    expected: 'FAQ: Não.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan' && (res.toLowerCase().includes('não') || res.toLowerCase().includes('unimed'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'J7',
    group: 'J',
    input: 'Atende no sábado?',
    expected: 'FAQ: Não.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza', age: 30 };
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:healthPlan' && (res.toLowerCase().includes('segunda') || res.toLowerCase().includes('não'));
      return { pass, note: `State: ${session.state}` };
    }
  },

  // ────────────────────────────────────────────────────────────
  // GRUPO K — Cenários Fora do Agendamento
  // ────────────────────────────────────────────────────────────
  {
    id: 'K1',
    group: 'K',
    input: 'Preciso de um atestado médico',
    expected: 'Apenas em consulta. Explica motivo legal.',
    assert: (res, session) => {
      const pass = session.state === 'START' && res.toLowerCase().includes('atestado');
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'K2',
    group: 'K',
    input: 'Pode me passar um laudo?',
    expected: 'Apenas em consulta.',
    assert: (res, session) => {
      const pass = session.state === 'START' && res.toLowerCase().includes('laudo');
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'K3',
    group: 'K',
    input: 'Preciso de liberação para atividade física',
    expected: 'Apenas em consulta.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('consulta') || res.toLowerCase().includes('liberação'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'K4',
    group: 'K',
    input: 'Quero renovar minha receita de Ritalina',
    expected: 'Informa receita + cobrança.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('cobrança') || res.toLowerCase().includes('receita'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'K5',
    group: 'K',
    input: 'Estou sem meu medicamento controlado, preciso urgente',
    expected: 'Cobrança ou consulta.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('receita') || res.toLowerCase().includes('consulta'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'K6',
    group: 'K',
    input: 'Meu exame de TSH deu alterado, o que significa?',
    expected: 'Não avalia no WhatsApp.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('não realiza') || res.toLowerCase().includes('avaliação') || res.toLowerCase().includes('consulta'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'K7',
    group: 'K',
    input: 'Posso aumentar a dose do meu remédio?',
    expected: 'Não realiza ajuste no WhatsApp.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('não realiza') || res.toLowerCase().includes('medicação') || res.toLowerCase().includes('consulta'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'K8',
    group: 'K',
    input: 'Preciso de orientação sobre minha doença',
    expected: 'Canal apenas administrativo.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('administrativo') || res.toLowerCase().includes('consulta'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'K9',
    group: 'K',
    input: 'Quero antecipar minha consulta, é urgente',
    expected: 'Agenda fechada/lista de espera.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('espera') || res.toLowerCase().includes('particular'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'K10',
    group: 'K',
    input: 'Tem como encaixar hoje?',
    expected: 'Lista de espera.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('espera') || res.toLowerCase().includes('encaixe') || res.toLowerCase().includes('particular'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'K11',
    group: 'K',
    input: 'Preciso de exames para trazer na minha próxima consulta',
    expected: 'Pede nome, convênio, etc.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('nome') || res.toLowerCase().includes('convênio') || res.toLowerCase().includes('carteirinha'));
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'K12',
    group: 'K',
    input: 'Quais exames devo trazer?',
    expected: 'Explica protocolo novos pacientes.',
    assert: (res, session) => {
      const pass = session.state === 'START' && (res.toLowerCase().includes('novos') || res.toLowerCase().includes('exames'));
      return { pass, note: `State: ${session.state}` };
    }
  },

  // ────────────────────────────────────────────────────────────
  // GRUPO L — Correções e Casos Especiais
  // ────────────────────────────────────────────────────────────
  {
    id: 'L1',
    group: 'L',
    input: 'Na verdade meu nome é Maria Souza',
    expected: 'Corrige nome registrado.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:isExistingPatient';
      session.data = { name: 'João' };
    },
    assert: (res, session) => {
      const pass = session.data.name === 'Maria Souza' && session.state === 'AWAITING_FIELD:isExistingPatient';
      return { pass, note: `State: ${session.state}, Name: ${session.data.name}` };
    }
  },
  {
    id: 'L2',
    group: 'L',
    input: 'Na verdade é Saúde São José',
    expected: 'Corrige convênio.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:cardNumber';
      session.data = { name: 'Maria Souza', age: 30, healthPlan: 'Unimed' };
    },
    assert: (res, session) => {
      const pass = session.data.healthPlan === 'Saúde São José' && session.state === 'AWAITING_FIELD:cardNumber';
      return { pass, note: `State: ${session.state}, Plan: ${session.data.healthPlan}` };
    }
  },
  {
    id: 'L3',
    group: 'L',
    input: 'reiniciar',
    expected: 'Reinicia do zero.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:healthPlan';
      session.data = { name: 'Maria Souza' };
    },
    assert: (res, session) => {
      const pass = session.state === 'START' && Object.keys(session.data).length === 0;
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'L4',
    group: 'L',
    input: 'Oi',
    expected: 'Responde sem reabrir triagem.',
    preSetup: (session) => {
      session.state = 'DONE';
      session.data = { name: 'Maria Souza', age: 30, healthPlan: 'Particular', complaint: 'Dor no joelho', medication: 'Não necessita', agreedToTerms: true };
    },
    assert: (res, session) => {
      const pass = session.state === 'DONE' && !res.toLowerCase().includes('nome completo') && !res.toLowerCase().includes('carteirinha');
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'L5',
    group: 'L',
    input: 'aaaaaaa',
    expected: 'Mantém o estado.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:name';
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:name';
      return { pass, note: `State: ${session.state}` };
    }
  },
  {
    id: 'L6',
    group: 'L',
    input: 'Meu nome completo é Maria Eduarda da Silva Santos de Oliveira',
    expected: 'Extrai o nome longo.',
    preSetup: (session) => {
      session.state = 'AWAITING_FIELD:name';
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:isExistingPatient' && session.data.name.includes('Maria Eduarda');
      return { pass, note: `State: ${session.state}, Name: ${session.data.name}` };
    }
  },
  {
    id: 'L7',
    group: 'L',
    input: 'Me chamo Ana Lima, tenho 32 anos',
    expected: 'Extrai o nome, não pula campos.',
    preSetup: (session) => {
      session.state = 'START';
    },
    assert: (res, session) => {
      const pass = session.state === 'AWAITING_FIELD:isExistingPatient' && session.data.name.includes('Ana Lima');
      return { pass, note: `State: ${session.state}, Name: ${session.data.name}` };
    }
  }
];

async function runTests(groupFilter?: string) {
  console.log('\n==================================================');
  console.log('🤖 INICIANDO RUNNER AUTOMATIZADO DA CLINICA');
  console.log('==================================================\n');

  const chatHistoryPath = path.join(process.cwd(), 'chat_histories.json');
  
  // Limpa histórico de conversas dos números de teste para evitar interferências
  if (fs.existsSync(chatHistoryPath)) {
    try {
      const histories = JSON.parse(fs.readFileSync(chatHistoryPath, 'utf8'));
      let modified = false;
      for (const key in histories) {
        if (key.startsWith('554890000')) {
          delete histories[key];
          modified = true;
        }
      }
      if (modified) {
        fs.writeFileSync(chatHistoryPath, JSON.stringify(histories, null, 2), 'utf8');
      }
    } catch (e) {
      console.warn('Não foi possível limpar os históricos de teste:', e);
    }
  }

  // Filtra os casos de teste
  const casesToRun = groupFilter && groupFilter.toUpperCase() !== 'ALL'
    ? testCases.filter(c => c.group === groupFilter.toUpperCase())
    : testCases;

  console.log(`Carregados ${casesToRun.length} casos de teste para executar.\n`);

  const results: { id: string; group: string; input: string; expected: string; reply: string; pass: boolean; note: string }[] = [];

  let count = 0;
  for (const tc of casesToRun) {
    count++;
    // Gera um número de telefone fake e exclusivo para isolamento de histórico
    const testPhone = `554890000${tc.id.padEnd(4, '0')}`;
    const session = new TriageSession(testPhone);

    // Aplica preSetup de estado se houver
    if (tc.preSetup) {
      tc.preSetup(session);
    }

    console.log(`[${count}/${casesToRun.length}] Executando ${tc.id} (${tc.group}) — Input: "${tc.input}"...`);
    
    let reply = '';
    let pass = false;
    let note = '';
    
    try {
      reply = await routeTriageMessage(session, tc.input);
      const assertResult = tc.assert(reply, session);
      pass = assertResult.pass;
      note = assertResult.note;
    } catch (error: any) {
      reply = `ERRO: ${error.message}`;
      pass = false;
      note = 'Falha na execução do roteador';
    }

    results.push({
      id: tc.id,
      group: tc.group,
      input: tc.input,
      expected: tc.expected,
      reply,
      pass,
      note
    });

    const statusIcon = pass ? '✅ PASSOU' : '❌ FALHOU';
    console.log(`      Resultado: ${statusIcon} | Observação: ${note}`);
    console.log(`      Bot: "${reply.split('\n')[0]}..."\n`);
  }

  // Imprime Relatório Final
  console.log('\n==================================================');
  console.log('📊 RELATÓRIO DE EXECUÇÃO DO CHECKLIST');
  console.log('==================================================');
  
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`Total executados: ${results.length}`);
  console.log(`✅ Passaram: ${passed}`);
  console.log(`❌ Falharam: ${failed}`);
  console.log(`Taxa de Sucesso: ${((passed / results.length) * 100).toFixed(1)}%\n`);

  console.log('| ID | Grupo | Input | Esperado | Status | Obs |');
  console.log('|----|-------|-------|----------|--------|-----|');
  for (const r of results) {
    const statusIcon = r.pass ? '✅' : '❌';
    console.log(`| ${r.id} | ${r.group} | \`${r.input}\` | ${r.expected} | ${statusIcon} | ${r.note} |`);
  }
  
  // Opcional: Atualiza o arquivo C:\AI\clinica-chatbot\Check List.md com os resultados automáticos
  try {
    const checkListPath = path.join(process.cwd(), 'Check List.md');
    if (fs.existsSync(checkListPath)) {
      let content = fs.readFileSync(checkListPath, 'utf8');
      
      // Atualiza o resultado de cada item na tabela do Markdown
      for (const r of results) {
        const regex = new RegExp(`(\\|\\s*${r.id}\\s*\\|.*?\\|.*?\\|\\s*)([✅❌☐\\s]*bug\\d*|☐|✅|❌)(\\s*\\|)`, 'i');
        const statusIcon = r.pass ? '✅' : '❌';
        content = content.replace(regex, `$1${statusIcon}$3`);
      }
      
      fs.writeFileSync(checkListPath, content, 'utf8');
      console.log('\n📝 Checklist "Check List.md" atualizado com sucesso no workspace!');
    }
  } catch (err: any) {
    console.warn('\nErro ao atualizar Check List.md:', err.message);
  }
}

// Interface interativa
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const arg = process.argv[2];
if (arg) {
  rl.close();
  runTests(arg);
} else {
  console.log('Escolha o grupo de testes para rodar:');
  console.log('A — Saudação e Início de Conversa');
  console.log('B — Coleta de Nome');
  console.log('C — Já é Paciente');
  console.log('D — Coleta de Idade');
  console.log('E — Convênio');
  console.log('F — Carteirinha');
  console.log('G — Queixa');
  console.log('H — Receita');
  console.log('I — Concordância Termos');
  console.log('J — FAQs');
  console.log('K — Fora do fluxo');
  console.log('L — Correções');
  console.log('ALL — Executar todos os grupos');
  
  rl.question('\nDigite a opção desejada (ou pressione Enter para rodar ALL): ', (answer) => {
    rl.close();
    const group = answer.trim() || 'ALL';
    runTests(group);
  });
}
