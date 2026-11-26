/**
 * Nixy — Cloudflare Pages Function  →  served at  /api/nixy
 * Place this file at:  <project-root>/functions/api/nixy.js
 *
 * SECRETS (never put keys in index.html). Add any of these, then REDEPLOY:
 *   Dashboard → Workers & Pages → your project → Settings → Variables and Secrets → Add (type: Secret)
 *   or CLI:  npx wrangler pages secret put GROQ_API_KEY --project-name <project>
 *
 *   GROQ_API_KEY        chat (fast, free tier)
 *   OPENROUTER_API_KEY  chat (many models)
 *   GEMINI_API_KEY      chat + fallback
 *   TAVILY_API_KEY      web search tool (optional)
 *   HF_TOKEN            image fallback (optional)
 * OPTIONAL BINDING (no key needed): Settings → Functions → Bindings → Workers AI → variable name "AI"
 *   enables chat + FLUX image generation + TTS directly on Cloudflare.
 *
 * Open  /api/nixy  in the browser (GET) to see which secrets are detected (booleans only).
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });

const val = (env, k) => (typeof env[k] === 'string' && env[k].trim() ? env[k].trim() : '');

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });

export async function onRequestGet({ env }) {
  return json({
    ok: true,
    service: 'nixy-proxy',
    configured: {
      workers_ai_binding: !!env.AI,
      GROQ_API_KEY: !!val(env, 'GROQ_API_KEY'),
      OPENROUTER_API_KEY: !!val(env, 'OPENROUTER_API_KEY'),
      GEMINI_API_KEY: !!val(env, 'GEMINI_API_KEY'),
      TAVILY_API_KEY: !!val(env, 'TAVILY_API_KEY'),
      HF_TOKEN: !!val(env, 'HF_TOKEN')
    },
    hint: 'Secrets are only visible to Functions after a new deployment. Missing ones show false.'
  });
}

async function fetchJson(url, init, ms = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${r.status} ${body?.error?.message || body?.error || ''}`.trim());
    return body;
  } finally { clearTimeout(t); }
}

const chatProviders = [
  ['Workers AI', async (env, messages) => {
    if (!env.AI) throw new Error('binding AI not set');
    const r = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages, max_tokens: 4096 });
    return r.response;
  }],
  ['Groq', async (env, messages) => {
    const key = val(env, 'GROQ_API_KEY'); if (!key) throw new Error('GROQ_API_KEY missing');
    const d = await fetchJson('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.6, max_tokens: 4096 })
    });
    return d.choices?.[0]?.message?.content;
  }],
  ['OpenRouter', async (env, messages) => {
    const key = val(env, 'OPENROUTER_API_KEY'); if (!key) throw new Error('OPENROUTER_API_KEY missing');
    const d = await fetchJson('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-Title': 'Nixy' },
      body: JSON.stringify({ model: 'meta-llama/llama-3.3-70b-instruct:free', messages, max_tokens: 4096 })
    });
    return d.choices?.[0]?.message?.content;
  }],
  ['Gemini', async (env, messages) => {
    const key = val(env, 'GEMINI_API_KEY'); if (!key) throw new Error('GEMINI_API_KEY missing');
    const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const d = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents })
    });
    return d.candidates?.[0]?.content?.parts?.map(p => p.text).join('');
  }]
];

async function handleChat(env, body) {
  const messages = (body.messages || []).filter(m => m && m.role && m.content).slice(-30);
  if (!messages.length) return json({ error: 'messages required' }, 400);
  const tried = [];
  for (const [name, fn] of chatProviders) {
    try {
      const text = await fn(env, messages);
      if (text && String(text).trim()) return json({ text: String(text), provider: name });
      tried.push(`${name}: empty`);
    } catch (e) { tried.push(`${name}: ${e.message}`); }
  }
  return json({ error: 'No configured provider answered', tried }, 502);
}

async function handleImage(env, body) {
  const prompt = String(body.prompt || '').slice(0, 1000);
  if (!prompt) return json({ error: 'prompt required' }, 400);
  const tried = [];
  if (env.AI) {
    try {
      const r = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 6 });
      if (r?.image) return json({ url: `data:image/jpeg;base64,${r.image}`, provider: 'Cloudflare FLUX' });
    } catch (e) { tried.push(`workers-ai: ${e.message}`); }
  }
  const hf = val(env, 'HF_TOKEN');
  if (hf) {
    try {
      const r = await fetch('https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell', {
        method: 'POST', headers: { Authorization: `Bearer ${hf}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs: prompt })
      });
      if (!r.ok) throw new Error(String(r.status));
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return json({ url: `data:image/jpeg;base64,${btoa(bin)}`, provider: 'HuggingFace FLUX' });
    } catch (e) { tried.push(`hf: ${e.message}`); }
  }
  return json({ error: 'No image provider configured', tried }, 502);
}

async function handleTts(env, body) {
  if (!env.AI) return json({ error: 'Workers AI binding "AI" not set' }, 502);
  try {
    const r = await env.AI.run('@cf/myshell-ai/melotts', { prompt: String(body.text || '').slice(0, 1000), lang: 'en' });
    if (r?.audio) return json({ url: `data:audio/mpeg;base64,${r.audio}`, provider: 'Cloudflare MeloTTS' });
    return json({ error: 'no audio' }, 502);
  } catch (e) { return json({ error: e.message }, 502); }
}

async function handleSearch(env, body) {
  const key = val(env, 'TAVILY_API_KEY');
  if (!key) return json({ error: 'TAVILY_API_KEY missing' }, 502);
  try {
    const d = await fetchJson('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: String(body.query || '').slice(0, 300), max_results: 5, search_depth: 'basic' })
    }, 15000);
    return json({ results: d.results || [] });
  } catch (e) { return json({ error: e.message }, 502); }
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'invalid JSON' }, 400); }
  switch (body.action) {
    case 'chat': return handleChat(env, body);
    case 'image': return handleImage(env, body);
    case 'tts': return handleTts(env, body);
    case 'search': return handleSearch(env, body);
    default: return json({ error: 'unknown action' }, 400);
  }
}
