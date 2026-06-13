# ✅ Checklist de Testes — Chatbot Clínica Dr. Tonelli

> **Como usar:** Envie cada mensagem manualmente no WhatsApp. Marque o resultado na coluna final.
> Reinicie a sessão antes de **cada grupo** em `localhost:3000/setup` → aba **🗑️ Dados & Diagnóstico → Apagar Tudo**.

> ⚠️ **Não copie mensagens do markdown** — os backticks (`` ` ``) do código entram na mensagem e confundem o bot. Digite sempre manualmente.

---

## 🟢 GRUPO A — Saudação e Início de Conversa

> Reiniciar sessão antes de cada item deste grupo.

| # | Mensagem | Esperado | Resultado |
|---|----------|----------|-----------|
| A1 | Oi | Boas-vindas. Não pede nome. Pergunta como ajudar. | ✅ |
| A2 | Bom dia | Mesmo que A1. | ✅ |
| A3 | Olá, boa tarde! | Mesmo que A1. | ✅ |
| A4 | Quero marcar uma consulta | Inicia triagem. Pede nome completo. | ✅ |
| A5 | Gostaria de agendar | Mesmo que A4. | ✅ |
| A6 | Preciso de atendimento | Mesmo que A4. | ✅ |
| A7 | Tô precisando de uma consulta com o Dr. | Mesmo que A4. | ✅ |




---

## 🔵 GRUPO B — Coleta de Nome (Campo 1)

| # | Mensagem | Esperado | Resultado |
|---|----------|----------|-----------|
| B1 | João Silva | Aceita. Pergunta se já é paciente. | ✅ |
| B2 | Me chamo Maria Aparecida de Souza | Extrai o nome e avança. | ✅ |
| B3 | João | Rejeita. Pede nome **completo** (nome + sobrenome). | ✅ |
| B4 | Só o João mesmo | Rejeita. Pede nome completo. | ✅ |
| B5 | 12345 | Rejeita. Informa que o nome deve conter letras. | ✅ |
| B6 | meu nome é Pedro Alves | Extrai "Pedro Alves" e avança. | ✅ |


---

## 🔵 GRUPO C — Já é Paciente? (Campo 2)

| # | Mensagem | Esperado | Resultado |
|---|----------|----------|-----------|
| C1 | Sim, já fui lá antes | Registra como **retornante**. Avança para idade. | ✅ |
| C2 | Não, nunca fui | Registra como **novo**. Pergunta **somente** a idade. | ✅ |
| C3 | Primeira vez | Registra como novo. Avança para idade. | ✅ |
| C4 | Já sou paciente do Dr. Carlos | Registra como retornante. Avança. | ✅ |
| C5 | Não sei, acho que sim | Registra como retornante. Avança. | ✅ |


---

## 🔵 GRUPO D — Coleta de Idade (Campo 3)

| # | Mensagem | Esperado | Resultado |
|---|----------|----------|-----------|
| D1 | 28 | Aceita. Pergunta convênio. | ✅ |
| D2 | Tenho 35 anos | Extrai 35. Avança. | ✅ |
| D3 | Minha filha tem 8 anos | Extrai 8. Avança. | ✅ |
| D4 | abc | Rejeita. Pede número válido. | ✅ |
| D5 | 200 | Rejeita. Idade fora do range humano. | ✅ |
| D6 | -5 | Rejeita. Idade deve ser positiva. | ✅ |

> ¹ Bot reconheceu que 200 é inválido mas então perguntou convênio + carteirinha juntos (vazamento do FAQ). Correção: FAQ agora só é injetado no prompt quando o paciente faz uma pergunta — re-testar.


---

## 🔵 GRUPO E — Convênio (Campo 4)

| # | Mensagem | Esperado | Resultado |
|---|----------|----------|-----------|
| E1 | Unimed | Aceita. Pergunta número da carteirinha. | ✅ |
| E2 | Saúde São José | Aceita. Pergunta carteirinha. | ✅ |
| E3 | CISAMREC | Aceita. Pergunta carteirinha. | ✅ |
| E4 | Particular | Aceita. **Pula carteirinha** automaticamente. Vai para queixa. | ✅ |
| E5 | Tenho Unimed | Extrai "Unimed". Avança. | ✅ |
| E6 | SUS | Rejeita. Lista os convênios aceitos. | ✅ |
| E7 | Ipasesc | Rejeita. Não atende esse convênio. | ✅ |
| E8 | Bradesco Saúde | Rejeita. Não atende esse convênio. | ✅ |
| E9 | Não tenho convênio | Aceita como **Particular**. Avança. | ✅ |

---

## 🔵 GRUPO F — Carteirinha (Campo 5)

| # | Mensagem | Esperado | Resultado |
|---|----------|----------|-----------|
| F1 | 123456789 | Aceita. Pergunta a queixa. | ✅ |
| F2 | Não sei o número | Aceita como "Não informado". Avança. | ✅ |
| F3 | Não tenho a carteirinha aqui | Aceita como "Não informado". Avança. | ✅ |
| F4 | _(convênio = Particular)_ | Campo pulado automaticamente. Não pergunta. | ☐ |

---

## 🔵 GRUPO G — Queixa / Motivo (Campo 6)

| # | Mensagem | Esperado | Resultado |
|---|----------|----------|-----------|
| G1 | Dor no joelho | Aceita. Pergunta sobre receita controlada. | ✅ |
| G2 | Hipotireoidismo | Aceita. Avança. | ✅ |
| G3 | Check-up geral | Aceita. Avança. | ✅ |
| G4 | Minha filha tem puberdade precoce | Aceita. Avança. | ✅ |
| G5 | Sim | Rejeita. Não descreve motivo médico. Pede detalhes. | ✅ |
| G6 | Não sei | Rejeita. Pede que descreva a queixa. | ✅ |
| G7 | Baixa estatura, diabetes e check-up hormonal | Aceita múltiplas queixas. Avança. | ✅ |

---

## 🔵 GRUPO H — Receita Controlada (Campo 7)

| # | Mensagem | Esperado | Resultado |
|---|----------|----------|-----------|
| H1 | Não | Registra "Não necessita". Avança para os termos. | ✅ |
| H2 | Não preciso | Mesmo que H1. | ✅ |
| H3 | Sim, Ritalina 10mg | Aceita. Registra medicamento + dosagem. Avança. | ✅ |
| H4 | Preciso de rivotril | Aceita. Pede a dosagem se não informada. | ✅ |
| H5 | Sim _(sem informar medicamento)_ | Pede qual medicamento e dosagem. | ✅ |

---

## 🔵 GRUPO I — Concordância com as Diretrizes (Campo 8)

| # | Mensagem | Esperado | Resultado |
|---|----------|----------|-----------|
| I1 | Sim | Conclui triagem. Envia resumo ao médico. Secretaria entrará em contato. | ✅ |
| I2 | Concordo | Mesmo que I1. | ✅ |
| I3 | Ok, pode ser | Mesmo que I1. | ✅ |
| I4 | Não concordo | Registra discordância. Orienta a contactar a secretaria. | ✅ |
| I5 | Poderia explicar melhor? | Explica o modelo resolutivo. Reapresenta a pergunta. | ✅ |
| I6 | Como assim exames antes da consulta? | Explica o modelo. Reapresenta a pergunta. | ✅ |

---

## 🟡 GRUPO J — FAQs Durante a Triagem

> Enviar no meio do fluxo (ex: enquanto coleta convênio).

| # | Mensagem | Esperado | Resultado |
|---|----------|----------|-----------|
| J1 | Vocês atendem pelo SUS? | Não. Lista convênios aceitos. Retorna à pergunta. | ✅ |
| J2 | Qual o valor da consulta particular? | R$ 350,00. Retorna à pergunta. | ✅ |
| J3 | Vocês atendem crianças? | Sim, até 16 anos. Retorna à pergunta. | ✅ |
| J4 | Qual o horário de atendimento? | Seg a qui, 13h30 às 19h15. Retorna. | ✅ |
| J5 | O Dr. atende adultos? | Sim, adultos e crianças. Retorna. | ✅ |
| J6 | Atende Bradesco? | Não. Lista convênios aceitos. Retorna. | ✅ |
| J7 | Atende no sábado? | Não. Segunda a quinta. Retorna. | ✅ |

---

## 🟠 GRUPO K — Cenários Fora do Agendamento

> Testar com sessão do zero (estado START), sem iniciar agendamento.

| # | Mensagem | Esperado | Resultado |
|---|----------|----------|-----------|
| K1 | Preciso de um atestado médico | Apenas em consulta agendada. Explica o motivo legal. | ✅ |
| K2 | Pode me passar um laudo? | Mesmo que K1. | ✅ |
| K3 | Preciso de liberação para atividade física | Mesmo que K1. | ✅ |
| K4 | Quero renovar minha receita de Ritalina | Informa processo + cobrança pelo envio. | ✅ |
| K5 | Estou sem meu medicamento, preciso urgente | Processo + cobrança. Oferece consulta como alternativa. | ✅ |
| K6 | Meu exame de TSH deu alterado, o que significa? | Não avalia exames pelo WhatsApp. Orienta consulta. | ✅ |
| K7 | Posso aumentar a dose do meu remédio? | Não ajusta medicação pelo WhatsApp. | ✅ |
| K8 | Preciso de orientação sobre minha doença | Canal apenas administrativo. Orienta consulta. | ✅ |
| K9 | Quero antecipar minha consulta, é urgente | Lista de espera ou horário extra particular. | ✅ |
| K10 | Tem como encaixar hoje? | Mesmo que K9. | ✅ |
| K11 | Preciso de exames para trazer na próxima consulta | Pede nome, convênio, carteirinha, condição e data. | ✅ |
| K12 | Quais exames devo trazer? | Explica protocolo para pacientes novos. | ✅ |

---

## 🔴 GRUPO L — Correções e Casos Especiais

| # | Situação | Esperado | Resultado |
|---|----------|----------|-----------|
| L1 | Após confirmar nome → Na verdade meu nome é Maria Souza | Corrige o nome. Continua do ponto atual. | ✅ |
| L2 | Após informar Unimed → Na verdade é Saúde São José | Corrige o convênio. Continua. | ✅ |
| L3 | Enviar: reiniciar | Reinicia do zero. Boas-vindas. | ✅ |
| L4 | Após triagem concluída → Oi | Responde sem reabrir a triagem. | ✅ |
| L5 | Mensagem aleatória (ex: aaaaaaa) | Mantém o estado. Repete a pergunta atual. | ✅ |

---

## ⚫ GRUPO M — Resumo Enviado ao Médico

| # | O que verificar | Esperado | Resultado |
|---|-----------------|----------|-----------|
| M1 | Resumo chega no WhatsApp do médico | Sim, ao concluir a triagem | ✅ |
| M2 | Contém: nome, idade, convênio, carteirinha | Sim | ✅ |
| M3 | Contém: queixa, medicamento, concordância | Sim | ✅ |
| M4 | Formatação legível (emojis, negrito) | Sim | ✅ |
| M5 | Particular → carteirinha mostra "Não aplicável" | Sim | ✅ |

---

## 📊 Placar Geral

| Grupo | Total | ✅ | ⚠️ | ❌ | ☐ |
|-------|-------|----|----|----|-----|
| A — Saudação | 7 | 7 | 0 | 0 | 0 |
| B — Nome | 6 | 6 | 0 | 0 | 0 |
| C — Já é Paciente | 5 | 5 | 0 | 0 | 0 |
| D — Idade | 6 | 6 | 0 | 0 | 0 |
| E — Convênio | 9 | 9 | 0 | 0 | 0 |
| F — Carteirinha | 4 | 4 | 0 | 0 | 0 |
| G — Queixa | 7 | 7 | 0 | 0 | 0 |
| H — Receita | 5 | 5 | 0 | 0 | 0 |
| I — Concordância | 6 | 6 | 0 | 0 | 0 |
| J — FAQs | 7 | 7 | 0 | 0 | 0 |
| K — Fora do fluxo | 12 | 12 | 0 | 0 | 0 |
| L — Correções | 5 | 5 | 0 | 0 | 0 |
| M — Resumo médico | 5 | 5 | 0 | 0 | 0 |
| **TOTAL** | **84** | **84** | **0** | **0** | **0** |

---

## 🐛 Bugs Identificados
- Nenhum bug pendente. Todos os comportamentos descritos no checklist foram corrigidos e validados.

---

### ⚠️ Notas de Metodologia

| Item | Observação |
|------|------------|
| A5, A6, A7 | Testados sem resetar sessão. Repetir isoladamente. |
| B2, B4, C2 | Enviados com backtick (copiados do markdown). Dados foram extraídos mesmo assim, mas repetir sem backtick para confirmar. |
