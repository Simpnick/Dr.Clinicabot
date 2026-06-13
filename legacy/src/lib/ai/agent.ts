import { GoogleGenAI, Type, ThinkingLevel, Content } from '@google/genai';
import * as dotenv from 'dotenv';
import { getFreeSlots, createAppointment, findUpcomingAppointmentByPhone, listAppointments, cancelAppointment } from '../google/calendar';
import { addPatient, findPatientByWhatsApp, findPatient, findPatientByCpf, addFinancialTransaction, getFinancialSummary, updatePatientEhrLink } from '../google/sheets';
import { getOrCreatePatientDoc, appendClinicalNote, generatePrescriptionOrAtestado } from '../google/docs';
import { sendWhatsAppMessage } from '../whatsapp/client';
import * as fs from 'fs';
import * as path from 'path';
import { validateCpf } from '../utils/cpf-validator';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const HISTORIES_FILE_PATH = path.join(process.cwd(), 'chat_histories.json');

// Helper para ler históricos do arquivo JSON
function loadAllHistories(): Record<string, Content[]> {
  try {
    if (fs.existsSync(HISTORIES_FILE_PATH)) {
      const data = fs.readFileSync(HISTORIES_FILE_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Erro ao carregar históricos de chat:', error);
  }
  return {};
}

// Helper para salvar todos os históricos no arquivo JSON
function saveAllHistories(histories: Record<string, Content[]>): void {
  try {
    fs.writeFileSync(HISTORIES_FILE_PATH, JSON.stringify(histories, null, 2), 'utf-8');
  } catch (error) {
    console.error('Erro ao salvar históricos de chat:', error);
  }
}

// Helper para limpar chamadas de função, pensamentos e metadados do histórico
function cleanHistoryForStorage(history: Content[]): Content[] {
  const cleaned: Content[] = [];
  
  for (const turn of history) {
    if (!turn.parts) continue;
    
    // Mantém apenas partes de texto que não são pensamentos (thoughts)
    const textParts = turn.parts.filter(part => {
      return 'text' in part && part.text && !('thought' in part) && !('thoughtSignature' in part);
    });
    
    if (textParts.length > 0) {
      cleaned.push({
        role: turn.role,
        parts: textParts.map(p => ({ text: p.text || '' }))
      });
    }
  }

  // Garante a alternância estrita entre 'user' e 'model'
  const alternated: Content[] = [];
  let expectedRole = 'user';

  for (const turn of cleaned) {
    if (turn.role === expectedRole) {
      alternated.push(turn);
      expectedRole = expectedRole === 'user' ? 'model' : 'user';
    } else {
      console.warn(`[History Clean] Pulando turn fora de ordem no histórico. Esperado: "${expectedRole}", Recebido: "${turn.role}"`);
    }
  }
  
  // Garante que o histórico termina com 'model' (removendo qualquer mensagem 'user' sem resposta)
  while (alternated.length > 0 && alternated[alternated.length - 1].role !== 'model') {
    alternated.pop();
  }
  
  return alternated;
}

// Obtém o histórico de um usuário específico
export function getChatHistory(userPhone: string): Content[] {
  const histories = loadAllHistories();
  const rawHistory = histories[userPhone] || [];
  return cleanHistoryForStorage(rawHistory);
}

// Limpa o histórico de um usuário específico
export function clearChatHistory(userPhone: string): void {
  try {
    const histories = loadAllHistories();
    if (userPhone in histories) {
      delete histories[userPhone];
      saveAllHistories(histories);
      console.log(`[History] Histórico do usuário ${userPhone} foi limpo.`);
    }
  } catch (error) {
    console.error(`Erro ao limpar histórico do usuário ${userPhone}:`, error);
  }
}

// Salva o histórico de um usuário específico e o limpa se necessário
export function saveChatHistory(userPhone: string, history: Content[]): void {
  const histories = loadAllHistories();

  let cleaned = cleanHistoryForStorage(history);

  // Limpa o histórico para garantir que comece com 'user' e tenha tamanho limitado
  const maxHistoryMessages = 20; // 10 turns
  if (cleaned.length > maxHistoryMessages) {
    cleaned = cleaned.slice(-maxHistoryMessages);
  }
  while (cleaned.length > 0 && cleaned[0].role !== 'user') {
    cleaned.shift();
  }

  histories[userPhone] = cleaned;
  saveAllHistories(histories);
}

// Analisa o histórico recente para garantir que o paciente confirmou o preço e os detalhes do agendamento
function checkPriceConfirmation(history: Content[]): { confirmed: boolean; errorMsg?: string } {
  let latestUserText = '';
  let lastModelText = '';

  // Procuramos de trás para frente no histórico
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (!turn.parts) continue;

    // Pega o texto do turn se houver
    const textPart = turn.parts.find(p => 'text' in p && p.text);
    const text = textPart ? (textPart.text || '') : '';

    if (turn.role === 'user') {
      if (!latestUserText && text) {
        latestUserText = text;
      }
    } else if (turn.role === 'model') {
      // Ignoramos se for apenas chamada de função (sem texto)
      if (latestUserText && !lastModelText && text) {
        lastModelText = text;
        break; // Já achamos o par mais recente de resposta do modelo e mensagem do usuário
      }
    }
  }

  console.log(`[Price Check] Última msg do modelo: "${lastModelText}"`);
  console.log(`[Price Check] Última msg do usuário: "${latestUserText}"`);

  // Se não achou a mensagem do modelo ou do usuário, não está confirmado
  if (!lastModelText || !latestUserText) {
    return { confirmed: false, errorMsg: "Não foi possível encontrar a última interação de confirmação no histórico." };
  }

  const lastModelTextLower = lastModelText.toLowerCase();
  const modelMentionedPrice = lastModelTextLower.includes('350') || lastModelTextLower.includes('valor') || lastModelTextLower.includes('preço') || lastModelTextLower.includes('custo');
  const modelAskedConfirmation = lastModelTextLower.includes('confirm') || lastModelTextLower.includes('acordo') || lastModelTextLower.includes('de acordo') || lastModelTextLower.includes('posso agendar') || lastModelTextLower.includes('podemos');

  if (!modelMentionedPrice || !modelAskedConfirmation) {
    return { 
      confirmed: false, 
      errorMsg: "O valor da consulta de R$ 350,00 e os detalhes do agendamento ainda não foram apresentados ao paciente. Você DEVE apresentar a data/horário escolhidos, informar que o valor da consulta particular é de R$ 350,00 e perguntar explicitamente se ele está de acordo e se pode confirmar antes de agendar."
    };
  }

  const userTextClean = latestUserText.toLowerCase().trim();
  const confirmationWords = ['sim', 'pode', 'confirmo', 'confirmar', 'ok', 'acordo', 'de acordo', 'com certeza', 'claro', 'quero', 'agendar', 'marca', 'marcar', 'yes', 'pode ser', 'fechado', 'positivo'];
  
  const userConfirmed = confirmationWords.some(word => userTextClean.includes(word));

  if (!userConfirmed) {
    return {
      confirmed: false,
      errorMsg: `O paciente ainda não confirmou o valor e os detalhes do agendamento. Ele disse: "${latestUserText}". Você deve perguntar se ele aceita o valor de R$ 350,00 e se deseja confirmar o agendamento antes de prosseguir.`
    };
  }

  return { confirmed: true };
}


// Definições de ferramentas (Tools) do Google para o Agente de IA

const getFreeSlotsTool = {
  name: 'getFreeSlots',
  description: 'Retorna a lista de horários livres disponíveis para agendamento de consultas em um dia específico (no formato YYYY-MM-DD). Use esta ferramenta sempre que o paciente perguntar por horários ou dias livres.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      dateStr: {
        type: Type.STRING,
        description: 'Data no formato YYYY-MM-DD (ex: 2026-05-22).'
      }
    },
    required: ['dateStr']
  }
};

