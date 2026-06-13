import * as dotenv from 'dotenv';
import * as path from 'path';

// Carrega as variáveis do .env na raiz do projeto
dotenv.config({ path: path.join(process.cwd(), '.env') });

export interface EnvConfig {
  PORT: number;
  LLM_PROVIDER: 'lm-studio' | 'gemini';
  LLM_API_BASE_URL: string;
  LLM_MODEL_NAME: string;
  LLM_API_KEY: string;
  GEMINI_API_KEY: string;
  BOOKING_MODE: 'manual' | 'auto';
  DOCTOR_PHONE: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_VERIFY_TOKEN: string;
  GOOGLE_SPREADSHEET_ID: string;
  GOOGLE_CALENDAR_ID: string;
}

export const config: EnvConfig = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  LLM_PROVIDER: (process.env.LLM_PROVIDER as 'lm-studio' | 'gemini') || 'lm-studio',
  LLM_API_BASE_URL: process.env.LLM_API_BASE_URL || 'http://localhost:1234/v1',
  LLM_MODEL_NAME: process.env.LLM_MODEL_NAME || 'gemma-3',
  LLM_API_KEY: process.env.LLM_API_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  BOOKING_MODE: (process.env.BOOKING_MODE as 'manual' | 'auto') || 'manual',
  DOCTOR_PHONE: process.env.DOCTOR_PHONE || '',
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || '',
  GOOGLE_SPREADSHEET_ID: process.env.GOOGLE_SPREADSHEET_ID || '',
  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || 'primary',
};

// Validação simplificada das chaves fundamentais
export function validateEnv() {
  const missingKeys: string[] = [];
  
  if (!config.DOCTOR_PHONE) missingKeys.push('DOCTOR_PHONE');
  if (!config.GOOGLE_SPREADSHEET_ID) missingKeys.push('GOOGLE_SPREADSHEET_ID');
  
  if (config.LLM_PROVIDER === 'gemini' && !config.GEMINI_API_KEY) {
    missingKeys.push('GEMINI_API_KEY');
  }

  if (missingKeys.length > 0) {
    console.warn(`[CONFIG WARNING] Chaves de configuração ausentes no .env: ${missingKeys.join(', ')}`);
  }
}
