import { config } from '../../config/env-manager';
import { sendWhatsAppMessage } from '../../services/whatsapp/client';
import * as fs from 'fs';
import * as path from 'path';

const TRIAGE_CONFIG_FILE = path.join(process.cwd(), 'triage_config.json');

// ────────────────────────────────────────────────────────────
// Tipos e Interfaces para Configuração Dinâmica
// ────────────────────────────────────────────────────────────

export interface FieldSkipCondition {
  field: string;
  value: string;
  autoFill: string;
}

export interface TriageFieldConfig {
  key: string;
  label: string;
  type: 'string' | 'number' | 'text' | 'choice' | 'boolean';
  choices?: string[];
  questionPrompt: string;
  validationInstruction: string;
  order: number;
  required: boolean;
  skipCondition?: FieldSkipCondition;
}

export interface TriageConfig {
  welcomeMessage: string;
  faqs: string;
  clinicName: string;
  doctorName: string;
  fields: TriageFieldConfig[];
}

// ────────────────────────────────────────────────────────────
// Carregamento de Configuração
// ────────────────────────────────────────────────────────────

export function loadTriageConfig(): TriageConfig {
  try {
    if (fs.existsSync(TRIAGE_CONFIG_FILE)) {
      const data = fs.readFileSync(TRIAGE_CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(data) as TriageConfig;
      // Ordena os campos por weight
      parsed.fields = parsed.fields.sort((a, b) => a.order - b.order);
      return parsed;
    }
  } catch (error) {
    console.error('[Triage Flow] Erro ao carregar triage_config.json:', error);
  }
  // Retorna config padrão mínima
  return {
    welcomeMessage: 'Olá! Como posso ajudar você hoje?',
    faqs: '',
    clinicName: 'Clínica Médica',
    doctorName: 'Dr. Médico',
    fields: []
  };
}

export function saveTriageConfig(triageConfig: TriageConfig): void {
  fs.writeFileSync(TRIAGE_CONFIG_FILE, JSON.stringify(triageConfig, null, 2), 'utf8');
}

// ────────────────────────────────────────────────────────────
// Sessão de Triagem Genérica
// ────────────────────────────────────────────────────────────

export class TriageSession {
  phone: string;
  state: string;
  data: Record<string, any>;
  updatedAt: Date;
  humanTakeover?: boolean;

  constructor(phone: string) {
    this.phone = phone;
    this.state = 'START';
    this.data = {};
    this.updatedAt = new Date();
    this.humanTakeover = false;
  }
}

// ────────────────────────────────────────────────────────────
// Helpers de Estado
// ────────────────────────────────────────────────────────────

/**
 * Retorna o primeiro nome de um nome completo para uso na conversa
 */
export function getFirstName(fullName: any): string {
  if (!fullName || typeof fullName !== 'string') return 'Paciente';
  const parts = fullName.trim().split(/\s+/);
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
}

/**
 * Retorna o primeiro campo pendente de preenchimento (respeitando skipCondition)
 */
export function getNextUnfilledField(session: TriageSession, triageConfig: TriageConfig): TriageFieldConfig | null {
  const sortedFields = [...triageConfig.fields].sort((a, b) => a.order - b.order);
  const isPrescriptionFlow = session.data && session.data['flow'] === 'prescription';

  for (const field of sortedFields) {
    if (isPrescriptionFlow) {
      // No fluxo de receita, os únicos campos coletados são name e medication.
      // Os demais são auto-preenchidos e pulados para otimizar o atendimento.
      if (field.key !== 'name' && field.key !== 'medication') {
        if (!session.data[field.key]) {
          if (field.key === 'isExistingPatient') session.data[field.key] = true;
          else if (field.key === 'age') session.data[field.key] = 0;
          else if (field.key === 'healthPlan') session.data[field.key] = 'Particular';
          else if (field.key === 'cardNumber') session.data[field.key] = 'Não aplicável (Fluxo de Receita)';
          else if (field.key === 'complaint') session.data[field.key] = 'Solicitação de Receita Controlada';
          else if (field.key === 'agreedToTerms') session.data[field.key] = true;
        }
        continue;
      }
    }

    const isExistingPatient = session.data && (session.data['isExistingPatient'] === true || String(session.data['isExistingPatient']).toLowerCase() === 'true');
    if (isExistingPatient) {
      // Se já é paciente antigo, pulamos idade (age) e carteirinha (cardNumber).
      // A clínica já tem esses dados no prontuário físico/digital.
      if (field.key === 'age') {
        if (session.data[field.key] === undefined || session.data[field.key] === null) {
          session.data[field.key] = 30; // Default de idade adulta para verificação de cotas da agenda
        }
        continue;
      }
      if (field.key === 'cardNumber') {
        if (session.data[field.key] === undefined || session.data[field.key] === null) {
          session.data[field.key] = 'Já cadastrado no prontuário (Paciente Antigo)';
        }
        continue;
      }
    }

    // Verifica se o campo tem condição de pulo
    if (field.skipCondition) {
      const { field: conditionField, value: conditionValue, autoFill } = field.skipCondition;
      const currentValue = session.data[conditionField];
      if (currentValue && String(currentValue).toLowerCase() === conditionValue.toLowerCase()) {
        // Auto-preenche e pula o campo
        if (!session.data[field.key]) {
          session.data[field.key] = autoFill;
        }
        continue;
      } else {
        // Se a condição de pulo não for atendida e o campo tiver o valor autofill, limpa-o
        if (session.data[field.key] === autoFill) {
          delete session.data[field.key];
        }
      }
    }

    // Verifica se o campo está preenchido
    const value = session.data[field.key];
    const isEmpty = value === undefined || value === null || value === '';
    
    if (isEmpty && field.required) {
      return field;
    }
  }

  return null; // Todos os campos preenchidos
}

/**
 * Recalcula e atualiza o estado dinâmico da sessão
 */
export function updateDynamicSessionState(session: TriageSession, triageConfig: TriageConfig): void {
  if (session.state === 'DONE') return;

  const nextField = getNextUnfilledField(session, triageConfig);
  if (nextField) {
    session.state = `AWAITING_FIELD:${nextField.key}`;
  } else {
    session.state = 'DONE';
  }
}

/**
 * Gera um resumo textual dos dados coletados na sessão para o médico
 */
export function buildTriageSummary(session: TriageSession, triageConfig: TriageConfig): string {
  const lines: string[] = [
    `📋 *[NOVA TRIAGEM CONCLUÍDA - WHATSAPP]*\n`,
    `📞 *WhatsApp:* ${session.phone}`,
    `📅 *Data da Triagem:* ${new Date().toLocaleDateString('pt-BR')}\n`
  ];

  for (const field of triageConfig.fields.sort((a, b) => a.order - b.order)) {
    const value = session.data[field.key];
    if (value !== undefined && value !== null && value !== '') {
      lines.push(`*${field.label}:* ${value}`);
    }
  }

  return lines.join('\n');
}

// Mantido para compatibilidade com testes legados
export enum TriageState {
  START = 'START',
  AWAITING_NAME = 'AWAITING_NAME',
  AWAITING_AGE = 'AWAITING_AGE',
  AWAITING_PLAN = 'AWAITING_PLAN',
  AWAITING_CARD = 'AWAITING_CARD',
  AWAITING_COMPLAINT = 'AWAITING_COMPLAINT',
  AWAITING_MEDICATION = 'AWAITING_MEDICATION',
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  DONE = 'DONE'
}

// Função legada mantida para testes
export function processTriageStep(session: TriageSession, input: string): string {
  return `[Fluxo legado substituído por Dual-Agent] Input: ${input}`;
}

// Função legada mantida para compatibilidade
export function updateSessionState(session: TriageSession): void {
  // No-op — use updateDynamicSessionState
}
