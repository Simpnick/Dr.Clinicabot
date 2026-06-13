# Guia de Configuração - API Oficial do WhatsApp Cloud

Este guia descreve como configurar a **API Oficial do WhatsApp Cloud** (Meta) para o seu Chatbot Clínico.

---

## 🛠️ Passo 1: Cadastro no Meta for Developers
1. Acesse o portal [Meta for Developers](https://developers.facebook.com) e faça login com sua conta do Facebook.
2. No canto superior direito, clique em **Meus Aplicativos** > **Criar aplicativo**.
3. Selecione o tipo de aplicativo **Outro** ou **Empresas** e prossiga.
4. Escolha um nome descritivo para seu aplicativo (ex: `Chatbot Clinica`) e associe ao seu Gerenciador de Negócios (Business Manager), caso tenha um. Clique em **Criar aplicativo**.

---

## 📞 Passo 2: Configurar o Produto do WhatsApp
1. Na tela inicial do painel do seu aplicativo, role até encontrar o produto **WhatsApp** e clique em **Configurar**.
2. Aceite os termos de serviço.
3. A Meta gerará automaticamente um número de teste de WhatsApp gratuito e um Phone Number ID temporário.
4. **Para Produção:** Adicione o número real de WhatsApp da clínica na seção **WhatsApp > Configuração do WhatsApp** seguindo as etapas de validação de SMS/Ligação telefônica.

---

## 🔑 Passo 3: Coletar as Chaves do Painel
Copie os seguintes dados do painel do Facebook Developer para o seu arquivo `.env`:

1. **ID do Número de Telefone (Phone Number ID)**: Um identificador numérico (ex: `109847163884261`). Preencha no campo `WHATSAPP_PHONE_NUMBER_ID`.
2. **Token de Acesso (Access Token)**:
   - *Temporário (desenvolvimento)*: Copie o token gerado diretamente na tela de introdução do WhatsApp. Ele expira em 24 horas.
   - *Permanente (produção)*: Crie um **Usuário do Sistema** (System User) no seu painel de Configurações de Negócio do Facebook, conceda acesso ao app e gere um token permanente. Preencha no campo `WHATSAPP_ACCESS_TOKEN`.
3. **Token de Verificação (Verify Token)**: Escolha qualquer palavra ou frase de sua escolha (ex: `clinica_token_123`) e coloque no campo `WHATSAPP_VERIFY_TOKEN` (você usará este mesmo token na configuração de webhook da Meta).

---

## ⚙️ Passo 4: Configurar o Webhook no Facebook
Para receber mensagens dos pacientes em tempo real, precisamos expor nosso servidor local à internet (por exemplo, usando `ngrok` ou `LocalTunnel` no desenvolvimento) e cadastrar o webhook na Meta.

1. **Exponha o Servidor Local**:
   ```bash
   npx ngrok http 3000
   ```
   Isso gerará uma URL pública (ex: `https://abcd-123.ngrok-free.app`).
2. **Configuração de Webhook na Meta**:
   - Vá para **WhatsApp > Configuração** no menu lateral esquerdo do aplicativo da Meta.
   - Na seção **Webhooks**, clique em **Editar**.
   - **URL de Retorno (Callback URL)**: Use a URL pública gerada seguida do path `/webhook/whatsapp` (ex: `https://abcd-123.ngrok-free.app/webhook/whatsapp`).
   - **Token de Verificação**: Insira o mesmo token definido no seu `.env` (`WHATSAPP_VERIFY_TOKEN`).
   - Clique em **Salvar e verificar**.
3. **Assinar Eventos**:
   - Após salvar, clique em **Gerenciar** na seção de webhooks.
   - Localize o evento **messages** e clique em **Assinar** (Subscribe).
   - Clique em **Concluído**.

---

## 🚀 Passo 5: Testar a Conexão
1. Inicialize seu chatbot clínico localmente:
   ```bash
   npm run dev
   ```
2. Acesse a interface visual de setup em `http://localhost:3000/setup`.
3. Certifique-se de que os campos de ID do Telefone e Token estão salvos.
4. Clique em **Enviar Mensagem Teste** no painel esquerdo. Uma mensagem oficial deverá chegar no WhatsApp do médico!
