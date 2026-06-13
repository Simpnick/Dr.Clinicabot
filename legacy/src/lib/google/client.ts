import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';

const TOKENS_PATH = path.join(process.cwd(), 'tokens.json');

// Escopos necessários para acessar Agenda, Planilhas, Drive e Docs do usuário
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents'
];

// Inicializa o cliente OAuth2 do Google
export const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Tenta carregar tokens salvos anteriormente (Tokens persistidos)
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

// Salva os tokens recebidos no arquivo local
export function saveCredentials(credentials: any) {
  try {
    // Mesclar com credenciais antigas caso não inclua o refresh token (Google só envia o refresh token no primeiro login)
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
    console.log('Google OAuth: Novos tokens salvos com sucesso.');
  } catch (error) {
    console.error('Google OAuth: Erro ao salvar os tokens:', error);
  }
}

// Gera a URL do fluxo de autorização do Google
export function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Importante: garante o recebimento do Refresh Token
    scope: SCOPES,
    prompt: 'consent' // Garante que o consentimento seja exibido para forçar o envio do Refresh Token
  });
}

// Verifica se o cliente OAuth2 está devidamente autenticado
export function isGoogleAuthenticated() {
  const credentials = oauth2Client.credentials;
  return !!(credentials && (credentials.access_token || credentials.refresh_token));
}

// Exportar os clientes das APIs associados ao cliente OAuth2
export const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
export const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
export const drive = google.drive({ version: 'v3', auth: oauth2Client });
export const docs = google.docs({ version: 'v1', auth: oauth2Client });

// Tenta carregar credenciais existentes no boot
loadSavedCredentialsIfExist();
