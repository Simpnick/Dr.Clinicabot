import * as fs from 'fs';
import * as path from 'path';
import { generateLLMResponse, ChatMessage } from '../../services/llm/llm-service';
import {
  TriageSession,
  TriageFieldConfig,
  TriageConfig,
  getFirstName,
  getNextUnfilledField,
  updateDynamicSessionState,
  buildTriageSummary,
  loadTriageConfig
} from './triage-flow';
import { config } from '../../config/env-manager';
import { sendWhatsAppMessage } from '../../services/whatsapp/client';

const CHAT_HISTORIES_FILE = path.join(process.cwd(), 'chat_histories.json');

// ────────────────────────────────────────────────────────────
// Histórico de Conversas
// ────────────────────────────────────────────────────────────

function getRecentHistory(phone: string, limit: number = 10): ChatMessage[] {
  try {
    if (fs.existsSync(CHAT_HISTORIES_FILE)) {
      const data = fs.readFileSync(CHAT_HISTORIES_FILE, 'utf8');
      const histories = JSON.parse(data);
      const userHistory = histories[phone] || [];
      
      return userHistory.slice(-limit).map((msg: any) => {
        let textContent = '';
        if (typeof msg.content === 'string') {
          textContent = msg.content;
        } else if (msg.parts && Array.isArray(msg.parts) && msg.parts[0] && typeof msg.parts[0].text === 'string') {
          textContent = msg.parts[0].text;
        }
        const role = msg.role === 'model' || msg.role === 'assistant' ? 'assistant' : 'user';
        return { role, content: textContent };
      });
    }
  } catch (error) {
    console.error(`[Triage Router] Erro ao carregar histórico:`, error);
  }
  return [];
}

/**
 * Verifica se a mensagem é apenas um cumprimento/saudação simples
 */
function isSimpleGreeting(text: string): boolean {
  const clean = text.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
  const words = clean.split(/\s+/);
  const greetingWords = [
    'oi', 'ola', 'olá', 'bom', 'boa', 'dia', 'tarde', 'noite', 
    'tudo', 'bem', 'opa', 'como', 'vai', 'eae', 'salve',
    'tudobem', 'bomdia', 'boatarde', 'boanoite'
  ];
  return words.every(word => greetingWords.includes(word)) && words.length <= 5;
}

// ────────────────────────────────────────────────────────────
// AGENTE 2: Validador / Tomador de Decisão
// ────────────────────────────────────────────────────────────

interface ValidationResult {
  isValid: boolean;
  extractedValue: any;
  errorMessage: string;
  isFAQ: boolean;
  isCorrection: boolean;
  correctedFieldKey: string;
  correctedFieldValue: any;
}

