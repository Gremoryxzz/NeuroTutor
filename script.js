/* ============================================================
   NeuroTutor — script.js
   Lógica completa: PDF, IA (Claude API), Quiz, Flashcards,
   Mapa Mental, Resumo, Palavras-chave, Progresso
   ============================================================ */

// ── CONFIG ─────────────────────────────────────────────────
// /api/claude → proxy Groq (funciona local e no Vercel)
const API_URL    = '/api/claude';
const MODEL      = 'llama-3.3-70b-versatile';
const MAX_TOKENS = 1500;

// ── ESTADO GLOBAL ──────────────────────────────────────────
let pdfText        = '';           // texto completo do PDF
let pdfPages       = 0;            // nº de páginas
let pdfWords       = 0;            // nº de palavras
let keywords       = [];           // palavras-chave extraídas
let flashcards     = [];           // flashcards gerados
let quizQuestions  = [];           // questões do quiz
let quizCorrect    = 0;
let quizTotal      = 0;
let msgCount       = 0;            // perguntas feitas
let chatHistory    = [];           // histórico para contexto da IA

// ── INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadProgress();          // carrega progresso salvo no localStorage
  setupDropZone();         // drag-and-drop para PDF
  setupPdfJs();            // configura worker do PDF.js
  autoResize(document.getElementById('question-input'));
});

/* =========================================================
   PDF.JS — CONFIGURAÇÃO
   ========================================================= */
function setupPdfJs() {
  // Worker necessário para o PDF.js funcionar
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* =========================================================
   DRAG-AND-DROP
   ========================================================= */
function setupDropZone() {
  const zone = document.getElementById('drop-zone');

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));

  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  document.getElementById('file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });
}

/* =========================================================
   LEITURA DE ARQUIVO (PDF ou TXT)
   ========================================================= */
async function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  showStatus(file.name, 0);
  updatePill('status-pill', '⏳ Lendo arquivo…', true);

  if (ext === 'pdf') {
    await readPDF(file);
  } else if (ext === 'txt') {
    await readTXT(file);
  } else {
    toast('❌ Apenas PDF ou TXT são suportados');
    return;
  }

  afterFileLoad(file.name);
}

// ── lê PDF com PDF.js ──
async function readPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  pdfPages = pdf.numPages;
  pdfText  = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(s => s.str).join(' ');
    pdfText += pageText + '\n\n';

    // atualiza barra de progresso
    setProgress(Math.round((i / pdf.numPages) * 100));
  }
}

// ── lê TXT simples ──
async function readTXT(file) {
  pdfText  = await file.text();
  pdfPages = 1;
  setProgress(100);
}

// ── ações após carregar arquivo ──
function afterFileLoad(fileName) {
  pdfWords = countWords(pdfText);
  updateStats();
  updatePill('status-pill', '✅ PDF carregado', false);

  // mensagem no chat
  appendMsg('assistant',
    `📄 <strong>${fileName}</strong> carregado com sucesso!<br>` +
    `• ${pdfPages} página(s) · ${formatNumber(pdfWords)} palavras<br><br>` +
    `Use os botões acima para <strong>Resumir</strong>, gerar <strong>Quiz</strong>, ` +
    `<strong>Flashcards</strong> ou <strong>Mapa Mental</strong>. ` +
    `Ou pergunte diretamente sobre o conteúdo!`
  );

  // extrai palavras-chave automaticamente
  extractKeywords();
  saveProgress();
}

/* =========================================================
   ENVIO DE MENSAGEM / CHAT
   ========================================================= */
async function sendMessage(forcedText) {
  const input = document.getElementById('question-input');
  const text  = forcedText || input.value.trim();
  if (!text) return;

  // mostra mensagem do usuário
  appendMsg('user', text);
  if (!forcedText) { input.value = ''; autoResize(input); }

  // atualiza contador
  msgCount++;
  updateStats();

  // adiciona ao histórico
  chatHistory.push({ role: 'user', content: text });

  // indicador de digitação
  const typingId = appendTyping();

  try {
    const reply = await callClaude(buildMessages(text));
    removeMsg(typingId);
    appendMsg('assistant', mdToHtml(reply));
    chatHistory.push({ role: 'assistant', content: reply });
    saveProgress();
  } catch (err) {
    removeMsg(typingId);
    console.error('Erro NeuroTutor:', err);
    appendMsg('assistant', `❌ <strong>Erro:</strong> <code>${err.message}</code><br>Verifique se o servidor está rodando e se a chave do Gemini é válida.`);
  }
}

