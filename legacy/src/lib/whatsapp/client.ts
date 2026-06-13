import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Converte formatações de Markdown comuns (links, negrito, itálico) para os padrões suportados pelo WhatsApp.
 */
export function convertMarkdownToWhatsApp(text: string): string {
  if (!text) return text;
  
  let formatted = text;
  
  // 1. Converter Links do Markdown [Texto](URL) -> Texto: URL
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2');
  
  // 2. Proteger negrito do Markdown (**texto**) substituindo por um placeholder temporário
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '___BOLD_START___$1___BOLD_END___');
  
  // 3. Converter itálico do Markdown (*texto*) -> itálico do WhatsApp (_texto_)
  formatted = formatted.replace(/\*(.*?)\*/g, '_$1_');
  
  // 4. Restaurar o negrito convertendo os placeholders para a estrela única do WhatsApp (*texto*)
  formatted = formatted.replace(/___BOLD_START___/g, '*');
  formatted = formatted.replace(/___BOLD_END___/g, '*');
  
  return formatted;
}

/**
 * Normaliza números de telefone brasileiros para o formato de 9 dígitos se forem celulares.
 * Exemplo: 554896633846 -> 5548996633846
 */
export function normalizeBrazilianPhone(phone: string): string {
  let clean = phone.replace(/\D/g, '');
  if (clean.startsWith('55') && clean.length === 12) {
    const ddd = clean.substring(2, 4);
    const number = clean.substring(4);
    if (number.startsWith('9')) {
      clean = `55${ddd}9${number}`;
    }
  }
  return clean;
}

/**
 * Envia uma mensagem de texto simples usando a API Oficial do WhatsApp Cloud
 * @param toPhone Número do destinatário em formato internacional (ex: 5548996633846)
 * @param text Texto da mensagem a ser enviada
 */
export async function sendWhatsAppMessage(toPhone: string, text: string): Promise<any> {
  const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
  const WHATSAPP_SIMULATION_MODE = process.env.WHATSAPP_SIMULATION_MODE === 'true';

  // Higieniza e normaliza o número do destinatário
  const cleanPhone = normalizeBrazilianPhone(toPhone);

  // Converte a formatação Markdown (negritos e links) para o padrão do WhatsApp
  const convertedText = convertMarkdownToWhatsApp(text);

  if (WHATSAPP_SIMULATION_MODE) {
    console.log(`\n--- [SIMULAÇÃO WHATSAPP] ---`);
    console.log(`Para: ${cleanPhone}`);
    console.log(`Mensagem:\n${convertedText}`);
    console.log(`-----------------------------\n`);
    return {
      messaging_product: 'whatsapp',
      contacts: [{ input: cleanPhone, wa_id: cleanPhone }],
      messages: [{ id: `mock_wamid_${Date.now()}` }]
    };
  }

  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
    console.warn('WhatsApp API Oficial: Configurações ausentes (WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_ACCESS_TOKEN). A mensagem não pôde ser enviada.');
    return null;
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      text: {
        preview_url: false,
        body: convertedText
      }
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`WhatsApp API Oficial: Mensagem enviada com sucesso para ${cleanPhone}. ID: ${response.data?.messages?.[0]?.id}`);
    return response.data;
  } catch (error: any) {
    console.error('Erro ao enviar mensagem via WhatsApp API Oficial:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Marca uma mensagem recebida como lida (envia o "double check" azul)
 * @param messageId ID da mensagem recebida
 */
export async function markWhatsAppMessageAsRead(messageId: string): Promise<any> {
  const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
  const WHATSAPP_SIMULATION_MODE = process.env.WHATSAPP_SIMULATION_MODE === 'true';

  if (WHATSAPP_SIMULATION_MODE) {
    console.log(`[SIMULAÇÃO WHATSAPP] Mensagem ${messageId} marcada como lida.`);
    return { success: true };
  }

  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
    return null;
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error: any) {
    console.error('Erro ao marcar mensagem como lida na API Oficial:', error.response?.data || error.message);
    return null;
  }
}