async function runValidationAgent(
  history: ChatMessage[],
  currentField: TriageFieldConfig,
  triageConfig: TriageConfig,
  session: TriageSession
): Promise<ValidationResult> {
  const defaultResult: ValidationResult = {
    isValid: false,
    extractedValue: null,
    errorMessage: '',
    isFAQ: false,
    isCorrection: false,
    correctedFieldKey: '',
    correctedFieldValue: null
  };

  // Monta o contexto dos dados já coletados para o agente saber o que já temos
  const collectedDataSummary = triageConfig.fields
    .filter(f => session.data[f.key] !== undefined && session.data[f.key] !== null && session.data[f.key] !== '')
    .map(f => `- ${f.label}: ${session.data[f.key]}`)
    .join('\n') || '(nenhum dado coletado ainda)';

  const choicesText = currentField.choices ? 
    `Opções válidas para este campo: ${currentField.choices.join(', ')}.` : '';

  const VALIDATION_PROMPT = `Você é o Agente de Validação e Decisão do Chatbot Clínico da ${triageConfig.clinicName}.
Sua tarefa é analisar a ÚLTIMA mensagem do paciente e decidir o que fazer com base no campo atualmente sendo coletado.

CAMPO ATUAL SENDO COLETADO:
- Chave: "${currentField.key}"
- Rótulo: "${currentField.label}"
- Tipo de dado: "${currentField.type}"
${choicesText}
- Regra de validação: "${currentField.validationInstruction}"

DADOS JÁ COLETADOS DO PACIENTE:
${collectedDataSummary}

FAQ E REGRAS DA CLÍNICA (para detectar se o paciente está fazendo uma pergunta de FAQ):
${triageConfig.faqs}

CAMPOS DISPONÍVEIS PARA CORREÇÃO:
${triageConfig.fields.map(f => `- "${f.key}": ${f.label}`).join('\n')}

SUA TAREFA:
Analise a última mensagem do paciente e retorne UM OBJETO JSON com a seguinte estrutura:
{
  "isValid": boolean,
  "extractedValue": (o valor extraído do campo atual, no tipo correto, ou null se inválido),
  "errorMessage": "mensagem amigável de erro em português, vazia se válido",
  "isFAQ": boolean (true se o paciente está fazendo uma pergunta de FAQ/dúvida e NÃO fornecendo dados),
  "isCorrection": boolean (true se o paciente está corrigindo um dado fornecido ANTERIORMENTE),
  "correctedFieldKey": "chave do campo sendo corrigido (string vazia se não é correção)",
  "correctedFieldValue": (novo valor corrigido, ou null se não é correção)
}

REGRAS CRÍTICAS DE FISCALIZAÇÃO:
- Você é o FISCALIZADOR estrito das regras de validação da clínica. Verifique com máximo rigor se a resposta do paciente atende de verdade à "Regra de validação" descrita.
- NUNCA invente, presuma ou fantasie dados que o paciente não forneceu explicitamente. Se a resposta for vaga, incompleta, apenas uma saudação, ou não se enquadrar na regra de validação, defina "isValid": false.
- Se "isValid" for false, explique em "errorMessage" de forma clara, amigável e precisa o que está faltando ou o que está incorreto para que o Agente 1 de diálogo possa realizar uma nova abordagem e solicitar a informação de outra forma.
- Se "isFAQ" for true, "isValid" deve ser false e "extractedValue" deve ser null.
- Se "isCorrection" for true, analise qual campo o paciente está corrigindo, e preencha "correctedFieldKey" e "correctedFieldValue".
  - "isCorrection" só deve ser true quando o paciente EXPLICITAMENTE menciona que um dado ANTERIOR está ERRADO e fornece o NOVO valor correto. Exemplo: "na verdade meu nome é João" = correção do nome.
  - "isCorrection" só deve ser true com "correctedFieldValue" contendo o novo valor válido. NUNCA retorne "isCorrection": true com "correctedFieldValue": null.
  - Se o paciente apenas confirma ou repete algo sem indicar erro anterior, NÃO é correção.
  - Se você não consegue identificar com certeza qual campo está sendo corrigido E o novo valor, retorne "isCorrection": false.
- Para campos do tipo "boolean": true = concordância (sim, de acordo, concordo, ok, pode, claro). false = discordância.
- Para campos do tipo "number": extraia apenas o número da resposta mesmo que o paciente use palavras (ex: "tenho 28 anos" → 28). NUNCA invente números se o paciente não informou nenhum número válido.
- Para campos do tipo "choice": normalize para a opção mais próxima das disponíveis.
- NÃO adicione texto fora do JSON. Retorne APENAS o objeto JSON bruto.`;

  try {
    const response = await generateLLMResponse(history, VALIDATION_PROMPT, 0.1);
    const clean = response.trim();
    const startIdx = clean.indexOf('{');
    const endIdx = clean.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      const parsed = JSON.parse(clean.substring(startIdx, endIdx + 1));
      return { ...defaultResult, ...parsed };
    }
    throw new Error('A resposta da IA não contém um objeto JSON válido.');
  } catch (error: any) {
    console.error('[Triage Router] Erro no Agente Validador:', error.message);
    throw error;
  }
}

// ────────────────────────────────────────────────────────────
// AGENTE 1: Diálogo com o Paciente
// ────────────────────────────────────────────────────────────