// ── monta array de mensagens para a API ──
function buildMessages(userText) {
  // inclui contexto do PDF se existir
  const systemNote = pdfText
    ? `Você é o NeuroTutor, um tutor de estudos inteligente.
O usuário carregou um documento. Use o conteúdo abaixo como base principal para responder.
Explique de forma didática, use exemplos práticos, destaque pontos importantes.
Responda sempre em português brasileiro.

--- CONTEÚDO DO DOCUMENTO ---
${pdfText.slice(0, 8000)}
--- FIM DO CONTEÚDO ---`
    : `Você é o NeuroTutor, um tutor de estudos inteligente e didático.
Responda de forma clara, use exemplos, bullet points quando útil.
Responda sempre em português brasileiro.`;

  // chatHistory já tem a mensagem atual no final (adicionada em sendMessage antes desta chamada).
  // Pega as últimas mensagens e garante alternância correta user/assistant (API exige isso).
  const raw = chatHistory.slice(-8);
  const messages = [];
  for (const msg of raw) {
    if (messages.length > 0 && messages[messages.length - 1].role === msg.role) {
      // Substitui em vez de duplicar (evita erro de role repetido)
      messages[messages.length - 1] = { role: msg.role, content: msg.content };
    } else {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Segurança: se ficou vazio, inclui ao menos a mensagem atual
  if (messages.length === 0) {
    messages.push({ role: 'user', content: userText });
  }

  return { system: systemNote, messages };
}

/* =========================================================
   AÇÕES RÁPIDAS
   ========================================================= */
async function quickAction(action) {
  if (!pdfText && action !== 'exemplos') {
    toast('📄 Carregue um PDF primeiro!');
    return;
  }

  const prompts = {
    resumo: `Crie um RESUMO COMPLETO e didático do documento. 
Use títulos, bullet points e destaque os conceitos mais importantes.
Formato: ## Título, pontos-chave com •, exemplos quando necessário.`,

    quiz: `Gere 5 questões de múltipla escolha (A, B, C, D) sobre o documento.
Formato JSON exato (apenas JSON, sem nada antes ou depois):
[
  {
    "q": "Pergunta aqui?",
    "options": ["A) opção", "B) opção", "C) opção", "D) opção"],
    "answer": 0,
    "explanation": "Explicação da resposta correta"
  }
]`,

    flashcards: `Crie 6 flashcards educativos sobre os conceitos principais do documento.
Formato JSON exato:
[
  {"front": "Pergunta ou conceito", "back": "Resposta ou definição"}
]`,

    mindmap: `Liste os 5 tópicos principais do documento e 3 subtópicos para cada um.
Formato JSON exato:
{
  "center": "Tema Principal",
  "nodes": [
    {"label": "Tópico 1", "children": ["sub1","sub2","sub3"]},
    {"label": "Tópico 2", "children": ["sub1","sub2","sub3"]}
  ]
}`,

    keywords: `Extraia as 15 palavras-chave ou termos técnicos mais importantes do documento.
Retorne apenas uma lista simples, uma por linha, sem numeração.`,

    exemplos: `Dê 3 exemplos práticos do dia a dia que ilustram os conceitos deste material.
Seja criativo, didático e use analogias fáceis de entender.`
  };

  appendMsg('user', `🔧 Ação: ${action.charAt(0).toUpperCase() + action.slice(1)}`);
  const typingId = appendTyping();

  try {
    const reply = await callClaudeRaw(prompts[action]);

    removeMsg(typingId);

    // processa cada tipo de resposta
    switch (action) {
      case 'quiz':       processQuiz(reply);       break;
      case 'flashcards': processFlashcards(reply); break;
      case 'mindmap':    processMindmap(reply);    break;
      case 'keywords':   processKeywords(reply);   break;
      case 'resumo':
        processResumo(reply);
        appendMsg('assistant', mdToHtml(reply));
        break;
      default:
        appendMsg('assistant', mdToHtml(reply));
    }

    saveProgress();
  } catch (err) {
    removeMsg(typingId);
    appendMsg('assistant', `❌ Erro: ${err.message}`);
  }
}

/* =========================================================
   PROCESSADORES DE RESPOSTA
   ========================================================= */

// ── QUIZ ──
function processQuiz(raw) {
  try {
    const json = extractJSON(raw);
    quizQuestions = JSON.parse(json);
    renderQuiz();
    switchRightPanel('quiz-panel', document.querySelector('.rt-btn:nth-child(2)'));
    appendMsg('assistant', `✅ Quiz gerado com <strong>${quizQuestions.length} questões</strong>! Veja no painel direito.`);
    toast('🧪 Quiz gerado!');
  } catch (e) {
    appendMsg('assistant', mdToHtml(raw));
  }
}

function renderQuiz() {
  const container = document.getElementById('quiz-container');
  container.innerHTML = '';

  quizQuestions.forEach((q, qi) => {
    const card = document.createElement('div');
    card.className = 'quiz-card';
    card.innerHTML = `<div class="q-text">${qi + 1}. ${q.q}</div>`;

    q.options.forEach((opt, oi) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option';
      btn.textContent = opt;
      btn.onclick = () => checkAnswer(btn, oi, q.answer, q.explanation, card);
      card.appendChild(btn);
    });

    const feedback = document.createElement('div');
    feedback.className = 'quiz-feedback';
    card.appendChild(feedback);

    container.appendChild(card);
  });
}

function checkAnswer(btn, chosen, correct, explanation, card) {
  const opts = card.querySelectorAll('.quiz-option');
  opts.forEach(o => o.disabled = true);

  const fb = card.querySelector('.quiz-feedback');
  quizTotal++;

  if (chosen === correct) {
    btn.classList.add('correct');
    opts[correct].classList.add('correct');
    fb.className = 'quiz-feedback show ok';
    fb.textContent = `✅ Correto! ${explanation}`;
    quizCorrect++;
  } else {
    btn.classList.add('wrong');
    opts[correct].classList.add('correct');
    fb.className = 'quiz-feedback show err';
    fb.textContent = `❌ Errado. ${explanation}`;
  }

  updateStats();
  saveProgress();
}

// ── FLASHCARDS ──
function processFlashcards(raw) {
  try {
    const json = extractJSON(raw);
    const data = JSON.parse(json);
    flashcards = data;
    renderFlashcards();
    switchLeftTab('flashcards', document.querySelector('.tab-btn:nth-child(2)'));
    appendMsg('assistant', `✅ <strong>${flashcards.length} flashcards</strong> criados! Veja na aba à esquerda. Clique para virar.`);
    toast('🃏 Flashcards gerados!');
  } catch (e) {
    appendMsg('assistant', mdToHtml(raw));
  }
}

function renderFlashcards() {
  const list  = document.getElementById('fc-list');
  const empty = document.getElementById('fc-empty');
  list.innerHTML = '';
  empty.style.display = 'none';

  flashcards.forEach(fc => {
    const card = document.createElement('div');
    card.className = 'flashcard';
    card.innerHTML = `
      <div class="fc-front">❓ ${fc.front}</div>
      <div class="fc-back">💡 ${fc.back}</div>
    `;
    card.onclick = () => card.classList.toggle('flipped');
    list.appendChild(card);
  });
}

// ── MAPA MENTAL ──
function processMindmap(raw) {
  try {
    const json = extractJSON(raw);
    const data = JSON.parse(json);
    renderMindmap(data);
    switchRightPanel('mindmap-panel', document.querySelector('.rt-btn:nth-child(4)'));
    appendMsg('assistant', `🗺️ Mapa mental de <strong>${data.center}</strong> gerado! Veja no painel direito.`);
    toast('🗺️ Mapa mental gerado!');
  } catch (e) {
    appendMsg('assistant', mdToHtml(raw));
  }
}

function renderMindmap(data) {
  const empty  = document.getElementById('mindmap-empty');
  const canvas = document.getElementById('mindmap-canvas');
  empty.style.display  = 'none';
  canvas.style.display = 'block';

  const W = 580, H = 460;
  canvas.width  = W * 2;
  canvas.height = H * 2;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2); // retina

  // fundo
  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2;
  const nodeCount = data.nodes.length;
  const colors = ['#5dffb0','#3b8cff','#ff6b6b','#ffb347','#c084fc','#34d399'];

  // nó central
  drawNode(ctx, cx, cy, data.center, '#5dffb0', 22, true);

  // nós ao redor
  data.nodes.forEach((node, i) => {
    const angle  = (i / nodeCount) * Math.PI * 2 - Math.PI / 2;
    const radius = 140;
    const nx = cx + Math.cos(angle) * radius;
    const ny = cy + Math.sin(angle) * radius;
    const color = colors[i % colors.length];

    // linha centro → nó
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = color + '55';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawNode(ctx, nx, ny, node.label, color, 13, false);

    // subtópicos
    const childCount = node.children.length;
    node.children.forEach((child, ci) => {
      const spreadAngle = angle + (ci - (childCount - 1) / 2) * 0.45;
      const cr = 80;
      const cpx = nx + Math.cos(spreadAngle) * cr;
      const cpy = ny + Math.sin(spreadAngle) * cr;

      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(cpx, cpy);
      ctx.strokeStyle = color + '33';
      ctx.lineWidth = 1;
      ctx.stroke();

      drawNodeSmall(ctx, cpx, cpy, child, color);
    });
  });
}

