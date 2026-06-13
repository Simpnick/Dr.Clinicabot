import { sendWhatsAppMessage } from '../lib/whatsapp/client';
import * as dotenv from 'dotenv';

dotenv.config();

async function test() {
  console.log('==================================================');
  console.log('⚙️  TESTANDO ENVIO DA WHATSAPP CLOUD API OFICIAL');
  console.log('==================================================\n');

  const DOCTOR_PHONE = process.env.DOCTOR_PHONE || '';
  const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';

  if (!DOCTOR_PHONE || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
    console.error('❌ Erro: Configurações obrigatórias ausentes no .env.');
    console.error('Verifique se DOCTOR_PHONE, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN estão configurados.');
    process.exit(1);
  }

  const cleanPhone = DOCTOR_PHONE.replace(/\D/g, '');
  const message = 'Olá! Esta é uma mensagem de teste enviada via script CLI usando a API Oficial do WhatsApp Cloud. 🚀';

  console.log(`Disparando mensagem para o médico em: ${cleanPhone}...`);

  try {
    const result = await sendWhatsAppMessage(cleanPhone, message);
    if (result) {
      console.log('\n==================================================');
      console.log('🎉 MENSAGEM ENVIADA COM SUCESSO!');
      console.log('==================================================');
      console.log('Verifique o aplicativo WhatsApp do celular cadastrado.');
      console.log('==================================================\n');
    } else {
      console.error('❌ Erro ao enviar: Resultado nulo ou inválido.');
    }
  } catch (error: any) {
    console.error('\n❌ Erro durante o envio:', error.response?.data || error.message);
  }
}

test();
