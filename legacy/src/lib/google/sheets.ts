import { sheets } from './client';
import * as dotenv from 'dotenv';
import { validateCpf } from '../utils/cpf-validator';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || '';

/**
 * Inicializa a planilha criando as abas 'Pacientes' e 'Financeiro' caso não existam
 */
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
    
    // Verificar aba Pacientes
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
      // Adicionar cabeçalho (com CPF agora)
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Pacientes!A1:F1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['ID', 'Nome', 'CPF', 'WhatsApp', 'Data Cadastro', 'Link Prontuario']]
        }
      });
      console.log('Google Sheets: Aba "Pacientes" criada com cabeçalhos contendo CPF.');
    } else {
      // Se a aba já existe, verifica se precisa de migração para incluir a coluna "CPF"
      const pacientesRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Pacientes!A1:F1',
      });
      const currentHeaders = pacientesRes.data.values?.[0] || [];
      if (currentHeaders.length > 0 && !currentHeaders.includes('CPF')) {
        console.log('Google Sheets: Detectada planilha antiga sem coluna CPF. Iniciando migração...');
        
        // Busca todas as linhas existentes
        const allRowsRes = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Pacientes!A:E',
        });
        const allRows = allRowsRes.data.values || [];
        
        const migratedRows: any[][] = [];
        // Novo cabeçalho
        migratedRows.push(['ID', 'Nome', 'CPF', 'WhatsApp', 'Data Cadastro', 'Link Prontuario']);
        
        // Migra as linhas de dados (insere coluna CPF vazia no índice 2)
        for (let i = 1; i < allRows.length; i++) {
          const row = allRows[i];
          migratedRows.push([
            row[0] || '', // ID
            row[1] || '', // Nome
            '',           // CPF (vazio)
            row[2] || '', // WhatsApp
            row[3] || '', // Data Cadastro
            row[4] || ''  // Link Prontuario
          ]);
        }
        
        // Limpa a planilha antiga e escreve os dados migrados
        await sheets.spreadsheets.values.clear({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Pacientes!A:Z',
        });
        
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `Pacientes!A1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: migratedRows
          }
        });
        console.log('Google Sheets: Migração concluída com sucesso! Coluna CPF adicionada.');
      }
    }

    // Verificar aba Financeiro
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
      // Adicionar cabeçalho
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
  } catch (error) {
    console.error('Erro ao inicializar abas da Planilha:', error);
  }
}

/**
 * Busca paciente pelo número do WhatsApp
 */
export async function findPatientByWhatsApp(whatsapp: string): Promise<any | null> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Pacientes!A:F',
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) return null;

    // Normaliza whatsapp do banco para comparar (apenas números)
    const cleanPhone = whatsapp.replace(/\D/g, '');

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowPhone = (row[3] || '').replace(/\D/g, ''); // index 3 para WhatsApp
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
    console.error('Erro ao procurar paciente por WhatsApp:', error);
    return null;
  }
}

/**
 * Busca paciente pelo CPF (exato, apenas números)
 */
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
      const rowCpf = (row[2] || '').replace(/\D/g, ''); // index 2 para CPF
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
    console.error('Erro ao procurar paciente por CPF:', error);
    return null;
  }
}

/**
 * Busca um paciente por nome, telefone ou CPF na planilha
 */
export async function findPatient(query: string): Promise<any | null> {
  if (!SPREADSHEET_ID) {
    console.error('Google Sheets: SPREADSHEET_ID não definido no arquivo .env');
    return null;
  }

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

      // Se a query contiver apenas números
      if (cleanQueryNumbers && cleanQueryNumbers.length >= 8) {
        // Busca por CPF
        if (rowCpf === cleanQueryNumbers) {
          return {
            id: row[0],
            name: row[1],
            cpf: row[2],
            whatsapp: row[3],
            createdAt: row[4],
            ehrLink: row[5]
          };
        }
        // Busca por WhatsApp
        if (rowPhone === cleanQueryNumbers || rowPhone.includes(cleanQueryNumbers) || cleanQueryNumbers.includes(rowPhone)) {
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

      // Busca por nome (correspondência parcial)
      if (rowName.includes(cleanQuery) || cleanQuery.includes(rowName)) {
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
    console.error('Erro ao procurar paciente por consulta genérica:', error);
    return null;
  }
}

/**
 * Cadastra um novo paciente na planilha
 */
export async function addPatient(name: string, whatsapp: string, cpf: string = '', ehrLink: string = ''): Promise<any> {
  try {
    const cleanPhone = whatsapp.replace(/\D/g, '');
    const cleanCpf = cpf.replace(/\D/g, '');

    // Validação matemática do CPF
    if (!cleanCpf) {
      throw new Error("Erro: O CPF é obrigatório para cadastrar um paciente.");
    }
    if (!validateCpf(cleanCpf)) {
      throw new Error("Erro: O CPF informado (" + cpf + ") é inválido. Por favor, digite um CPF correto.");
    }

    // 1. Tenta achar por CPF
    if (cleanCpf) {
      const existingCpf = await findPatientByCpf(cleanCpf);
      if (existingCpf) return existingCpf;
    }

    // 2. Tenta achar por WhatsApp
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
    console.error('Erro ao adicionar paciente:', error);
    throw error;
  }
}

/**
 * Atualiza o link do prontuário do paciente no Sheets
 */
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
      const rowPhone = (rows[i][3] || '').replace(/\D/g, ''); // index 3
      if (rowPhone === cleanPhone) {
        // Atualiza a coluna F (índice 5)
        const rowIndex = i + 1; // 1-indexed para o Sheets
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Pacientes!F' + rowIndex,
          valueInputOption: 'RAW',
          requestBody: {
            values: [[ehrLink]]
          }
        });
        console.log('Google Sheets: Link do prontuário atualizado para o paciente da linha ' + rowIndex + '.');
        return;
      }
    }
  } catch (error) {
    console.error('Erro ao atualizar link de prontuário do paciente:', error);
  }
}

/**
 * Atualiza o CPF do paciente no Sheets
 */
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
      const rowPhone = (rows[i][3] || '').replace(/\D/g, ''); // index 3
      if (rowPhone === cleanPhone) {
        // Atualiza a coluna C (índice 2)
        const rowIndex = i + 1; // 1-indexed para o Sheets
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
    console.error('Erro ao atualizar CPF do paciente:', error);
  }
}

/**
 * Registra uma transação financeira (Receita ou Despesa)
 */
export async function addFinancialTransaction(
  type: 'Receita' | 'Despesa',
  description: string,
  value: number,
  paymentMethod: string = 'PIX'
): Promise<void> {
  try {
    const date = new Date().toLocaleDateString('pt-BR');
    // Formata o valor para o padrão brasileiro
    const formattedValue = value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Financeiro!A:E',
      valueInputOption: 'USER_ENTERED', // USER_ENTERED para formatar números e datas corretamente na planilha
      requestBody: {
        values: [[date, type, description, formattedValue, paymentMethod]]
      }
    });

    console.log(`Google Sheets: Transação de ${type} registrada: R$ ${formattedValue} (${description}).`);
  } catch (error) {
    console.error('Erro ao registrar transação financeira:', error);
    throw error;
  }
}

/**
 * Busca o resumo financeiro mensal
 */
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
      // Converte formato BR (ex: "1.250,50") para número float JS
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
    console.error('Erro ao buscar resumo financeiro:', error);
    return { totalIn: 0, totalOut: 0, balance: 0 };
  }
}