function drawNode(ctx, x, y, label, color, fontSize, isCenter) {
  const padding = isCenter ? 18 : 14;
  ctx.font = `bold ${fontSize}px Syne, sans-serif`;
  const tw = ctx.measureText(label).width;
  const bw = tw + padding * 2, bh = isCenter ? 36 : 28;

  ctx.beginPath();
  ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 8);
  ctx.fillStyle = isCenter ? color + '22' : '#1a1d25';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = isCenter ? 2 : 1.5;
  ctx.stroke();

  ctx.fillStyle = isCenter ? color : '#e8eaf0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
}

function drawNodeSmall(ctx, x, y, label, color) {
  ctx.font = '10px DM Sans, sans-serif';
  const tw = ctx.measureText(label).width;
  const bw = tw + 16, bh = 20;

  ctx.beginPath();
  ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 6);
  ctx.fillStyle = '#111318';
  ctx.fill();
  ctx.strokeStyle = color + '66';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = color + 'cc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
}

// ── PALAVRAS-CHAVE ──
async function extractKeywords() {
  if (!pdfText) return;
  try {
    const raw = await callClaudeRaw(
      `Extraia as 12 palavras-chave ou termos técnicos mais importantes deste texto. ` +
      `Retorne apenas uma lista, uma por linha, sem numeração, sem pontuação extra.`
    );
    processKeywords(raw);
  } catch (_) {}
}

