import { sheets, setTokenValid } from './client';
import { config } from '../../config/env-manager';
import { validateCpf } from '../../utils/cpf-validator';

const SPREADSHEET_ID = config.GOOGLE_SPREADSHEET_ID || '';

/**
 * Tratador de erros centralizado para chamadas do Google API (Sheets).
 * Identifica se o erro é de autenticação (ex: token revogado ou expirado) e invalida o token local.
 */
function handleGoogleApiError(error: any, context: string) {
  console.error(`Erro em Google Sheets (${context}):`, error);
  
  const errStr = String(error?.message || '').toLowerCase();
  const errDesc = String(error?.response?.data?.error_description || '').toLowerCase();
  const status = error?.status || error?.response?.status;

  const isAuthError = errStr.includes('invalid_grant') || 
                      errStr.includes('auth') || 
                      errStr.includes('expired') ||
                      errStr.includes('revoked') ||
                      errDesc.includes('invalid_grant') ||
                      errDesc.includes('auth') ||
                      errDesc.includes('expired') ||
                      errDesc.includes('revoked') ||
                      status === 400 || 
                      status === 401;

  if (isAuthError) {
    console.warn(`[Google OAuth] Token de autenticação identificado como inválido durante: ${context}`);
    setTokenValid(false);
  }
}

export async function initializeSheets() {
  if (!SPREADSHEET_ID) {
    console.error('Google Sheets: SPREADSHEET_ID não definido no arquivo .env');
    return;
  }

  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const sheetsNames = meta.data.sheets?.map(s => s.properties?.title) || [];
    
    if (!sheetsNames.includes('Pacientes')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: 'Pacientes' }
              }
            }
          ]
        }
      });
      
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Pacientes!A1:F1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['ID', 'Nome', 'CPF', 'WhatsApp', 'Data Cadastro', 'Link Prontuario']]
        }
      });
      console.log('Google Sheets: Aba "Pacientes" criada com cabeçalhos.');
    }

    if (!sheetsNames.includes('Financeiro')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: 'Financeiro' }
              }
            }
          ]
        }
      });
      
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Financeiro!A1:E1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Data', 'Tipo', 'Descrição', 'Valor', 'Forma Pagamento']]
        }
      });
      console.log('Google Sheets: Aba "Financeiro" criada com cabeçalhos.');
    }
    setTokenValid(true); // Se inicializou com sucesso, garante que o status do token é válido
  } catch (error) {
    handleGoogleApiError(error, 'inicializar abas da Planilha');
  }
}

export async function findPatientByWhatsApp(whatsapp: string): Promise<any | null> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Pacientes!A:F',
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return null;

    const cleanPhone = whatsapp.replace(/\D/g, '');

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowPhone = (row[3] || '').replace(/\D/g, '');
      if (rowPhone === cleanPhone || rowPhone.includes(cleanPhone) || cleanPhone.includes(rowPhone)) {
        return {
          id: row[0],
          name: row[1],
          cpf: row[2],
          whatsapp: row[3],
          createdAt: row[4],
          ehrLink: row[5]
        };
      }
    }
    return null;
  } catch (error) {
    handleGoogleApiError(error, 'procurar paciente por WhatsApp');
    return null;
  }
}

export async function findPatientByCpf(cpf: string): Promise<any | null> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Pacientes!A:F',
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return null;

    const cleanCpf = cpf.replace(/\D/g, '');
    if (!cleanCpf) return null;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowCpf = (row[2] || '').replace(/\D/g, '');
      if (rowCpf === cleanCpf) {
        return {
          id: row[0],
          name: row[1],
          cpf: row[2],
          whatsapp: row[3],
          createdAt: row[4],
          ehrLink: row[5]
        };
      }
    }
    return null;
  } catch (error) {
    handleGoogleApiError(error, 'procurar paciente por CPF');
    return null;
  }
}

export async function findPatient(query: string): Promise<any | null> {
  if (!SPREADSHEET_ID) return null;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Pacientes!A:F',
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return null;

    const cleanQuery = query.toLowerCase().trim();
    const cleanQueryNumbers = query.replace(/\D/g, '');

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowName = (row[1] || '').toLowerCase().trim();
      const rowCpf = (row[2] || '').replace(/\D/g, '');
      const rowPhone = (row[3] || '').replace(/\D/g, '');

      if (cleanQueryNumbers && cleanQueryNumbers.length >= 8) {
        if (rowCpf === cleanQueryNumbers) {
          return { id: row[0], name: row[1], cpf: row[2], whatsapp: row[3], createdAt: row[4], ehrLink: row[5] };
        }
        if (rowPhone === cleanQueryNumbers || rowPhone.includes(cleanQueryNumbers) || cleanQueryNumbers.includes(rowPhone)) {
          return { id: row[0], name: row[1], cpf: row[2], whatsapp: row[3], createdAt: row[4], ehrLink: row[5] };
        }
      }

      if (rowName.includes(cleanQuery) || cleanQuery.includes(rowName)) {
        return { id: row[0], name: row[1], cpf: row[2], whatsapp: row[3], createdAt: row[4], ehrLink: row[5] };
      }
    }
    return null;
  } catch (error) {
    handleGoogleApiError(error, 'procurar paciente por consulta genérica');
    return null;
  }
}

