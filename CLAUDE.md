# Guia de Desenvolvimento - CLAUDE.md (Filosofia Extreme Programming)

Este arquivo é o guia vivo de padrões e diretrizes de engenharia de software para o projeto do Chatbot Clínico do Dr. Carlos Tonelli. Ele descreve a arquitetura, regras de codificação, ferramentas de teste e padrões do projeto.

> [!IMPORTANT]
> **REGRA DE OURO (MÉTODO AKITA):**
> Ao final de cada implementação ou entrega de código, o desenvolvedor/IA DEVE justificar explicitamente como os princípios do Método Akita / Extreme Programming (XP) foram aplicados naquela mudança. Caso contrário, a alteração será considerada inválida e rejeitada.

## 🚀 Comandos Rápidos e Execução
- **Iniciar em Desenvolvimento:** `npm run dev`
- **Compilar em Produção:** `npm run build`
- **Executar Testes de Unidade/Integração:** `npm run test` (Vitest)
- **Verificar Cobertura de Testes:** `npm run test:coverage`
- **Executar Linter e Formatação:** `npm run lint` & `npm run format`

---

## 🏗️ Nova Arquitetura Modular (Clean Architecture)

Para evitar monólitos de 5.000 linhas, o código deve ser rigorosamente dividido em módulos autocontidos dentro de `src/`:

```
src/
├── index.ts               # Ponto de entrada do Express (Legado)
├── server.ts              # Novo ponto de entrada configurado para modularidade
├── config/                # Gerenciador de variáveis de ambiente e constantes (.env)
├── core/                  # Regras de Negócio Puras (Enterprise Business Rules)
│   ├── triage/            # Lógica de triagem, FAQ e fluxo de perguntas
│   ├── scheduler/         # Lógica da agenda de cotas 2026, idades e categorias
│   └── domain/            # Interfaces, tipos globais e entidades
├── services/              # Serviços de Integração Externa (Gateway Adapters)
│   ├── llm/               # Wrapper do Orquestrador de IA (LM Studio / Gemini Studio)
│   ├── google/            # Integração com Google Sheets, Docs e Calendar
│   └── whatsapp/          # API Oficial do WhatsApp Cloud
├── interfaces/            # Controladores, Webhooks e CLI
│   └── http/              # Rotas e controladores do Express
└── test/                  # Testes automatizados (Vitest)
```

### Regras de Código Legado:
- O código em `src/lib/` e `src/index.ts` é considerado **legado** e será substituído progressivamente.
- O novo desenvolvimento deve residir estritamente dentro da estrutura modular acima.

---

## 🧪 Práticas de Extreme Programming (XP) / Método Akita

1. **Test-Driven Development (TDD):**
   - Escrever o teste antes ou em conjunto com a lógica de negócio.
   - Todo novo serviço ou lógica na pasta `src/core/` deve ter 100% de cobertura de testes.
   - Mocks completos para integrações de infraestrutura (Google API, Meta Graph API e LLM).
2. **Refactoring Contínuo:**
   - Faça refatorações cirúrgicas a cada commit. 
   - Se ver código duplicado em 3 ou mais lugares, extraia um helper ou concern imediatamente.
3. **Small Releases:**
   - Cada commit em `master` deve passar nos testes e estar pronto para ir para produção (`production-ready`).
   - Evite grandes commits que mudam muitos componentes ao mesmo tempo sem testes.
4. **Sem Over-Engineering:**
   - Comece simples. Uma lógica estruturada pura resolve 90% dos problemas antes de criar state machines complexas com IA.
   - IA atua no *como* (Pair Programming), o desenvolvedor dita o *quê* e o *porquê*.

---

## 🤖 Configuração do Orquestrador (LLM)
- **Modo Desenvolvimento:** Rodar Gemma 3 localmente via LM Studio (`http://localhost:1234/v1`).
- **Modo Produção:** Gemini 2.5 Flash via Google AI Studio API.
- Configurações controladas pelas variáveis de ambiente no `.env`:
  ```bash
  LLM_PROVIDER=lm-studio # 'lm-studio' ou 'gemini'
  LLM_API_BASE_URL=http://localhost:1234/v1
  LLM_MODEL_NAME=gemma-3
  LLM_API_KEY=sua_chave_se_houver
  ```

---

## 🎨 Padrão de Estilo de Código (Typescript)
- Use **ESM (ECMAScript Modules)** para novos arquivos (`import/export`).
- Tipagem estrita em TypeScript: evite `any` a todo custo.
- Tratamento explícito de erros: sempre envolva chamadas de rede em blocos `try/catch` inteligentes e amigáveis para falhas (resiliência).
- Documente decisões complexas em comentários breves ao invés de código confuso.