function processKeywords(raw) {
  keywords = raw.split('\n').map(s => s.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 15);
  renderKeywords();
  toast('🔑 Palavras-chave extraídas!');
}

function renderKeywords() {
  const list  = document.getElementById('kw-list');
  const empty = document.getElementById('kw-empty');
  list.innerHTML = '';
  empty.style.display = 'none';

  keywords.forEach(kw => {
    const tag = document.createElement('div');
    tag.className = 'kw-tag';
    tag.innerHTML = `<span class="dot"></span>${kw}`;
    tag.onclick = () => {
      document.getElementById('question-input').value = `Explique o conceito de "${kw}"`;
      autoResize(document.getElementById('question-input'));
    };
    list.appendChild(tag);
  });
}

// ── RESUMO ──
function processResumo(raw) {
  const box = document.getElementById('summary-box');
  box.innerHTML = mdToHtml(raw);
  switchRightPanel('summary-panel', document.querySelector('.rt-btn:nth-child(3)'));
  toast('📝 Resumo gerado!');
}

/* =========================================================
   CHAMADAS À API DO CLAUDE
   ========================================================= */
async function callClaude({ system, messages }) {
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.content?.map(c => c.text || '').join('') || '';
}

async function callClaudeRaw(userPrompt) {
  const systemPrompt = pdfText
    ? `Você é um tutor de estudos. Use o conteúdo abaixo:\n\n${pdfText.slice(0, 8000)}`
    : `Você é um tutor de estudos. Responda em português.`;

  return callClaude({
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });
}

/* =========================================================
   UTILITÁRIOS DE UI
   ========================================================= */

// ── appenda mensagem no chat ──
function appendMsg(role, html) {
  const area   = document.getElementById('chat-area');
  const div    = document.createElement('div');
  const id     = 'msg-' + Date.now() + Math.random();
  div.id       = id;
  div.className = `msg ${role}`;
  div.innerHTML = `
    <div class="msg-avatar">${role === 'user' ? '👤' : '🧠'}</div>
    <div class="msg-bubble">${html}</div>
  `;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return id;
}

