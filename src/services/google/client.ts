import { google } from 'googleapis';
import * as path from 'path';
import * as fs from 'fs';
import { config } from '../../config/env-manager';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';

const TOKENS_PATH = path.join(process.cwd(), 'tokens.json');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents'
];

// Cache de validade do token de acesso em memória (null = ainda não testado)
let isTokenValid: boolean | null = null;

export function setTokenValid(valid: boolean) {
  isTokenValid = valid;
}

export const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

export function loadSavedCredentialsIfExist() {
  try {
    if (fs.existsSync(TOKENS_PATH)) {
      const tokenContent = fs.readFileSync(TOKENS_PATH, 'utf8');
      const credentials = JSON.parse(tokenContent);
      oauth2Client.setCredentials(credentials);
      console.log('Google OAuth: Tokens anteriores carregados e configurados.');
      return true;
    }
  } catch (error) {
    console.error('Google OAuth: Falha ao carregar tokens anteriores:', error);
  }
  return false;
}

export function saveCredentials(credentials: any) {
  try {
    let existingCredentials = {};
    if (fs.existsSync(TOKENS_PATH)) {
      existingCredentials = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    }

    const finalCredentials = {
      ...existingCredentials,
      ...credentials
    };

    fs.writeFileSync(TOKENS_PATH, JSON.stringify(finalCredentials, null, 2));
    oauth2Client.setCredentials(finalCredentials);
    setTokenValid(true); // Se acabamos de salvar novos tokens, eles passam a ser considerados válidos
    console.log('Google OAuth: Novos tokens salvos com sucesso.');
  } catch (error) {
    console.error('Google OAuth: Erro ao salvar os tokens:', error);
  }
}

export function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
}

export function isGoogleAuthenticated() {
  const credentials = oauth2Client.credentials;
  const hasCreds = !!(credentials && (credentials.access_token || credentials.refresh_token));
  if (!hasCreds) return false;
  if (isTokenValid === false) return false;
  return true;
}

export const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
export const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
export const drive = google.drive({ version: 'v3', auth: oauth2Client });
export const docs = google.docs({ version: 'v1', auth: oauth2Client });

// Tenta carregar credenciais no boot
loadSavedCredentialsIfExist();