const createAppointmentTool = {
  name: 'createAppointment',
  description: 'Reserva e agenda uma nova consulta na agenda do médico. Sempre chame antes a ferramenta de buscar horários livres para confirmar a disponibilidade.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      patientName: {
        type: Type.STRING,
        description: 'Nome completo do paciente.'
      },
      patientPhone: {
        type: Type.STRING,
        description: 'Número de telefone/WhatsApp do paciente.'
      },
      startIsoString: {
        type: Type.STRING,
        description: 'Data e hora de início no formato ISO (ex: 2026-05-22T14:00:00-03:00).'
      }
    },
    required: ['patientName', 'patientPhone', 'startIsoString']
  }
};

const addPatientTool = {
  name: 'addPatient',
  description: 'Cadastra um novo paciente na lista de contatos da clínica no Google Sheets.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: {
        type: Type.STRING,
        description: 'Nome completo do paciente.'
      },
      whatsapp: {
        type: Type.STRING,
        description: 'Número de telefone/WhatsApp do paciente.'
      },
      cpf: {
        type: Type.STRING,
        description: 'Número do CPF do paciente (apenas números).'
      }
    },
    required: ['name', 'whatsapp', 'cpf']
  }
};

const findPatientTool = {
  name: 'findPatient',
  description: 'Busca um paciente cadastrado na clínica por nome, CPF ou por número de WhatsApp. Sempre use esta ferramenta para verificar se um cliente já existe no sistema antes de cadastrá-lo.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'Nome completo, CPF ou número de telefone do paciente a ser buscado.'
      }
    },
    required: ['query']
  }
};

