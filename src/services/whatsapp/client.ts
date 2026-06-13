import axios from 'axios';
import { config } from '../../config/env-manager';

// Cache de validade do token de acesso do WhatsApp em memória (null = ainda não testado)
let isWhatsAppTokenValid: boolean | null = null;

export function setWhatsAppTokenValid(valid: boolean | null) {
  isWhatsAppTokenValid = valid;
}

export function isWhatsAppConnected(): boolean {
  const phoneId = config.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = config.WHATSAPP_ACCESS_TOKEN;
  const isSimulation = process.env.WHATSAPP_SIMULATION_MODE === 'true';

  if (isSimulation) return true;
  if (!phoneId || !accessToken) return false;
  if (isWhatsAppTokenValid === false) return false;
  return true;
}

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
 */
export async function sendWhatsAppMessage(toPhone: string, text: string): Promise<any> {
  const phoneId = config.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = config.WHATSAPP_ACCESS_TOKEN;
  const isSimulation = process.env.WHATSAPP_SIMULATION_MODE === 'true';

  const cleanPhone = normalizeBrazilianPhone(toPhone);
  const convertedText = convertMarkdownToWhatsApp(text);

  if (isSimulation) {
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

  if (!phoneId || !accessToken) {
    console.warn('WhatsApp API Oficial: Configurações ausentes. Mensagem exibida no console para depuração:');
    console.log(`[WhatsApp Debug] Para: ${cleanPhone} | Conteúdo: ${convertedText}`);
    return null;
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
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
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`WhatsApp API Oficial: Mensagem enviada para ${cleanPhone}. ID: ${response.data?.messages?.[0]?.id}`);
    
    // Se o envio deu certo, garante que o token é considerado válido
    if (isWhatsAppTokenValid === false) {
      setWhatsAppTokenValid(true);
    }
    
    return response.data;
  } catch (error: any) {
    console.error('Erro ao enviar mensagem via WhatsApp API Oficial:', error.response?.data || error.message);
    
    const apiError = error.response?.data?.error;
    const isAuthError = apiError?.code === 190 || 
                        apiError?.type === 'OAuthException' || 
                        apiError?.message?.toLowerCase().includes('authentication') ||
                        apiError?.message?.toLowerCase().includes('token') ||
                        error.response?.status === 401;
                        
    if (isAuthError) {
      console.warn('[WhatsApp OAuth] Token de acesso identificado como inválido/expirado.');
      setWhatsAppTokenValid(false);
    }
    
    throw error;
  }
}

/**
 * Marca uma mensagem recebida como lida (envia o "double check" azul)
 */
export async function markWhatsAppMessageAsRead(messageId: string): Promise<any> {
  const phoneId = config.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = config.WHATSAPP_ACCESS_TOKEN;
  const isSimulation = process.env.WHATSAPP_SIMULATION_MODE === 'true';

  if (isSimulation) {
    console.log(`[SIMULAÇÃO WHATSAPP] Mensagem ${messageId} marcada como lida.`);
    return { success: true };
  }

  if (!phoneId || !accessToken) {
    return null;
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error: any) {
    console.error('Erro ao marcar mensagem como lida na API Oficial:', error.response?.data || error.message);
    
    const apiError = error.response?.data?.error;
    const isAuthError = apiError?.code === 190 || 
                        apiError?.type === 'OAuthException' || 
                        apiError?.message?.toLowerCase().includes('authentication') ||
                        apiError?.message?.toLowerCase().includes('token') ||
                        error.response?.status === 401;
                        
    if (isAuthError) {
      console.warn('[WhatsApp OAuth] Token de acesso identificado como inválido/expirado.');
      setWhatsAppTokenValid(false);
    }
    
    return null;
  }
}