async function runDialogueAgent(
  history: ChatMessage[],
  session: TriageSession,
  triageConfig: TriageConfig,
  currentField: TriageFieldConfig | null,
  validationResult: ValidationResult | null,
  isGreeting: boolean
): Promise<string> {
  const firstName = getFirstName(session.data['name'] || '');

  const collectedDataSummary = triageConfig.fields
    .filter(f => session.data[f.key] !== undefined && session.data[f.key] !== null && session.data[f.key] !== '')
    .map(f => `- ${f.label}: ${session.data[f.key]}`)
    .join('\n') || '(nenhum dado coletado ainda)';

  let nextActionInstruction = '';

  if (isGreeting) {
    nextActionInstruction = `O paciente enviou apenas uma saudação inicial. Apresente a ${triageConfig.clinicName} de forma breve e pergunte como pode ajudar. NÃO peça nenhum dado de triagem ainda.`;
  } else if (session.state === 'DONE') {
    nextActionInstruction = `A triagem foi concluída com sucesso. Agradeça o paciente e informe que a equipe de secretárias entrará em contato em breve para confirmar o horário da consulta.`;
  } else if (validationResult?.isFAQ) {
    const nextField = currentField;
    nextActionInstruction = `O paciente fez uma pergunta de dúvida/FAQ. Responda a dúvida de forma clara e direta com base nas regras da clínica. Após responder, convide-o sutilmente a continuar o agendamento e solicite o campo atual ("${nextField?.label}") de forma variada e humanizada a partir da pergunta base: "${nextField?.questionPrompt}"`;
  } else if (validationResult?.isCorrection) {
    const nextField = currentField;
    nextActionInstruction = `O paciente corrigiu um dado anterior. Confirme a correção com naturalidade e solicite o campo atual ("${nextField?.label}") de forma variada e humanizada a partir da pergunta base: "${nextField?.questionPrompt}"`;
  } else if (validationResult && !validationResult.isValid && validationResult.errorMessage) {
    nextActionInstruction = `A resposta do paciente foi inválida para o campo "${currentField?.label}". Com base no erro: "${validationResult.errorMessage}", oriente o paciente e solicite o dado novamente de forma humana, variada e amigável, sem repetições de perguntas e sem copiar a pergunta base ao pé da letra.`;
  } else if (currentField) {
    nextActionInstruction = `Reconheça a informação fornecida com naturalidade (se aplicável). Em seguida, colete APENAS E EXCLUSIVAMENTE o próximo campo: "${currentField.label}". Para fazer isso, varie, reescreva e humanize de forma natural e amigável a pergunta base ("${currentField.questionPrompt}"), sem copiar a pergunta base ao pé da letra. É EXPRESSAMENTE PROIBIDO solicitar, perguntar ou adiantar qualquer outro dado ou campo futuro (como convênio, carteirinha, idade, queixa, etc.) nesta mensagem. Pergunte APENAS pelo campo solicitado.`;
  }

  const DIALOGUE_PROMPT = `Você é o Assistente Virtual da ${triageConfig.clinicName} (${triageConfig.doctorName}).
Use um tom profissional, sério, respeitoso, formal e acolhedor. NUNCA utilize emojis ou expressões informais.
Não insira exemplos ou exemplos práticos em suas perguntas.
Refira-se ao paciente pelo primeiro nome (${firstName !== 'Paciente' ? firstName : 'o paciente'}) quando souber o nome.
Lembre-se que estamos prospectando clientes — não seja insistente ou robótico.

FAQ E REGRAS DA CLÍNICA:
${triageConfig.faqs}

DADOS JÁ COLETADOS DO PACIENTE:
${collectedDataSummary}

ESTADO ATUAL: ${session.state}

SUA INSTRUÇÃO PARA ESTA RESPOSTA:
${nextActionInstruction}

REGRAS DE CONVERSAÇÃO CRÍTICAS:
- NUNCA mencione termos internos como "etapas", "triagem", "campos", "fases", "formulário".
- NUNCA diga "pulando a etapa da carteirinha" ou similar.
- Ao pedir dados, varie as palavras e a estrutura da pergunta de forma humana e dinâmica, usando o questionPrompt fornecido como guia de objetivo, sem repeti-lo de forma idêntica e sem ser repetitivo.
- Você deve solicitar APENAS E EXCLUSIVAMENTE o único campo de informação solicitado na instrução. É terminantemente PROIBIDO pedir mais de uma informação por vez ou adiantar perguntas sobre outros dados futuros (como convênio, carteirinha ou queixa).
- NUNCA invente ou presuma informações sobre o paciente que ele não tenha dito de forma clara.
- Responda APENAS ao que foi solicitado na instrução acima. Seja conciso e natural.
- Você é estritamente um assistente de triagem e esclarecimento de dúvidas da FAQ. Você NUNCA deve oferecer horários ou vagas específicas da agenda da clínica para escolha do paciente, sugerir datas, nem tentar realizar, agendar ou confirmar marcações de consultas. A marcação de datas/horários é efetuada exclusivamente de forma manual pelas secretárias humanas da clínica após a conclusão total da triagem.
- Qualquer informação sobre horários de atendimento ou grade de vagas presente na FAQ deve ser usada apenas para responder a perguntas informativas do paciente (ex: 'quais dias o doutor atende?'), mas NUNCA para iniciar uma negociação de horários ou tentar agendar.

FORMATAÇÃO WHATSAPP OBRIGATÓRIA:
- Use *negrito* (asterisco) para destacar informações importantes, como nomes de convênios, regras da clínica ou campos solicitados.
- Use _itálico_ (underline) apenas para ênfase leve e discreta quando necessário.
- Quebre o texto em parágrafos curtos (máximo 3 linhas cada) com linha em branco entre eles. NUNCA envie blocos de texto longos sem quebra.
- Quando listar múltiplas opções ou itens, use lista com hífen: "- item" em linhas separadas.
- NUNCA use acentos graves, tachado ou monoespaçado nas respostas.
- Seja conciso: prefira 2-3 parágrafos curtos a 1 parágrafo longo.`;

  try {
    const response = await generateLLMResponse(history, DIALOGUE_PROMPT, 0.2);
    if (!response || response.trim() === '') {
      throw new Error('A resposta do agente de diálogo está vazia.');
    }
    return response.trim();
  } catch (error: any) {
    console.error('[Triage Router] Erro no Agente de Diálogo:', error.message);
    throw error;
  }
}