export async function addPatient(name: string, whatsapp: string, cpf: string = '', ehrLink: string = ''): Promise<any> {
  try {
    const cleanPhone = whatsapp.replace(/\D/g, '');
    const cleanCpf = cpf.replace(/\D/g, '');

    if (!cleanCpf) {
      throw new Error("Erro: O CPF é obrigatório para cadastrar um paciente.");
    }
    if (!validateCpf(cleanCpf)) {
      throw new Error("Erro: O CPF informado (" + cpf + ") é inválido.");
    }

    if (cleanCpf) {
      const existingCpf = await findPatientByCpf(cleanCpf);
      if (existingCpf) return existingCpf;
    }

    const existingPhone = await findPatientByWhatsApp(cleanPhone);
    if (existingPhone) {
      if (!existingPhone.cpf && cleanCpf) {
        await updatePatientCpfInSheets(cleanPhone, cleanCpf);
        existingPhone.cpf = cleanCpf;
      }
      return existingPhone;
    }

    const id = `PAC_${Date.now()}`;
    const date = new Date().toLocaleDateString('pt-BR');
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Pacientes!A:F',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[id, name, cpf, whatsapp, date, ehrLink]]
      }
    });

    console.log('Google Sheets: Paciente ' + name + ' adicionado com ID ' + id + '.');
    return { id, name, cpf, whatsapp, createdAt: date, ehrLink };
  } catch (error) {
    handleGoogleApiError(error, 'adicionar paciente');
    throw error;
  }
}

export async function updatePatientEhrLink(whatsapp: string, ehrLink: string): Promise<void> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Pacientes!A:F',
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return;

    const cleanPhone = whatsapp.replace(/\D/g, '');

    for (let i = 1; i < rows.length; i++) {
      const rowPhone = (rows[i][3] || '').replace(/\D/g, '');
      if (rowPhone === cleanPhone) {
        const rowIndex = i + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Pacientes!F' + rowIndex,
          valueInputOption: 'RAW',
          requestBody: {
            values: [[ehrLink]]
          }
        });
        console.log('Google Sheets: Link do prontuário atualizado para a linha ' + rowIndex + '.');
        return;
      }
    }
  } catch (error) {
    handleGoogleApiError(error, 'atualizar link de prontuário do paciente');
  }
}

export async function updatePatientCpfInSheets(whatsapp: string, cpf: string): Promise<void> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Pacientes!A:F',
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return;

    const cleanPhone = whatsapp.replace(/\D/g, '');

    for (let i = 1; i < rows.length; i++) {
      const rowPhone = (rows[i][3] || '').replace(/\D/g, '');
      if (rowPhone === cleanPhone) {
        const rowIndex = i + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Pacientes!C' + rowIndex,
          valueInputOption: 'RAW',
          requestBody: {
            values: [[cpf]]
          }
        });
        console.log('Google Sheets: CPF do paciente atualizado para a linha ' + rowIndex + '.');
        return;
      }
    }
  } catch (error) {
    handleGoogleApiError(error, 'atualizar CPF do paciente');
  }
}

export async function addFinancialTransaction(
  type: 'Receita' | 'Despesa',
  description: string,
  value: number,
  paymentMethod: string = 'PIX'
): Promise<void> {
  try {
    const date = new Date().toLocaleDateString('pt-BR');
    const formattedValue = value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Financeiro!A:E',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[date, type, description, formattedValue, paymentMethod]]
      }
    });

    console.log(`Google Sheets: Transação de ${type} registrada: R$ ${formattedValue} (${description}).`);
  } catch (error) {
    handleGoogleApiError(error, 'registrar transação financeira');
    throw error;
  }
}

export async function getFinancialSummary(): Promise<{ totalIn: number; totalOut: number; balance: number }> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Financeiro!A:E',
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) {
      return { totalIn: 0, totalOut: 0, balance: 0 };
    }

    let totalIn = 0;
    let totalOut = 0;

    for (let i = 1; i < rows.length; i++) {
      const type = rows[i][1];
      let valueStr = rows[i][3] || '0';
      valueStr = valueStr.replace(/\./g, '').replace(',', '.');
      const value = parseFloat(valueStr) || 0;

      if (type === 'Receita') {
        totalIn += value;
      } else if (type === 'Despesa') {
        totalOut += value;
      }
    }

    return {
      totalIn,
      totalOut,
      balance: totalIn - totalOut
    };
  } catch (error) {
    handleGoogleApiError(error, 'buscar resumo financeiro');
    return { totalIn: 0, totalOut: 0, balance: 0 };
  }
}
