import { routeTriageMessage } from './src/core/triage/triage-router';
import { TriageSession } from './src/core/triage/triage-flow';
import * as fs from 'fs';
import * as path from 'path';

// Carrega .env
require('dotenv').config();

interface TestStep {
  input: string;
  desc: string;
}

const cleanHistory = (phone: string) => {
  const chatHistoryPath = path.join(process.cwd(), 'chat_histories.json');
  if (fs.existsSync(chatHistoryPath)) {
    try {
      const histories = JSON.parse(fs.readFileSync(chatHistoryPath, 'utf8'));
      delete histories[phone];
      fs.writeFileSync(chatHistoryPath, JSON.stringify(histories, null, 2), 'utf8');
    } catch (e) {}
  }
  const triageSessionsPath = path.join(process.cwd(), 'triage_sessions.json');
  if (fs.existsSync(triageSessionsPath)) {
    try {
      const sessions = JSON.parse(fs.readFileSync(triageSessionsPath, 'utf8'));
      delete sessions[phone];
      fs.writeFileSync(triageSessionsPath, JSON.stringify(sessions, null, 2), 'utf8');
    } catch (e) {}
  }
};

async function runScenario(name: string, phone: string, steps: TestStep[], logFile: fs.WriteStream) {
  cleanHistory(phone);
  const session = new TriageSession(phone);

  const header = `\n================================================================================\n` +
                 `🎬 SCENARIO: ${name}\n` +
                 `================================================================================\n`;
  console.log(header);
  logFile.write(header);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stateBefore = session.state;
    const dataBefore = JSON.stringify(session.data);

    const stepHeader = `\n[Passo ${i + 1}] Descrição: ${step.desc}\n` +
                       `👤 Paciente: "${step.input}"\n` +
                       `⚙️ Estado antes: ${stateBefore}\n` +
                       `📊 Dados antes: ${dataBefore}\n`;
    console.log(stepHeader);
    logFile.write(stepHeader);

    try {
      const reply = await routeTriageMessage(session, step.input);
      
      const stepFooter = `🤖 Bot: "${reply}"\n` +
                         `⚙️ Estado depois: ${session.state}\n` +
                         `📊 Dados depois: ${JSON.stringify(session.data)}\n`;
      console.log(stepFooter);
      logFile.write(stepFooter);
    } catch (error: any) {
      const errStr = `❌ Erro no processamento: ${error.message}\n`;
      console.error(errStr);
      logFile.write(errStr);
    }
  }
}

