// chatui.js
(() => {
  if (window.__CHATUI_LOADED) return;
  window.__CHATUI_LOADED = true;

  const GITHUB_BASE = 
    'https://raw.githubusercontent.com/your-username/chatui-personas/main';
  const PERSONA_FILES = ['Aoi.json','Eleanor.json','Leticia.json'];
  const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

  // Utility: fetch + cache JSON
  async function fetchJSON(file) {
    const url = `${GITHUB_BASE}/${file}`;
    const key = `cache:${url}`;
    const stored = JSON.parse(localStorage.getItem(key) || '{}');
    if (stored.ts > Date.now() - CACHE_TTL) return stored.data;
    const res = await fetch(url);
    const data = await res.json();
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    return data;
  }

  // Load all personas
  const personas = {};
  (async () => {
    for (const file of PERSONA_FILES) {
      const json = await fetchJSON(file);
      personas[json.name] = json;
    }
    initUI();
  })();

  // Build and inject UI
  function initUI() {
    // 1) Add basic styles
    const style = document.createElement('style');
    style.textContent = `
      #chatui-widget { position: fixed; bottom: 20px; right: 20px;
        width: 300px; height: 400px; background: #fff;
        border: 1px solid #ccc; display: flex; flex-direction: column;
        font-family: sans-serif; }
      #chatui-header { padding: 8px; background: #333; color: #fff; }
      #chatui-messages { flex: 1; overflow-y: auto; padding: 8px; }
      #chatui-input { display: flex; }
      #chatui-input textarea { flex: 1; resize: none; }
      #chatui-input button { width: 60px; }
    `;
    document.head.appendChild(style);

    // 2) Build widget structure
    const widget = document.createElement('div');
    widget.id = 'chatui-widget';
    widget.innerHTML = `
      <div id="chatui-header">
        <select id="chatui-persona">
          ${Object.keys(personas).map(n => `<option>${n}</option>`).join('')}
        </select>
        <button id="chatui-close">✕</button>
      </div>
      <div id="chatui-messages"></div>
      <div id="chatui-input">
        <textarea rows="2" placeholder="Type a message..."></textarea>
        <button>Send</button>
      </div>
    `;
    document.body.appendChild(widget);

    // 3) Wire up events
    widget.querySelector('#chatui-close')
      .onclick = () => widget.style.display = 'none';
    const sendBtn = widget.querySelector('button');
    const input   = widget.querySelector('textarea');
    sendBtn.onclick = () => sendMessage();
    input.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); sendMessage();
      }
    };
  }

  // Append a message bubble
  function appendMessage(role, text) {
    const msg = document.createElement('div');
    msg.textContent = (role === 'user' ? 'You: ' : 'Bot: ') + text;
    document.getElementById('chatui-messages').appendChild(msg);
    msg.scrollIntoView();
  }

  // Core send/receive logic
  async function sendMessage() {
    const sel       = document.getElementById('chatui-persona');
    const persona   = personas[sel.value];
    const input     = document.querySelector('#chatui-input textarea');
    const userText  = input.value.trim();
    if (!userText) return;
    appendMessage('user', userText);
    input.value = '';

    // Load memory
    const memKey = `mem:${persona.name}`;
    const memArr = JSON.parse(localStorage.getItem(memKey) || '[]');
    const memBlock = memArr.length
      ? `\n\nMemory:\n- ${memArr.join('\n- ')}`
      : '';

    // Build prompt
    const sysPrompt = [
      `You are ${persona.name} – ${persona.title}.`,
      persona.corePurpose,
      memBlock,
      'Speak with warmth and clarity.'
    ].filter(Boolean).join('\n\n');
    const fullPrompt = `${sysPrompt}\n\nUser: ${userText}\nAssistant:`;

    // Call GPT-2 endpoint
    const resp = await fetch('http://127.0.0.1:5000/v1/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: 'gpt2',
        prompt: fullPrompt,
        max_new_tokens: 80,
        temperature: 0.7,
        stop: ['\nUser:', '\nAssistant:']
      })
    });
    const data  = await resp.json();
    const reply = (data.choices?.[0]?.text || '').trim();
    appendMessage('assistant', reply);

    // Extract a single memory fact
    const memResp = await fetch('http://127.0.0.1:5000/v1/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: 'gpt2',
        prompt: `${sysPrompt}\n\nUser: ${userText}\nAssistant: ${reply}\n\nWhat’s one brief fact to remember?`,
        max_new_tokens: 20,
        temperature: 0.5,
        stop: ['\n']
      })
    });
    const memData = await memResp.json();
    const fact    = (memData.choices?.[0]?.text || '').trim();
    if (fact) {
      memArr.push(fact);
      localStorage.setItem(memKey, JSON.stringify(memArr));
    }
  }
})();
