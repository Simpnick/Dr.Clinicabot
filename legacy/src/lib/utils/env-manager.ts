import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

const envPath = path.join(process.cwd(), '.env');

/**
 * Obtém as configurações atuais do arquivo .env
 */
export function getEnvConfig(): Record<string, string> {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const config: Record<string, string> = {};
  
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.substring(0, idx).trim();
        let value = trimmed.substring(idx + 1).trim();
        // Remove aspas se houver
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.substring(1, value.length - 1);
        }
        config[key] = value;
      }
    }
  });
  return config;
}

/**
 * Atualiza chaves específicas no arquivo .env e recarrega na memória
 */
export function updateEnvConfig(updates: Record<string, string>): void {
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  const lines = content.split(/\r?\n/);
  const keysToUpdate = { ...updates };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.substring(0, idx).trim();
        if (key in keysToUpdate) {
          lines[i] = `${key}=${keysToUpdate[key]}`;
          delete keysToUpdate[key];
        }
      }
    }
  }

  // Adiciona chaves restantes que não existiam no arquivo
  Object.keys(keysToUpdate).forEach((key) => {
    lines.push(`${key}=${keysToUpdate[key]}`);
  });

  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');

  // Recarrega as variáveis de ambiente na memória do Node.js
  dotenv.config({ override: true });
}
