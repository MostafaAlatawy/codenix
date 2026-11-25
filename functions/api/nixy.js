/**
 * Cloudflare Pages Function: /api/nixy
 * Automatically reads your Cloudflare Pages Secrets:
 * NVIDIA_API, GEMINI_API_1, DEEPSEEK_API, COHERE_API, GROQ_API, OPEN_API, STAB_API, POLL_API, ELEVEN_API
 */
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const body = await request.json();
    const action = body.action || 'chat';

    if (action === 'image') {
      const prompt = String(body.prompt || 'futuristic purple digital art');

      // 1. Stability AI (STAB_API)
      if (env.STAB_API) {
        try {
          const form = new FormData();
          form.append('prompt', prompt);
          form.append('output_format', 'png');
          const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.STAB_API}`,
              Accept: 'application/json'
            },
            body: form
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.image) {
              return new Response(JSON.stringify({
                url: `data:image/png;base64,${data.image}`,
                provider: 'Stability AI'
              }), { headers: corsHeaders });
            }
          }
        } catch (_) {}
      }

      // 2. Pollinations API (POLL_API)
      const encoded = encodeURIComponent(prompt);
      const pollHeaders = env.POLL_API ? { Authorization: `Bearer ${env.POLL_API}` } : {};
      const pollUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true`;
      return new Response(JSON.stringify({
        url: pollUrl,
        provider: env.POLL_API ? 'Pollinations Pro' : 'Pollinations',
        authHint: Boolean(pollHeaders.Authorization)
      }), { headers: corsHeaders });
    }

    // Chat fallback cascade: NVIDIA_API -> GEMINI_API_1 -> DEEPSEEK_API -> COHERE_API -> GROQ_API -> OPEN_API
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const cleanMessages = rawMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user'),
      content: String(m.content || '')
    }));

    // 1. NVIDIA NIM (NVIDIA_API)
    if (env.NVIDIA_API) {
      try {
        const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.NVIDIA_API}`
          },
          body: JSON.stringify({
            model: 'meta/llama-3.1-70b-instruct',
            messages: cleanMessages,
            temperature: 0.6,
            max_tokens: 2048
          })
        });
        if (res.ok) {
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content;
          if (text) return new Response(JSON.stringify({ text, provider: 'NVIDIA NIM' }), { headers: corsHeaders });
        }
      } catch (_) {}
    }

    // 2. Google Gemini (GEMINI_API_1)
    if (env.GEMINI_API_1) {
      try {
        const systemMsg = cleanMessages.find(m => m.role === 'system')?.content || '';
        const contents = cleanMessages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }));
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_1}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
            contents
          })
        });
        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return new Response(JSON.stringify({ text, provider: 'Gemini 2.0' }), { headers: corsHeaders });
        }
      } catch (_) {}
    }

    // 3. DeepSeek (DEEPSEEK_API)
    if (env.DEEPSEEK_API) {
      try {
        const res = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.DEEPSEEK_API}`
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: cleanMessages
          })
        });
        if (res.ok) {
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content;
          if (text) return new Response(JSON.stringify({ text, provider: 'DeepSeek' }), { headers: corsHeaders });
        }
      } catch (_) {}
    }

    // 4. Cohere (COHERE_API)
    if (env.COHERE_API) {
      try {
        const res = await fetch('https://api.cohere.com/v2/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.COHERE_API}`
          },
          body: JSON.stringify({
            model: 'command-r-plus',
            messages: cleanMessages
          })
        });
        if (res.ok) {
          const data = await res.json();
          const text = data?.message?.content?.[0]?.text;
          if (text) return new Response(JSON.stringify({ text, provider: 'Cohere' }), { headers: corsHeaders });
        }
      } catch (_) {}
    }

    // 5. Groq (GROQ_API)
    if (env.GROQ_API) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.GROQ_API}`
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: cleanMessages
          })
        });
        if (res.ok) {
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content;
          if (text) return new Response(JSON.stringify({ text, provider: 'Groq' }), { headers: corsHeaders });
        }
      } catch (_) {}
    }

    // 6. OpenRouter / OpenAI (OPEN_API)
    if (env.OPEN_API) {
      try {
        const isOpenRouter = env.OPEN_API.startsWith('sk-or-');
        const endpoint = isOpenRouter
          ? 'https://openrouter.ai/api/v1/chat/completions'
          : 'https://api.openai.com/v1/chat/completions';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.OPEN_API}`
          },
          body: JSON.stringify({
            model: isOpenRouter ? 'meta-llama/llama-3.1-8b-instruct:free' : 'gpt-4o-mini',
            messages: cleanMessages
          })
        });
        if (res.ok) {
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content;
          if (text) return new Response(JSON.stringify({ text, provider: isOpenRouter ? 'OpenRouter' : 'OpenAI' }), { headers: corsHeaders });
        }
      } catch (_) {}
    }

    return new Response(JSON.stringify({ error: 'All upstream APIs unavailable, falling back to Puter.js' }), {
      status: 502,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Server error' }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