const requestCancelAppointmentTool = {
  name: 'requestCancelAppointment',
  description: 'Solicita ao médico o cancelamento de uma consulta existente. Use esta ferramenta quando o paciente solicitar o cancelamento de uma consulta.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      patientPhone: {
        type: Type.STRING,
        description: 'Número de WhatsApp do paciente (ex: 5548996633846).'
      }
    },
    required: ['patientPhone']
  }
};

const requestRescheduleAppointmentTool = {
  name: 'requestRescheduleAppointment',
  description: 'Solicita ao médico o reagendamento (alteração de data/hora) de uma consulta existente. Use esta ferramenta após o paciente escolher uma nova data/hora válida dos horários livres.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      patientPhone: {
        type: Type.STRING,
        description: 'Número de WhatsApp do paciente (ex: 5548996633846).'
      },
      newStartIsoString: {
        type: Type.STRING,
        description: 'Nova data e hora desejada no formato ISO (ex: 2026-05-22T14:00:00-03:00).'
      }
    },
    required: ['patientPhone', 'newStartIsoString']
  }
};

const findUpcomingAppointmentTool = {
  name: 'findUpcomingAppointment',
  description: 'Busca o próximo agendamento (consulta futura) de um paciente usando o número de telefone dele. Use sempre para verificar se o paciente já tem um agendamento antes de oferecer novos horários ou quando o paciente perguntar quais consultas/horários ele tem marcados.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      patientPhone: {
        type: Type.STRING,
        description: 'Número de WhatsApp do paciente (ex: 5548996633846).'
      }
    },
    required: ['patientPhone']
  }
};

const cancelAppointmentTool = {
  name: 'cancelAppointment',
  description: 'Cancela e remove uma consulta/compromisso existente da agenda usando o ID do evento (eventId). Esta ferramenta é exclusiva do médico e permite que ele cancele atendimentos diretamente.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      eventId: {
        type: Type.STRING,
        description: 'O ID do compromisso/evento a ser cancelado no Google Calendar.'
      }
    },
    required: ['eventId']
  }
};

const listAppointmentsTool = {
  name: 'listAppointments',
  description: 'Lista todas as consultas/compromissos agendados em um intervalo de datas. Esta ferramenta é extremamente útil para o médico verificar a sua agenda de atendimentos do dia, da semana ou de qualquer período.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      startDateStr: {
        type: Type.STRING,
        description: 'A data inicial da consulta no formato YYYY-MM-DD (ex: 2026-05-22).'
      },
      endDateStr: {
        type: Type.STRING,
        description: 'A data final da consulta no formato YYYY-MM-DD (opcional. Se não for informada, busca apenas o dia da startDateStr).'
      }
    },
    required: ['startDateStr']
  }
};

const validateCpfTool = {
  name: 'validateCpf',
  description: 'Valida se um número de CPF informado pelo paciente é matematicamente válido (verifica os dígitos verificadores). Sempre use esta ferramenta para validar o CPF informado pelo paciente antes de cadastrá-lo com a ferramenta addPatient ou atualizar seu CPF.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      cpf: {
        type: Type.STRING,
        description: 'O CPF do paciente (apenas números ou formatado com pontos e traço).'
      }
    },
    required: ['cpf']
  }
};

// Ferramentas administrativas (Apenas para o Médico)

const addClinicalNoteTool = {
  name: 'addClinicalNote',
  description: 'Adiciona uma evolução ou anotação clínica no prontuário do paciente (Google Doc no Drive). Se o prontuário não existir, ele será criado automaticamente.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      patientName: {
        type: Type.STRING,
        description: 'Nome completo do paciente.'
      },
      patientPhone: {
        type: Type.STRING,
        description: 'Número de WhatsApp do paciente.'
      },
      noteText: {
        type: Type.STRING,
        description: 'Texto da evolução/anotação clínica contendo o histórico do atendimento de hoje.'
      }
    },
    required: ['patientName', 'patientPhone', 'noteText']
  }
};

