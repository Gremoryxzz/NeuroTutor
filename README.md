# 🧠 NeuroTutor

Tutor de estudos inteligente com IA. Faça perguntas, envie PDFs, gere quizzes, flashcards e mapas mentais — tudo no navegador.

---

## ✨ Funcionalidades

- 💬 **Chat com IA** — perguntas e respostas em português
- 📚 **Wikipedia integrada** — busca automática de conteúdo antes de responder
- 📄 **Leitura de PDF** — envie um documento e faça perguntas sobre ele
- 🃏 **Flashcards** — gerados automaticamente pelo conteúdo
- ❓ **Quiz** — questões de múltipla escolha geradas pela IA
- 🗺️ **Mapa Mental** — visualização dos conceitos principais
- 📝 **Resumo automático** — resumo do PDF com um clique
- 📊 **Progresso** — salva seu histórico localmente

---

## 🚀 Como rodar

### Pré-requisitos

- [Node.js](https://nodejs.org) instalado (versão 16 ou superior)
- Chave gratuita do **Groq**: https://console.groq.com/keys

### Passo a passo

```bash
# 1. Clone o repositório
git clone https://github.com/seu-usuario/neurotutor.git
cd neurotutor

# 2. Configure sua chave do Groq no server.js
# Abra o arquivo server.js e substitua na linha 21:
const GROQ_KEY = 'SUA_CHAVE_AQUI';

# 3. Inicie o servidor
node server.js

# 4. Acesse no navegador
http://localhost:3000
```

---

## 🗂️ Estrutura do projeto

```
neurotutor/
├── index.html     # Interface principal
├── script.js      # Lógica do frontend (PDF, chat, quiz, flashcards)
├── server.js      # Servidor proxy Node.js (Groq + Wikipedia)
└── README.md
```

---

## 🤖 Como funciona a IA

```
Você faz uma pergunta
        ↓
Servidor busca na Wikipedia em português 🔍
        ↓
Conteúdo encontrado + sua pergunta são enviados ao Groq
        ↓
Groq (LLaMA 3.3 70B) gera a resposta 🤖
        ↓
Resposta aparece no chat
```

Se você enviar um PDF, a Wikipedia é ignorada e a IA responde com base no documento.

---

## 🔑 Obtendo a chave do Groq (gratuita)

1. Acesse [console.groq.com](https://console.groq.com)
2. Crie uma conta gratuita
3. Vá em **API Keys** → **Create API Key**
4. Cole a chave no `server.js`

> ⚠️ **Nunca suba sua chave para o GitHub!** Adicione o `server.js` ao `.gitignore` ou use variáveis de ambiente.

---

## 🔒 Boas práticas de segurança

Para não expor sua chave no repositório, use variável de ambiente:

```js
// server.js
const GROQ_KEY = process.env.GROQ_KEY;
```

```bash
# No terminal, antes de rodar:
set GROQ_KEY=sua_chave_aqui   # Windows
export GROQ_KEY=sua_chave_aqui # Mac/Linux

node server.js
```

---

## 📦 Tecnologias usadas

| Tecnologia | Uso |
|---|---|
| Node.js | Servidor proxy local |
| Groq API | IA (LLaMA 3.3 70B) — gratuito |
| Wikipedia API | Conteúdo educativo sem limite |
| PDF.js | Leitura de PDFs no navegador |
| HTML/CSS/JS | Interface sem frameworks |

---

## 📄 Licença

MIT — use, modifique e distribua livremente.
