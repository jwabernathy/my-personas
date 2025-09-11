// chatui.js
(() => {
  if (window.__CHATUI_LOADED) return;
  window.__CHATUI_LOADED = true;

  // Point to your my-personas repo
  const GITHUB_BASE =
    'https://raw.githubusercontent.com/your-username/my-personas/main';
  const PERSONA_FILES = ['Aoi.json', 'Eleanor.json', 'Leticia.json'];
  const CACHE_TTL      = 1000 * 60 * 5; // 5 minutes

  // Utility: fetch + cache JSON from GitHub
  async function fetchJSON(file) {
    const url = `${GITHUB_BASE}/${file}`;
    const key = `cache:${url}`;
    const stored = JSON.parse(localStorage.getItem(key) || '{}');
    if (stored.ts > Date.now() - CACHE_TTL) {
      console.log(`[CHATUI] cache hit ${file}`);
      return stored.data;
    }
    console.log(`[CHATUI] fetching ${file}`);
    const res  = await fetch(url);
    const data = await res.json();
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    return data;
  }

  // Load all personas into memory
  const personas = {};
  (async () => {
    for (const file of PERSONA_FILES) {
      try {
        const json = await fetchJSON(file);
        personas[json.name] = json;
      } catch (err) {
        console.error(`[CHATUI] failed to load ${file}`, err);
      }
    }
    initUI();
  })();

  // Build and inject the chat widget
  function initUI() {
    const style = document.createElement('style');
    style.textContent = `
      #chatui-widget { position: fixed; bottom: 20px; right: 20px;
        width: 320px; height: 420px; background: #fff;
        border: 1px solid #ccc; display: flex; flex-direction: column;
        font-family: sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
      #chatui-header { padding: 8px; background: #333; color: #fff;
        display: flex; align-items: center; }
      #chatui-header select { flex: 1; margin-right: 8px; }
      #chatui-messages { flex: 1; overflow-y: auto; padding: 8px; }
      #chatui-input { display: flex; border-top: 1px solid #ddd; }
      #chatui-input textarea { flex: 1; border: none; padding: 8px;
        resize: none; outline: none; }
      #chatui-input button { width: 60px; border: none; background: #333;
        color: #fff; cursor: pointer; }
    `;
    document.head.appendChild(style);

    const widget = document.createElement('div');
    widget.id = 'chatui-widget';
    widget.innerHTML = `
      <div id="chatui-header">
        <select id="chatui-persona">
          ${Object.keys(personas).map(name =>
            `<option>${name}</option>`).join('')}
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

    widget.querySelector('#chatui-close')
      .onclick = () => widget.style.display = 'none';

    const sendBtn = widget.querySelector('#chatui-input button');
    const input   = widget.querySelector('#chatui-input textarea');
    sendBtn.onclick = () => sendMessage();
    input.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    };
  }

  // Render a message to the chat window
  function appendMessage(role, text) {
    const container = document.getElementById('chatui-messages');
    const msg       = document.createElement('div');
    msg.textContent = (role === 'user' ? 'You: ' : 'Bot: ') + text;
    msg.style.margin = '6px 0';
    container.appendChild(msg);
    msg.scrollIntoView({ behavior: 'smooth' });
  }

  // Send user text to your GPT-2 endpoint and handle memory
  async function sendMessage() {
    const sel       = document.getElementById('chatui-persona');
    const persona   = personas[sel.value];
    const inputEl   = document.querySelector('#chatui-input textarea');
    const userText  = inputEl.value.trim();
    if (!userText) return;

    appendMessage('user', userText);
    inputEl.value = '';

    // Load and format memory
    const memKey = `mem:${persona.name}`;
    const memArr = JSON.parse(localStorage.getItem(memKey) || '[]');
    const memBlock = memArr.length
      ? `\n\nMemory:\n- ${memArr.join('\n- ')}`
      : '';

    // Build the system prompt
    const sysPrompt = [
      `You are ${persona.name} – ${persona.title}.`,
      persona.corePurpose,
      memBlock,
      'Speak with warmth and clarity.'
    ].filter(Boolean).join('\n\n');
    const fullPrompt = `${sysPrompt}\n\nUser: ${userText}\nAssistant:`;

    // Query your GPT-2 API
    const resp = await fetch('http://127.0.0.1:5000/v1/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    // Extract a memory fact to save
    const memResp = await fetch('http://127.0.0.1:5000/v1/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