// ────────────────────────────────────────────────────────────
// Função Principal: Roteador de Mensagens
// ────────────────────────────────────────────────────────────

export async function routeTriageMessage(session: TriageSession, messageText: string): Promise<string> {
  const cleanPhone = session.phone.replace(/\D/g, '');
  const textTrimmed = messageText.trim();
  const textLower = textTrimmed.toLowerCase();

  // Salva o estado inicial completo para permitir reverter em caso de falha (Fail-Closed)
  const originalState = session.state;
  const originalData = JSON.parse(JSON.stringify(session.data));
  const originalUpdatedAt = session.updatedAt ? new Date(session.updatedAt) : new Date();

  // Carrega a configuração dinâmica
  const triageConfig = loadTriageConfig();

  const stateBefore = session.state;

  // Reinicialização
  if (textLower === 'reiniciar') {
    session.state = 'START';
    session.data = {};
    session.updatedAt = new Date();
    return triageConfig.welcomeMessage;
  }

  try {
    // Carrega histórico e evita duplicação da última mensagem
    const history = getRecentHistory(cleanPhone, 10);
    const lastHistoryMsg = history[history.length - 1];
    if (!lastHistoryMsg || lastHistoryMsg.role !== 'user' || lastHistoryMsg.content !== textTrimmed) {
      history.push({ role: 'user', content: textTrimmed });
    }

    // Saudação inicial — não inicia triagem ainda
    const isGreeting = session.state === 'START' && isSimpleGreeting(textTrimmed);
    if (isGreeting) {
      return triageConfig.welcomeMessage;
    }

    // Se ainda está em START (mas não é só saudação), determina o estado inicial
    if (session.state === 'START') {
      updateDynamicSessionState(session, triageConfig);
    }

    // Obtém o campo atual sendo coletado
    const currentField = getNextUnfilledField(session, triageConfig);

    let validationResult: ValidationResult | null = null;

    // Se há um campo pendente, executa o Agente de Validação
    if (currentField && session.state !== 'START') {
      console.log(`[Triage Router] Agente Validador ativado para campo: ${currentField.key}`);
      validationResult = await runValidationAgent(history, currentField, triageConfig, session);
      console.log(`[Triage Router] Resultado da validação:`, JSON.stringify(validationResult));

      if (validationResult.isCorrection && validationResult.correctedFieldKey && validationResult.correctedFieldValue !== null && validationResult.correctedFieldValue !== undefined && validationResult.correctedFieldValue !== '') {
        // Aplica a correção SOMENTE se o novo valor foi fornecido e é válido
        const oldValue = session.data[validationResult.correctedFieldKey];
        session.data[validationResult.correctedFieldKey] = validationResult.correctedFieldValue;
        session.updatedAt = new Date();
        console.log(`[Triage Router] Correção aplicada: ${validationResult.correctedFieldKey}: "${oldValue}" → "${validationResult.correctedFieldValue}"`);
        // Recalcula o estado após correção
        updateDynamicSessionState(session, triageConfig);
      } else if (validationResult.isCorrection) {
        // Correção com valor nulo — ignora e trata como entrada inválida
        console.warn(`[Triage Router] Correção IGNORADA (correctedFieldValue nulo/vazio). Tratando como resposta inválida para o campo atual.`);
        validationResult.isCorrection = false;
      } else if (!validationResult.isFAQ && validationResult.isValid && validationResult.extractedValue !== null) {
        // Aplica o valor extraído ao campo atual
        session.data[currentField.key] = validationResult.extractedValue;
        session.updatedAt = new Date();
        console.log(`[Triage Router] Campo preenchido: ${currentField.key} = ${validationResult.extractedValue}`);

        // Recalcula o estado — pode pular campos ou ir para DONE
        updateDynamicSessionState(session, triageConfig);
      }
      // Se isFAQ ou inválido: estado permanece travado no campo atual
      if (validationResult && validationResult.isFAQ && stateBefore === 'START') {
        session.state = 'START';
        console.log(`[Triage Router] FAQ detectado no estado START. Revertendo estado da sessão para START.`);
      }
    }

    // Obtém o próximo campo após possível avanço
    const nextField = getNextUnfilledField(session, triageConfig);

    // Executa o Agente de Diálogo para gerar a resposta
    const response = await runDialogueAgent(history, session, triageConfig, nextField, validationResult, false);

    // Se a triagem foi concluída nesta rodada, envia resumo ao médico
    if (session.state === 'DONE' && stateBefore !== 'DONE') {
      console.log(`[Triage Router] Triagem concluída para ${session.phone}. Enviando resumo ao médico...`);
      const summary = buildTriageSummary(session, triageConfig);
      if (config.BOOKING_MODE === 'manual') {
        const docPhone = config.DOCTOR_PHONE || '';
        if (docPhone) {
          sendWhatsAppMessage(docPhone, summary).catch(err => {
            console.error(`[Triage Router] Erro ao enviar resumo de triagem ao médico:`, err);
          });
        }
      }
    }

    return response;
  } catch (error: any) {
    // Fail-Closed: Qualquer erro no LLM (indisponibilidade, erro de parsing, etc.) cancela as alterações e reverte o estado da sessão
    console.error(`[Triage Router] Falha Crítica de Processamento (Fail-Closed). Revertendo sessão de ${session.phone} para o estado anterior. Erro:`, error.message);
    
    session.state = originalState;
    session.data = originalData;
    session.updatedAt = originalUpdatedAt;

    return 'Desculpe o inconveniente. Estamos passando por uma instabilidade temporária no sistema. Por favor, tente novamente mais tarde.';
  }
}
