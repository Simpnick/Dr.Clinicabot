import axios from 'axios';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { config } from '../../config/env-manager';

export interface ChatMessage {
  role: 'user' | 'model' | 'system' | 'assistant';
  content: string;
}

/**
 * Converte o formato genérico de histórico de chat para o padrão aceito pelo LM Studio / OpenAI
 */
function formatHistoryForLMStudio(history: ChatMessage[], systemInstruction: string): any[] {
  const formatted: any[] = [];
  
  if (systemInstruction) {
    formatted.push({ role: 'system', content: systemInstruction });
  }

  for (const msg of history) {
    const role = msg.role === 'model' ? 'assistant' : msg.role;
    formatted.push({ role, content: msg.content });
  }

  return formatted;
}

/**
 * Converte o formato genérico de histórico de chat para o padrão do SDK do Gemini
 */
function formatHistoryForGemini(history: ChatMessage[]): any[] {
  return history.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : msg.role,
    parts: [{ text: msg.content }]
  }));
}

/**
 * Envia mensagens para o LM Studio local rodando o modelo (ex: Gemma 3)
 */
async function callLMStudio(history: ChatMessage[], systemInstruction: string, temperature: number = 0.7): Promise<string> {
  const url = `${config.LLM_API_BASE_URL}/chat/completions`;
  const messages = formatHistoryForLMStudio(history, systemInstruction);

  try {
    console.log(`[LLM Service] Chamando LM Studio local (${config.LLM_MODEL_NAME}) em: ${url} (temp: ${temperature})`);
    const response = await axios.post(url, {
      model: config.LLM_MODEL_NAME,
      messages,
      temperature,
      max_tokens: 2048
    }, {
      timeout: 30000 // 30 segundos de timeout
    });

    const reply = response.data?.choices?.[0]?.message?.content || '';
    return reply.trim();
  } catch (error: any) {
    if (error.response) {
      console.error(`[LLM Service] Erro ao chamar LM Studio local. Status: ${error.response.status}. Dados:`, JSON.stringify(error.response.data));
    } else {
      console.error(`[LLM Service] Erro ao chamar LM Studio local:`, error.message);
    }
    throw new Error(`Falha no LM Studio local: ${error.message}`);
  }
}

/**
 * Envia mensagens para o Gemini Cloud (Google AI Studio)
 */
async function callGemini(history: ChatMessage[], systemInstruction: string, temperature: number = 0.7): Promise<string> {
  if (!config.GEMINI_API_KEY) {
    throw new Error('Chave GEMINI_API_KEY não configurada no arquivo .env');
  }

  const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const geminiHistory = formatHistoryForGemini(history);
  const geminiModel = 'gemini-2.5-flash';

  try {
    console.log(`[LLM Service] Chamando Gemini Cloud (${geminiModel}) (temp: ${temperature})`);
    
    // Cria sessão de chat com histórico
    const chat = ai.chats.create({
      model: geminiModel,
      history: geminiHistory,
      config: {
        systemInstruction,
        temperature
      }
    });

    // Pega a última mensagem para enviar como estímulo
    const lastMessage = history[history.length - 1]?.content || 'Olá';
    const response = await chat.sendMessage({ message: lastMessage });
    
    return response.text || '';
  } catch (error: any) {
    console.error(`[LLM Service] Erro ao chamar Gemini Cloud:`, error.message);
    throw error;
  }
}

/**
 * Função unificada para gerar respostas do Chatbot Clínico de IA
 * @param history Histórico de mensagens da sessão
 * @param systemInstruction Instruções do sistema (persona da IA)
 * @param temperature Parâmetro opcional de temperatura da IA
 */
export async function generateLLMResponse(
  history: ChatMessage[],
  systemInstruction: string,
  temperature: number = 0.7
): Promise<string> {
  const provider = config.LLM_PROVIDER;

  if (provider === 'lm-studio') {
    return await callLMStudio(history, systemInstruction, temperature);
  }

  return await callGemini(history, systemInstruction, temperature);
}
