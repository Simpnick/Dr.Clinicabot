import { drive, docs } from './client';
import * as dotenv from 'dotenv';

dotenv.config();

const PARENT_FOLDER_NAME = 'Prontuários Clínicos';

/**
 * Busca ou cria a pasta principal "Prontuários Clínicos" no Google Drive
 */
async function getOrCreateParentFolder(): Promise<string> {
  try {
    const listRes = await drive.files.list({
      q: `name = '${PARENT_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id)',
      spaces: 'drive'
    });

    const folders = listRes.data.files;
    if (folders && folders.length > 0 && folders[0].id) {
      return folders[0].id;
    }

    // Criar a pasta se não existir
    const createRes = await drive.files.create({
      requestBody: {
        name: PARENT_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    });

    console.log(`Google Drive: Pasta principal "${PARENT_FOLDER_NAME}" criada.`);
    return createRes.data.id || '';
  } catch (error) {
    console.error('Erro ao buscar/criar pasta no Google Drive:', error);
    throw error;
  }
}

/**
 * Busca ou cria o prontuário de um paciente (Google Doc) no Drive
 * Retorna o ID do documento e o link público de visualização
 */
export async function getOrCreatePatientDoc(
  patientName: string,
  patientPhone: string
): Promise<{ documentId: string; viewLink: string }> {
  try {
    const folderId = await getOrCreateParentFolder();
    const cleanPhone = patientPhone.replace(/\D/g, '');
    const docName = `Prontuario - ${patientName} (${cleanPhone})`;

    // Procurar se o documento já existe na pasta
    const listRes = await drive.files.list({
      q: `name = '${docName}' and '${folderId}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
      fields: 'files(id, webViewLink)',
      spaces: 'drive'
    });

    const files = listRes.data.files;
    if (files && files.length > 0 && files[0].id) {
      return {
        documentId: files[0].id,
        viewLink: files[0].webViewLink || ''
      };
    }

    // Se não existir, cria o Google Doc
    const docMetadata = await drive.files.create({
      requestBody: {
        name: docName,
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId]
      },
      fields: 'id, webViewLink'
    });

    const documentId = docMetadata.data.id || '';
    const viewLink = docMetadata.data.webViewLink || '';

    // Adiciona cabeçalho inicial ao documento recém-criado
    const today = new Date().toLocaleString('pt-BR');
    const headerText = 
`==================================================
PRONTUÁRIO CLÍNICO DIGITAL
==================================================
Paciente: ${patientName}
WhatsApp: ${patientPhone}
Data de Abertura: ${today}
--------------------------------------------------
Histórico de Evolução Clínica:
\n`;

    await docs.documents.batchUpdate({
      documentId: documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: {
                index: 1 // Insere no início
              },
              text: headerText
            }
          }
        ]
      }
    });

    console.log(`Google Drive: Novo documento de prontuário criado para ${patientName}.`);
    return { documentId, viewLink };
  } catch (error) {
    console.error('Erro ao buscar/criar prontuário do paciente:', error);
    throw error;
  }
}

/**
 * Adiciona uma anotação clínica (evolução) ao final do prontuário do paciente
 */
export async function appendClinicalNote(documentId: string, noteText: string): Promise<void> {
  try {
    // 1. Obter o documento para saber o índice do fim do arquivo
    const doc = await docs.documents.get({
      documentId: documentId
    });

    // O final do documento é dado pela última propriedade 'endIndex' do corpo
    const bodyContent = doc.data.body?.content || [];
    const lastElement = bodyContent[bodyContent.length - 1];
    const endIndex = (lastElement?.endIndex || 2) - 1; // Ajusta o index para inserir no final

    const now = new Date().toLocaleString('pt-BR');
    const noteFormatted = 
`\n--------------------------------------------------
REGISTRO DE EVOLUÇÃO CLÍNICA - ${now}
--------------------------------------------------
${noteText}\n`;

    // 2. Inserir o texto
    await docs.documents.batchUpdate({
      documentId: documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: {
                index: endIndex
              },
              text: noteFormatted
            }
          }
        ]
      }
    });

    console.log(`Google Docs: Anotação adicionada ao prontuário ${documentId}.`);
  } catch (error) {
    console.error('Erro ao adicionar anotação no prontuário:', error);
    throw error;
  }
}

const DOCS_FOLDER_NAME = 'Documentos Clínicos (Receitas e Atestados)';

/**
 * Busca ou cria a pasta principal "Documentos Clínicos (Receitas e Atestados)" no Google Drive
 */
async function getOrCreateDocsFolder(): Promise<string> {
  try {
    const listRes = await drive.files.list({
      q: `name = '${DOCS_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id)',
      spaces: 'drive'
    });

    const folders = listRes.data.files;
    if (folders && folders.length > 0 && folders[0].id) {
      return folders[0].id;
    }

    // Criar a pasta se não existir
    const createRes = await drive.files.create({
      requestBody: {
        name: DOCS_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    });

    console.log(`Google Drive: Pasta principal "${DOCS_FOLDER_NAME}" criada.`);
    return createRes.data.id || '';
  } catch (error) {
    console.error('Erro ao buscar/criar pasta de documentos no Google Drive:', error);
    throw error;
  }
}

/**
 * Gera um documento médico (Receituário ou Atestado Médico) no Google Drive
 */
export async function generatePrescriptionOrAtestado(
  patientName: string,
  docType: 'Receituário' | 'Atestado Médico',
  content: string
): Promise<{ documentId: string; viewLink: string }> {
  try {
    const folderId = await getOrCreateDocsFolder();
    const todayStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    const docName = `${docType} - ${patientName} (${todayStr})`;

    // Cria o Google Doc
    const docMetadata = await drive.files.create({
      requestBody: {
        name: docName,
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId]
      },
      fields: 'id, webViewLink'
    });

    const documentId = docMetadata.data.id || '';
    const viewLink = docMetadata.data.webViewLink || '';

    const today = new Date().toLocaleString('pt-BR');
    
    let text = '';
    if (docType === 'Atestado Médico') {
      text = `==================================================
ATESTADO MÉDICO
==================================================

Atesto, para os devidos fins de direito, que o(a) Sr(a). ${patientName} esteve sob meus cuidados clínicos na presente data.

Detalhamento clínico/Recomendação:
${content}

Data de emissão: ${today}

--------------------------------------------------
Assinado digitalmente pelo Assistente Clínico
Clínica Médica
==================================================\n`;
    } else {
      text = `==================================================
RECEITUÁRIO MÉDICO
==================================================
Paciente: ${patientName}
Data de emissão: ${today}
--------------------------------------------------

Prescrição e Recomendações:
${content}

--------------------------------------------------
Assinado digitalmente pelo Assistente Clínico
Clínica Médica
==================================================\n`;
    }

    await docs.documents.batchUpdate({
      documentId: documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: {
                index: 1
              },
              text: text
            }
          }
        ]
      }
    });

    console.log(`Google Drive: Novo ${docType} criado para ${patientName}.`);
    return { documentId, viewLink };
  } catch (error) {
    console.error(`Erro ao gerar ${docType}:`, error);
    throw error;
  }
}
