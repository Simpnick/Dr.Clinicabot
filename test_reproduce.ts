import { routeTriageMessage } from './src/core/triage/triage-router';
import { TriageSession, TriageState } from './src/core/triage/triage-flow';
import * as fs from 'fs';
import * as path from 'path';

require('dotenv').config();

async function run() {
  const session = new TriageSession('5548996633847');
  
  // Limpa histórico anterior do reproduce
  const chatHistoryPath = path.join(process.cwd(), 'chat_histories.json');
  if (fs.existsSync(chatHistoryPath)) {
    try {
      const histories = JSON.parse(fs.readFileSync(chatHistoryPath, 'utf8'));
      delete histories['5548996633847'];
      fs.writeFileSync(chatHistoryPath, JSON.stringify(histories, null, 2), 'utf8');
    } catch (e) {}
  }

  // Passo 1: "Oi"
  console.log("=== PASSO 1: Oi ===");
  let res = await routeTriageMessage(session, "Oi");
  console.log("Bot:", res);
  console.log("Session State:", session.state);
  console.log("----------------\n");

  // Passo 2: "Bom dia"
  console.log("=== PASSO 2: Bom dia ===");
  res = await routeTriageMessage(session, "Bom dia");
  console.log("Bot:", res);
  console.log("Session State:", session.state);
  console.log("----------------\n");

  // Passo 3: "Olá, boa tarde!"
  console.log("=== PASSO 3: Olá, boa tarde! ===");
  res = await routeTriageMessage(session, "Olá, boa tarde!");
  console.log("Bot:", res);
  console.log("Session State:", session.state);
  console.log("----------------\n");

  // Passo 4: "Gostaria de agendar uma consulta"
  console.log("=== PASSO 4: Gostaria de agendar uma consulta ===");
  res = await routeTriageMessage(session, "Gostaria de agendar uma consulta");
  console.log("Bot:", res);
  console.log("Session State:", session.state);
  console.log("----------------\n");
}

run();
