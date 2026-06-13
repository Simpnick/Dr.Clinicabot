import { runAgent } from './lib/ai/agent';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const query = process.argv.slice(2).join(' ') || 'Olá, gostaria de ver os horários disponíveis para o dia 2026-05-22';
  
  console.log(`\n🧪 Testando Agente com a mensagem: "${query}"`);
  
  // 1. Simular uma interação de Paciente
  console.log('\n======================================');
  console.log('👥 SIMULAÇÃO: Mensagem de PACIENTE');
  console.log('======================================');
  try {
    const patientResponse = await runAgent('5511977777777', query, false);
    console.log('\n💬 Resposta do Bot para o Paciente:\n');
    console.log(patientResponse);
  } catch (err: any) {
    console.error('Erro na simulação do Paciente:', err.message);
  }

  // 2. Simular uma interação do Médico (Administrador)
  console.log('\n======================================');
  console.log('👨‍⚕️ SIMULAÇÃO: Mensagem do MÉDICO');
  console.log('======================================');
  try {
    const doctorQuery = 'Adicione uma nota no prontuário de João da Silva de que ele está se recuperando muito bem da cirurgia';
    console.log(`Enviando comando do médico: "${doctorQuery}"`);
    const doctorResponse = await runAgent(
      process.env.DOCTOR_PHONE || '5511999999999', 
      doctorQuery, 
      true
    );
    console.log('\n💬 Resposta do Bot para o Médico:\n');
    console.log(doctorResponse);
  } catch (err: any) {
    console.error('Erro na simulação do Médico:', err.message);
  }
}

main().catch(console.error);