async function start() {
  const logFilePath = path.join(process.cwd(), 'manual_test_transcript.txt');
  const logFile = fs.createWriteStream(logFilePath, { flags: 'w' });

  logFile.write(`================================================================================\n`);
  logFile.write(`📝 RELATÓRIO DE SIMULAÇÃO MANUAL DO FLUXO DO PACIENTE\n`);
  logFile.write(`Data: ${new Date().toLocaleString('pt-BR')}\n`);
  logFile.write(`================================================================================\n`);

  // SCENARIO 1: Novo Paciente (Convênio Unimed)
  // Segue o fluxo ideal: A -> B -> C -> D -> E -> F -> G -> H -> I
  const scenario1Steps: TestStep[] = [
    { input: "Oi", desc: "A1: Saudação inicial simples" },
    { input: "Quero agendar uma consulta", desc: "A4: Desejo de agendamento (inicia triagem)" },
    { input: "João da Silva", desc: "B1: Informa nome completo" },
    { input: "Não, é minha primeira vez", desc: "C2: Informa que não é paciente antigo" },
    { input: "Tenho 35 anos", desc: "D2: Informa idade" },
    { input: "Unimed", desc: "E1: Informa convênio Unimed" },
    { input: "1234567890", desc: "F1: Informa carteirinha" },
    { input: "Dor nas costas e check-up", desc: "G1: Informa queixa" },
    { input: "Não preciso", desc: "H2: Responde sobre receitas controladas" },
    { input: "Sim, de acordo", desc: "I1: Concorda com diretrizes resolutivas (conclui)" }
  ];

  // SCENARIO 2: Paciente Particular (Pula carteirinha)
  // Segue o fluxo: A -> B -> C -> D -> E -> G -> H -> I (F pulado)
  const scenario2Steps: TestStep[] = [
    { input: "Olá, boa tarde!", desc: "A3: Saudação inicial" },
    { input: "Gostaria de agendar", desc: "A5: Desejo de agendamento" },
    { input: "Maria de Souza", desc: "B2: Informa nome completo" },
    { input: "Sim, já sou paciente", desc: "C1: Informa que é paciente antigo" },
    { input: "42", desc: "D1: Informa idade" },
    { input: "Particular", desc: "E4: Informa convênio Particular (deve pular carteirinha)" },
    { input: "Consulta de rotina para tireoide", desc: "G2: Informa queixa" },
    { input: "Sim, preciso de Ritalina 10mg", desc: "H3: Informa receita controlada" },
    { input: "Concordo", desc: "I2: Concorda com diretrizes (conclui)" }
  ];

  // SCENARIO 3: FAQ, Validações Inválidas e Correções
  const scenario3Steps: TestStep[] = [
    { input: "Oi, tudo bem?", desc: "A1: Saudação" },
    { input: "Quero marcar", desc: "A4: Inicia triagem" },
    { input: "Thiago", desc: "B3: Nome incompleto (deve rejeitar e pedir novamente)" },
    { input: "Thiago Santos", desc: "B1: Corrige nome completo" },
    { input: "Nunca fui aí", desc: "C2: Novo paciente" },
    { input: "Vocês atendem pelo SUS?", desc: "J1: FAQ durante fluxo (não deve avançar estado)" },
    { input: "Tenho 28 anos", desc: "D2: Informa idade" },
    { input: "Qual o valor da consulta particular?", desc: "J2: FAQ durante fluxo" },
    { input: "Particular", desc: "E4: Convênio Particular" },
    { input: "Na verdade, meu convênio é Saúde São José", desc: "L2: Correção de campo anterior" },
    { input: "987654321", desc: "F1: Informa carteirinha (já que agora é convênio)" },
    { input: "Dor de cabeça constante", desc: "G1: Informa queixa" },
    { input: "Quero renovar minha receita de Ritalina", desc: "K4: FAQ / Fora do fluxo" },
    { input: "Não preciso", desc: "H2: Não necessita receita controlada" },
    { input: "Não concordo", desc: "I4: Não aceita os termos resolutivos" }
  ];

  // SCENARIO 4: Thiago Marinho Campos (Caso Real Reportado)
  const scenario4Steps: TestStep[] = [
    { input: "Oi", desc: "A1: Saudação inicial" },
    { input: "Quero marcar uma consulta", desc: "A4: Desejo de agendamento" },
    { input: "Thiago Marinho Cmpos", desc: "B3: Nome com erro de digitação" },
    { input: "Opa errei meu nome e Thiago Marinho Campos", desc: "L1: Correção do nome completo" },
    { input: "Primeira Vez", desc: "C2: Novo paciente" },
    { input: "28", desc: "D1: Informa idade" },
    { input: "Eu uso o Sus", desc: "E3: Convênio SUS (rejeitado)" },
    { input: "Ok pode ser pelo particular", desc: "E4: Aceita Particular" },
    { input: "Problemas de Saude com meu peso", desc: "G1: Queixa principal" },
    { input: "Inejção para emagrecer mounjaro acho o nome", desc: "H3: Medicamento com nome mas sem dosagem" },
    { input: "nao sei a dosagem especifica busco uma avaliação para o uso do medicamento", desc: "H3_detail: Confirma que não sabe a dosagem e busca avaliação" },
    { input: "Sim", desc: "I1: Concorda com os termos resolutivos (conclui)" }
  ];

  try {
    await runScenario("Novo Paciente (Unimed)", "5548999999911", scenario1Steps, logFile);
    await runScenario("Paciente Particular (Pula Carteirinha)", "5548999999922", scenario2Steps, logFile);
    await runScenario("FAQs, Erros e Correções", "5548999999933", scenario3Steps, logFile);
    await runScenario("Jornada do Thiago (Mounjaro / Particular)", "5548999999944", scenario4Steps, logFile);
  } finally {
    logFile.end();
    console.log(`\n🎉 Simulação concluída com sucesso!`);
    console.log(`📝 O histórico detalhado foi gravado em: ${logFilePath}`);
  }
}

start();