// ── typing indicator ──
function appendTyping() {
  return appendMsg('assistant', '<div class="typing-dots"><span></span><span></span><span></span></div>');
}

function removeMsg(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ── Markdown básico → HTML ──
function mdToHtml(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h3>$1</h3>')
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/<li>/g, '<ul><li>').replace(/<\/li>\n?<ul>/g, '</li>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

// ── extrai JSON de um texto com possível texto ao redor ──
function extractJSON(text) {
  const start = text.indexOf('[') !== -1 ? text.indexOf('[') : text.indexOf('{');
  const isArr = text.indexOf('[') < text.indexOf('{') || text.indexOf('{') === -1;
  const end   = isArr ? text.lastIndexOf(']') : text.lastIndexOf('}');
  return text.slice(start, end + 1);
}

// ── resize do textarea ──
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── Ctrl+Enter envia ──
function handleKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendMessage(); }
}

// ── barra de progresso ──
function showStatus(name, pct) {
  const s = document.getElementById('pdf-status');
  s.classList.add('visible');
  document.getElementById('file-name-label').textContent = name;
  setProgress(pct);
}

function setProgress(pct) {
  document.getElementById('progress-fill').style.width = pct + '%';
}

// ── stats ──
function updateStats() {
  document.getElementById('stat-pages').textContent = pdfPages;
  document.getElementById('stat-words').textContent = formatNumber(pdfWords);
  document.getElementById('stat-msgs').textContent  = msgCount;
  const score = quizTotal ? Math.round((quizCorrect / quizTotal) * 100) : 0;
  document.getElementById('stat-score').textContent = score + '%';
}

function countWords(text) { return text.trim().split(/\s+/).filter(Boolean).length; }
function formatNumber(n)  { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

// ── pill do header ──
function updatePill(id, text, active) {
  const p = document.getElementById(id);
  p.textContent = text;
  p.className   = 'pill' + (active ? ' active' : '');
}

// ── toast ──
function toast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ── troca de abas esquerda ──
function switchLeftTab(tabId, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + tabId).classList.add('active');
}

// ── troca de painel direito ──
function switchRightPanel(panelId, btn) {
  const panels = ['stats','quiz-panel','summary-panel','mindmap-panel'];
  panels.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  const active = document.getElementById(panelId);
  if (active) active.style.display = 'flex';

  document.querySelectorAll('.rt-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

/* =========================================================
   PERSISTÊNCIA — localStorage
   ========================================================= */
function saveProgress() {
  const data = {
    pdfWords, pdfPages, msgCount, quizCorrect, quizTotal,
    keywords, flashcards,
    history: chatHistory.slice(-20),     // últimas 20 trocas
    savedAt: new Date().toLocaleString('pt-BR')
  };
  try { localStorage.setItem('neurotutor_progress', JSON.stringify(data)); } catch (_) {}
  updateHistoryList(data.savedAt);
}

function loadProgress() {
  try {
    const raw = localStorage.getItem('neurotutor_progress');
    if (!raw) return;
    const data = JSON.parse(raw);

    pdfWords     = data.pdfWords     || 0;
    pdfPages     = data.pdfPages     || 0;
    msgCount     = data.msgCount     || 0;
    quizCorrect  = data.quizCorrect  || 0;
    quizTotal    = data.quizTotal    || 0;
    keywords     = data.keywords     || [];
    flashcards   = data.flashcards   || [];
    chatHistory  = data.history      || [];

    updateStats();
    if (keywords.length)   renderKeywords();
    if (flashcards.length) renderFlashcards();
    if (data.savedAt)      updateHistoryList(data.savedAt);
  } catch (_) {}
}

function updateHistoryList(savedAt) {
  const list = document.getElementById('history-list');
  list.innerHTML = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px;">
      <div style="color:var(--accent);font-weight:600;margin-bottom:4px;">📚 Sessão salva</div>
      <div>Páginas: <strong style="color:var(--text)">${pdfPages}</strong></div>
      <div>Perguntas: <strong style="color:var(--text)">${msgCount}</strong></div>
      <div>Quiz: <strong style="color:var(--text)">${quizCorrect}/${quizTotal}</strong></div>
      <div style="margin-top:6px;font-size:.7rem;opacity:.6">⏰ ${savedAt}</div>
    </div>
  `;
}