const addFinancialTransactionTool = {
  name: 'addFinancialTransaction',
  description: 'Registra um lançamento de entrada (receita) ou saída (despesa) no controle de caixa da clínica.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      type: {
        type: Type.STRING,
        description: 'Tipo do lançamento. Deve ser Receita ou Despesa.'
      },
      description: {
        type: Type.STRING,
        description: 'Descrição da transação (ex: "Consulta João Silva", "Compra de papel de maca").'
      },
      value: {
        type: Type.NUMBER,
        description: 'Valor em reais (ex: 350.00).'
      },
      paymentMethod: {
        type: Type.STRING,
        description: 'Forma de pagamento utilizada (ex: PIX, Dinheiro, Cartão).'
      }
    },
    required: ['type', 'description', 'value']
  }
};

const getFinancialSummaryTool = {
  name: 'getFinancialSummary',
  description: 'Busca o resumo financeiro da clínica (Total de Entradas, Total de Saídas e Saldo Líquido acumulado).',
  parameters: {
    type: Type.OBJECT,
    properties: {}
  }
};

const generateMedicalDocumentTool = {
  name: 'generateMedicalDocument',
  description: 'Gera um documento médico (Receituário ou Atestado Médico) no formato de Google Doc no Drive da clínica. Use sempre que o médico solicitar a emissão de uma receita, prescrição ou atestado.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      patientName: {
        type: Type.STRING,
        description: 'Nome completo do paciente.'
      },
      documentType: {
        type: Type.STRING,
        description: 'Tipo do documento. Deve ser exatamente "Receituário" ou "Atestado Médico".'
      },
      content: {
        type: Type.STRING,
        description: 'Conteúdo detalhado do documento (prescrição de medicamentos com dosagem e duração, ou recomendações e justificativa do atestado).'
      }
    },
    required: ['patientName', 'documentType', 'content']
  }
};

/**
 * Função principal do agente conversacional
 */
