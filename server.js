// ============================================================
//  NeuroTutor — servidor proxy Node.js
//  Usando Groq (GRATUITO) + Wikipedia
//
//  Como rodar:
//    node server.js
//    Abra: http://localhost:3000
// ============================================================

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Chave do Groq ──────────────────────────────────────────
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile'; // gratuito e poderoso
// ───────────────────────────────────────────────────────────

const PORT = 3000;
const BASE = `http://localhost:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

// ============================================================
//  WIKIPEDIA — busca resumo em português
// ============================================================
function searchWikipedia(query) {
  return new Promise((resolve) => {
    const encoded  = encodeURIComponent(query);
    const wikiPath = `/w/api.php?action=query&list=search&srsearch=${encoded}&format=json&srlimit=1`;

    const req = https.request({
      hostname: 'pt.wikipedia.org',
      path: wikiPath,
      method: 'GET',
      headers: { 'User-Agent': 'NeuroTutor/1.0' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json    = JSON.parse(data);
          const results = json.query?.search || [];
          if (!results.length) { resolve(null); return; }
          fetchWikipediaArticle(results[0].title).then(resolve).catch(() => resolve(null));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function fetchWikipediaArticle(title) {
  return new Promise((resolve) => {
    const encoded  = encodeURIComponent(title);
    const wikiPath = `/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encoded}&format=json`;

    const req = https.request({
      hostname: 'pt.wikipedia.org',
      path: wikiPath,
      method: 'GET',
      headers: { 'User-Agent': 'NeuroTutor/1.0' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json  = JSON.parse(data);
          const pages = json.query?.pages || {};
          const page  = Object.values(pages)[0];
          const text  = page?.extract || null;
          resolve(text ? { title: page.title, text: text.slice(0, 3000) } : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ============================================================
//  GROQ — chama a API
// ============================================================
function callGroq(systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    const groqMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages: groqMessages,
      max_tokens: 1500,
      temperature: 0.7
    });

    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) { reject(new Error(json.error.message)); return; }
          const text = json.choices?.[0]?.message?.content || '';
          resolve(text);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ============================================================
//  SERVIDOR HTTP
// ============================================================
const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, BASE);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── /api/claude → Wikipedia + Groq ───────────────────────
  if (pathname === '/api/claude' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const input      = JSON.parse(body);
        const systemText = input.system || 'Você é um tutor de estudos. Responda em português.';
        const messages   = input.messages || [];
        const lastUser   = [...messages].reverse().find(m => m.role === 'user');
        const userQuery  = lastUser?.content || '';

        // ── 1. Busca na Wikipedia ──
        let wikiContext = '';
        const hasPDF = systemText.includes('CONTEÚDO DO DOCUMENTO');

        if (!hasPDF && userQuery.length > 3) {
          console.log(`🔍 Buscando na Wikipedia: "${userQuery.slice(0, 60)}"`);
          const wiki = await searchWikipedia(userQuery);
          if (wiki) {
            wikiContext = `\n\n--- INFORMAÇÃO DA WIKIPEDIA: "${wiki.title}" ---\n${wiki.text}\n--- FIM ---`;
            console.log(`✅ Wikipedia: "${wiki.title}"`);
          } else {
            console.log(`⚠ Wikipedia: nada encontrado`);
          }
        }

        // ── 2. Monta system prompt com contexto ──
        const fullSystem = systemText + wikiContext;

        // ── 3. Chama o Groq ──
        console.log(`🤖 Chamando Groq (${GROQ_MODEL})...`);
        const text = await callGroq(fullSystem, messages);
        console.log(`✅ Groq respondeu (${text.length} chars)`);

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ content: [{ type: 'text', text }] }));

      } catch (e) {
        console.error('❌ Erro:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: { message: e.message } }));
      }
    });
    return;
  }

  // ── Arquivos estáticos ────────────────────────────────────
  const filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext      = path.extname(filePath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404); res.end('Arquivo não encontrado'); return;
  }

  res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n✅  NeuroTutor rodando em http://localhost:${PORT}`);
  console.log(`🤖  IA: Groq (${GROQ_MODEL})`);
  console.log(`📚  Wikipedia: português, sem limite`);
  console.log(`🔑  Chave Groq: configurada\n`);
});