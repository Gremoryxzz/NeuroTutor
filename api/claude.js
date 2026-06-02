// ============================================================
//  NeuroTutor — Vercel Serverless Function
//  Arquivo: /api/claude.js
//
//  No Vercel, configure a variável de ambiente:
//    GROQ_API_KEY = sua_chave_aqui
// ============================================================

const https = require('https');

const GROQ_KEY   = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ── Wikipedia ──────────────────────────────────────────────
function httpsGet(hostname, path) {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers: { 'User-Agent': 'NeuroTutor/1.0' } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function searchWikipedia(query) {
  try {
    const encoded = encodeURIComponent(query);
    const searchPath = `/w/api.php?action=query&list=search&srsearch=${encoded}&format=json&srlimit=1`;
    const raw = await httpsGet('pt.wikipedia.org', searchPath);
    if (!raw) return null;

    const json = JSON.parse(raw);
    const results = json.query?.search || [];
    if (!results.length) return null;

    const title = results[0].title;
    const articlePath = `/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(title)}&format=json`;
    const articleRaw = await httpsGet('pt.wikipedia.org', articlePath);
    if (!articleRaw) return null;

    const articleJson = JSON.parse(articleRaw);
    const pages = articleJson.query?.pages || {};
    const page = Object.values(pages)[0];
    if (!page?.extract) return null;

    return { title: page.title, text: page.extract.slice(0, 3000) };
  } catch {
    return null;
  }
}

// ── Groq ───────────────────────────────────────────────────
function callGroq(systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    const groqMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages: groqMessages,
      max_tokens: 1500,
      temperature: 0.7,
    });

    const req = https.request(
      {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_KEY}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) { reject(new Error(json.error.message)); return; }
            resolve(json.choices?.[0]?.message?.content || '');
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Handler principal ──────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  try {
    const input      = req.body;
    const systemText = input.system || 'Você é um tutor de estudos. Responda em português.';
    const messages   = input.messages || [];
    const lastUser   = [...messages].reverse().find((m) => m.role === 'user');
    const userQuery  = lastUser?.content || '';

    // Busca Wikipedia se não houver PDF
    let wikiContext = '';
    const hasPDF = systemText.includes('CONTEÚDO DO DOCUMENTO');

    if (!hasPDF && userQuery.length > 3) {
      const wiki = await searchWikipedia(userQuery);
      if (wiki) {
        wikiContext = `\n\n--- INFORMAÇÃO DA WIKIPEDIA: "${wiki.title}" ---\n${wiki.text}\n--- FIM ---`;
      }
    }

    const fullSystem = systemText + wikiContext;
    const text = await callGroq(fullSystem, messages);

    res.status(200).json({ content: [{ type: 'text', text }] });
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
};