export async function runAgent(
  userPhone: string,
  messageText: string,
  isDoctor: boolean
): Promise<string> {
  // Define o prompt do sistema dependendo se é Médico ou Paciente
  const dateToday = new Date().toLocaleDateString('pt-BR');
  const dayOfWeek = new Date().toLocaleDateString('pt-BR', { weekday: 'long' });

  let patientInfoPrompt = '';
  if (!isDoctor) {
    const patient = await findPatientByWhatsApp(userPhone);
    if (patient) {
      const firstName = patient.name.split(' ')[0];
      const hasCpf = !!(patient.cpf && patient.cpf.trim());
      
      if (hasCpf) {
        patientInfoPrompt = `
DADOS DO PACIENTE ATUAL (ENCONTRADO PELO NÚMERO DE WHATSAPP):
- Nome Completo: ${patient.name}
- CPF: ${patient.cpf}
- WhatsApp: ${patient.whatsapp}

IMPORTANTE: Este paciente já está cadastrado no sistema com todos os dados completos (incluindo CPF). Trate-o e chame-o pelo seu primeiro nome ("${firstName}") para criar intimidade e proximidade. Se ele solicitar o agendamento de uma consulta, efetue o agendamento diretamente usando a ferramenta "createAppointment" sem perguntar seu nome, CPF ou WhatsApp, pois você já possui esses dados.`;
      } else {
        patientInfoPrompt = `
DADOS DO PACIENTE ATUAL (ENCONTRADO PELO NÚMERO DE WHATSAPP):
- Nome Completo: ${patient.name}
- CPF: NÃO INFORMADO
- WhatsApp: ${patient.whatsapp}

IMPORTANTE: Este paciente possui um cadastro parcial no sistema, mas o **CPF está faltando**. 
Se ele solicitar o agendamento de uma consulta, você DEVE solicitar obrigatoriamente o seu CPF primeiro. Após ele fornecer o CPF, chame a ferramenta "validateCpf" para verificar se o CPF é matematicamente válido. Se for inválido, informe ao paciente e peça que ele forneça um CPF correto. Se for válido, chame a ferramenta "addPatient" fornecendo seu Nome Completo (${patient.name}), seu WhatsApp (${patient.whatsapp}) e o CPF fornecido para atualizar o cadastro no sistema. Apenas depois de fazer isso, prossiga com a ferramenta "createAppointment".`;
      }
    } else {
      patientInfoPrompt = `
DADOS DO PACIENTE ATUAL:
- WhatsApp: ${userPhone} (NÚMERO NÃO CADASTRADO NO SISTEMA)

IMPORTANTE: O número de WhatsApp atual não está associado a nenhuma conta de paciente.
Você deve seguir as seguintes regras de identificação:
1. Permita que o paciente tire dúvidas gerais sobre a clínica (ex: especialidades, preço da consulta de R$ 350,00, etc.) sem estar cadastrado. Nunca cadastre o paciente apenas por ele iniciar o contato.
2. Para identificá-lo antes de prosseguir com agendamentos ou para dar um atendimento personalizado, solicite educadamente o seu nome ou o seu CPF.
3. Se ele fornecer o nome ou o CPF, use a ferramenta "findPatient" para buscar se ele já possui cadastro (ele pode estar usando outro número de celular).
4. Se a ferramenta "findPatient" retornar um cadastro correspondente: use esse cadastro e trate-o pelo primeiro nome do cadastro correspondente.
5. Se ele não for encontrado no sistema (não for cliente) e **desejar agendar uma consulta**, você deve solicitar seu Nome Completo e o seu CPF.
   - **MUITO IMPORTANTE:** Sempre verifique o histórico da conversa antes de solicitar o nome ou o CPF. Se o paciente já tiver informado o Nome Completo ou o CPF em mensagens anteriores desta conversa, **NÃO** peça essa informação novamente. Use o dado que ele já informou no histórico.
   - O número do WhatsApp você já possui (${userPhone}), portanto NUNCA pergunte ou solicite o número do WhatsApp do paciente.
   - Antes de chamá-la para cadastrar, você DEVE SEMPRE validar se o CPF fornecido pelo paciente é válido chamando a ferramenta "validateCpf". Se a ferramenta retornar que o CPF é inválido, informe ao paciente e peça que digite um CPF válido.
   - Assim que o Nome Completo for informado e o CPF for validado com sucesso (sejam fornecidos agora ou resgatados de mensagens anteriores no histórico), chame a ferramenta "addPatient" imediatamente na mesma rodada para cadastrá-lo, sem pedir mais nenhuma informação de identificação.`;
    }
  }

  let systemInstruction = isDoctor
    ? `Você é o Assistente Virtual Administrativo da Clínica Médica.
O usuário atual conversando com você é o **MÉDICO** da clínica (proprietário). Ele tem acesso irrestrito.
Hoje é ${dayOfWeek}, ${dateToday}.

Você pode executar ações administrativas como:
1. Buscar horários livres ou listar todas as consultas agendadas de um dia específico (utilizando a ferramenta listAppointments). Sempre que o médico solicitar a agenda ou consultas do dia, após obter a lista com a ferramenta listAppointments, você deve buscar cada paciente usando a ferramenta findPatient para recuperar o seu respectivo link de prontuário (Link Prontuario/ehrLink) e apresentá-lo na resposta ao lado do nome do paciente.
2. Agendar novas consultas (pedindo os dados do paciente).
3. Cadastrar novos pacientes no sistema.
4. Escrever ou atualizar o prontuário de um paciente (Google Docs no Google Drive). Se o paciente não tiver prontuário criado, a ferramenta criará automaticamente e você informará o link do prontuário para ele se necessário.
5. Lançar receitas e despesas no financeiro.
6. Gerar resumos financeiros.
7. Gerar documentos médicos, como Receituários e Atestados Médicos (Google Docs no Google Drive).
8. Cancelar consultas e compromissos diretamente da agenda utilizando o ID do evento (utilizando a ferramenta cancelAppointment).

Sempre seja atencioso, extremamente conciso e profissional em Português. Quando o médico pedir para adicionar uma anotação ao prontuário, registrar uma finança ou gerar um documento médico (receita/atestado), chame a ferramenta apropriada imediatamente e confirme que a ação foi realizada com sucesso, informando o link do documento gerado.`
    : `Você é a Assistente Virtual. SUAS REGRAS DE CONDUTA (CRÍTICAS - LEIA COM ATENÇÃO):
1. **Seja Extremamente Direto e Objetivo:** Não faça rodeios, não use frases longas desnecessárias e não ofereça opções que o paciente não solicitou. Responda apenas e estritamente ao que for perguntado de forma educada e prestativa.
2. **NÃO LISTE SUAS CAPACIDADES/FUNÇÕES:** Nunca diga ao paciente coisas como "posso agendar consultas, ver horários, ajudar com cancelamentos" ou similares. O paciente não deve receber uma lista do que você sabe fazer. Se ele disser apenas "Oi", limite-se a cumprimentá-lo, apresentar o consultório/clínica e perguntar em que pode ajudar. Exemplo: "Olá, Thiago! Sou a Assistente Virtual da clínica médica. Como posso ajudar você hoje?".
3. **Fluxo de Atendimento Fragmentado:**
   - Cumprimente o cliente e apresente a clínica.
   - Aguarde o cliente fazer uma pergunta ou solicitação específica.
   - Responda à pergunta dele diretamente, sem adicionar textos de sugestão extras ou empurrar outras ações.
4. **Confirmação do Valor e Detalhes da Consulta (OBRIGATÓRIO):** Antes de agendar a consulta (ou seja, antes de chamar a ferramenta "createAppointment"), você deve apresentar a data/horário escolhidos, informar explicitamente que o valor da consulta particular é de R$ 350,00, e perguntar se ele está de acordo e se pode confirmar. Só chame a ferramenta "createAppointment" após o paciente confirmar explicitamente (ex: "Sim", "Pode marcar", "Estou de acordo").
5. **Agendamento e Cadastro:** Apenas use a ferramenta "addPatient" para cadastrar um paciente quando ele **solicitar explicitamente o agendamento de uma consulta** (após a identificação e confirmação dos dados) e não tiver cadastro prévio encontrado. Verifique sempre o histórico da conversa para reutilizar o Nome Completo e o CPF caso o paciente já os tenha fornecido em mensagens anteriores da sessão de chat, evitando perguntar novamente o que ele já informou. Chame a ferramenta "addPatient" imediatamente assim que o CPF for validado com sucesso e o nome for conhecido.
6. **Alterações e Cancelamentos de Consultas:** Se o paciente solicitar o cancelamento de uma consulta, utilize a ferramenta "requestCancelAppointment". Se solicitar alteração/reagendamento, utilize a ferramenta "requestRescheduleAppointment". Informe ao paciente de forma simples e direta que o pedido foi encaminhado ao Dr. e está aguardando confirmação.
7. **Restrições:** Você não tem acesso a prontuários de outros pacientes ou finanças. O valor da consulta padrão é R$ 350,00.
8. **Identificação Prévia e Busca de Consultas (OBRIGATÓRIO):** Nunca ofereça ou busque datas disponíveis (\`getFreeSlots\`) sem antes verificar se o paciente já é cadastrado (identificando-o por Nome/CPF caso o WhatsApp não seja reconhecido) e verificar se ele já possui um agendamento futuro utilizando a ferramenta \`findUpcomingAppointment\`. Se o paciente perguntar especificamente quais consultas ou horários ele tem marcados, chame a ferramenta \`findUpcomingAppointment\` para buscar o agendamento dele e informe-o.
9. **Número de WhatsApp do Paciente:** O número de WhatsApp do paciente atual é conhecido e está disponível nos dados sob a seção DADOS DO PACIENTE ATUAL. Você NUNCA deve perguntar ou solicitar o número do WhatsApp do paciente sob nenhuma circunstância.
10. **Validação Obrigatória de CPF:** Sempre que o paciente fornecer um número de CPF, você deve verificar se ele é matematicamente válido chamando a ferramenta \`validateCpf\` imediatamente. Se a ferramenta retornar que o CPF é inválido, informe isso ao paciente e peça que ele forneça um CPF correto. Não chame a ferramenta \`addPatient\` nem tente cadastrar com um CPF inválido.

Proceda com o agendamento de forma simpática, prestativa e extremamente direta em Português.`;

  if (!isDoctor && patientInfoPrompt) {
    systemInstruction += `\n\n${patientInfoPrompt}`;
  }

  // Define as ferramentas disponíveis baseadas no papel
  const tools = isDoctor
    ? [
      { functionDeclarations: [getFreeSlotsTool, createAppointmentTool, addPatientTool, findPatientTool, addClinicalNoteTool, addFinancialTransactionTool, getFinancialSummaryTool, generateMedicalDocumentTool, listAppointmentsTool, cancelAppointmentTool] }
    ]
    : [
      { functionDeclarations: [getFreeSlotsTool, createAppointmentTool, addPatientTool, findPatientTool, requestCancelAppointmentTool, requestRescheduleAppointmentTool, findUpcomingAppointmentTool, validateCpfTool] }
    ];

  console.log(`\n=================== INICIANDO AGENTE DE IA ===================`);
  console.log(`👤 Remetente: ${userPhone}`);
  console.log(`👨‍⚕️ Papel: ${isDoctor ? 'MÉDICO (Acesso Total)' : 'PACIENTE (Agendamento apenas)'}`);
  console.log(`💬 Mensagem: "${messageText}"`);
  console.log(`🔧 Ferramentas carregadas:`, tools[0].functionDeclarations.map(t => t.name).join(', '));

  try {
    const cleanDoctorPhone = (process.env.DOCTOR_PHONE || '').replace(/\D/g, '');
    const cleanUserPhone = userPhone.replace(/\D/g, '');
    const historyKey = cleanUserPhone === cleanDoctorPhone
      ? (isDoctor ? `${userPhone}_doctor` : `${userPhone}_patient`)
      : userPhone;

    const previousHistory = getChatHistory(historyKey);
    const model = 'gemma-4-26b-a4b-it';
    console.log(`🤖 Inicializando chat com: ${model}`);

    const config: any = {
      systemInstruction: systemInstruction,
      tools: tools as any,
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.HIGH
      }
    };

    let chat = ai.chats.create({
      model: model,
      history: previousHistory,
      config: config
    });
    let response = await chat.sendMessage({ message: messageText });
    console.log(`✅ Conexão estabelecida! Modelo ativo na sessão: "${model}"`);
    let functionCalls = response.functionCalls;

      // Loop de execução de funções (Tool Calling Loop)
      // Executa enquanto a IA decidir que precisa rodar alguma ferramenta do Google
      while (functionCalls && functionCalls.length > 0) {
        console.log(`AI Agent: Solicitou ${functionCalls.length} chamadas de função em paralelo.`);
        const parts: any[] = [];

        for (const call of functionCalls) {
          const functionName = call.name;
          const args = call.args as any;

          console.log(`AI Agent: Processando chamada de função "${functionName}" com argumentos:`, args);

          let resultData: any;

          try {
            switch (functionName) {
              case 'getFreeSlots':
                resultData = await getFreeSlots(args.dateStr);
                break;
              case 'listAppointments':
                resultData = await listAppointments(args.startDateStr, args.endDateStr);
                break;
              case 'cancelAppointment':
                await cancelAppointment(args.eventId);
                resultData = { success: true };
                break;
              case 'createAppointment':
                // 1. Garante que o paciente está cadastrado e possui CPF antes de agendar
                let patient = await findPatientByWhatsApp(args.patientPhone);
                if (!patient) {
                  throw new Error("Erro: Paciente não cadastrado no sistema. Você deve solicitar o CPF, nome completo e WhatsApp do paciente e cadastrá-lo usando a ferramenta 'addPatient' antes de realizar o agendamento.");
                }
                if (!patient.cpf || !patient.cpf.trim()) {
                  throw new Error("Erro: O CPF do paciente está ausente no cadastro. Você deve solicitar o CPF do paciente e atualizar o cadastro dele usando a ferramenta 'addPatient' antes de prosseguir com o agendamento.");
                }
                // 1.5 Valida se o paciente aceitou o preço/detalhes antes do agendamento real
                if (!isDoctor) {
                  const history = chat.getHistory();
                  const priceCheck = checkPriceConfirmation(history);
                  if (!priceCheck.confirmed) {
                    throw new Error(`Erro de Confirmação: ${priceCheck.errorMsg}`);
                  }
                }
                // 2. Cria o prontuário dele no Drive se ele ainda não tiver link
                if (!patient.ehrLink) {
                  const docRes = await getOrCreatePatientDoc(patient.name, patient.whatsapp);
                  await updatePatientEhrLink(patient.whatsapp, docRes.viewLink);
                }
                // 3. Agenda no Google Calendar
                resultData = await createAppointment(patient.name, patient.whatsapp, args.startIsoString);
                break;
              case 'addPatient':
                resultData = await addPatient(args.name, args.whatsapp, args.cpf);
                // Cria o prontuário no Drive
                const doc = await getOrCreatePatientDoc(args.name, args.whatsapp);
                await updatePatientEhrLink(args.whatsapp, doc.viewLink);
                resultData.ehrLink = doc.viewLink;
                break;
              case 'addClinicalNote':
                // 1. Busca ou cria o prontuário
                const docInfo = await getOrCreatePatientDoc(args.patientName, args.patientPhone);
                // 2. Atualiza o link na planilha de pacientes caso necessário
                await updatePatientEhrLink(args.patientPhone, docInfo.viewLink);
                // 3. Adiciona a anotação clínica no Google Doc
                await appendClinicalNote(docInfo.documentId, args.noteText);
                resultData = { success: true, link: docInfo.viewLink };
                break;
              case 'addFinancialTransaction':
                await addFinancialTransaction(args.type, args.description, args.value, args.paymentMethod);
                resultData = { success: true };
                break;
              case 'getFinancialSummary':
                resultData = await getFinancialSummary();
                break;
              case 'generateMedicalDocument':
                resultData = await generatePrescriptionOrAtestado(args.patientName, args.documentType, args.content);
                break;
              case 'findPatient':
                resultData = await findPatient(args.query);
                break;
              case 'validateCpf':
                resultData = { valid: validateCpf(args.cpf) };
                break;
              case 'requestCancelAppointment':
                // 1. Busca compromissos futuros para o telefone
                const cancelAppt = await findUpcomingAppointmentByPhone(args.patientPhone);
                if (!cancelAppt || !cancelAppt.id) {
                  resultData = { success: false, error: 'Nenhuma consulta futura encontrada para este paciente.' };
                } else {
                  // 2. Extrai nome do paciente
                  const patientName = cancelAppt.summary?.replace('Consulta: ', '') || 'Paciente';
                  // Converte data para fuso local formatado
                  const apptDateStr = new Date(cancelAppt.start.dateTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                  
                  // 3. Monta a mensagem para o médico
                  const docMsg = `📢 *[Solicitação de Cancelamento]*\n\nO paciente *${patientName}* (WhatsApp: ${args.patientPhone}) solicitou o cancelamento da consulta de *${apptDateStr}*.\n\nPara aprovar este cancelamento, responda com:\n👉 *#cancelar_${cancelAppt.id}*`;
                  
                  // 4. Envia mensagem para o médico
                  const doctorPhone = process.env.DOCTOR_PHONE || '';
                  if (doctorPhone) {
                    await sendWhatsAppMessage(doctorPhone, docMsg);
                  }
                  
                  resultData = { success: true, message: 'Solicitação de cancelamento enviada ao médico com sucesso.' };
                }
                break;
              case 'requestRescheduleAppointment':
                // 1. Busca compromisso atual/futuro do paciente
                const currentAppt = await findUpcomingAppointmentByPhone(args.patientPhone);
                if (!currentAppt || !currentAppt.id) {
                  resultData = { success: false, error: 'Nenhuma consulta existente encontrada para ser reagendada.' };
                } else {
                  const patientName = currentAppt.summary?.replace('Consulta: ', '') || 'Paciente';
                  const oldDateStr = new Date(currentAppt.start.dateTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                  const newDateStr = new Date(args.newStartIsoString).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

                  // 2. Monta mensagem para o médico
                  const docMsg = `📢 *[Solicitação de Reagendamento]*\n\nO paciente *${patientName}* (WhatsApp: ${args.patientPhone}) solicitou alterar sua consulta:\n❌ De: *${oldDateStr}*\n✅ Para: *${newDateStr}*\n\nPara aprovar este reagendamento, responda com:\n👉 *#reagendar_${currentAppt.id}_${args.newStartIsoString}*`;

                  // 3. Envia para o médico
                  const doctorPhone = process.env.DOCTOR_PHONE || '';
                  if (doctorPhone) {
                    await sendWhatsAppMessage(doctorPhone, docMsg);
                  }

                  resultData = { success: true, message: 'Solicitação de reagendamento enviada ao médico com sucesso.' };
                }
                break;
              case 'findUpcomingAppointment':
                resultData = await findUpcomingAppointmentByPhone(args.patientPhone);
                break;
              default:
                throw new Error(`Função "${functionName}" não implementada.`);
            }
          } catch (err: any) {
            console.error(`Erro ao executar função ${functionName}:`, err);
            resultData = { error: err.message || 'Falha ao executar operação.' };
          }

          console.log(`AI Agent: Respondendo função "${functionName}" com resultado:`, resultData);

          parts.push({
            functionResponse: {
              name: functionName,
              id: call.id,
              response: { result: resultData }
            }
          });
        }

        // Envia o resultado de TODAS as funções executadas de volta para o Gemini
        response = await chat.sendMessage({
          message: parts
        });

        functionCalls = response.functionCalls;
      }

      console.log(`✨ Resposta final gerada: "${response.text}"`);
      console.log(`==============================================================\n`);

      // Salva o histórico atualizado
      const updatedHistory = chat.getHistory();
      saveChatHistory(historyKey, updatedHistory);

      return response.text || '';
    } catch (error) {
      console.error('Erro na execução do Agente de IA:', error);
      return 'Desculpe, ocorreu um erro interno ao processar sua solicitação. Por favor, tente novamente mais tarde.';
    }
}
