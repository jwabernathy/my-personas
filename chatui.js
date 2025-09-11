// chatui.js
(() => {
  if (window.__CHATUI_LOADED) return;
  window.__CHATUI_LOADED = true;

  //
  // 1) STORAGE ABSTRACTION
  //
  let STORAGE;
  (() => {
    try {
      // Attempt to grab and use localStorage
      const ls = window.localStorage;
      const testKey = '__chatui_ls_test__';
      ls.setItem(testKey, testKey);
      ls.removeItem(testKey);
      STORAGE = ls;
      console.log('[CHATUI] localStorage available');
    } catch (err) {
      // Fallback to in-memory object
      console.warn('[CHATUI] localStorage unavailable, using in-memory store', err);
      const mem = {};
      STORAGE = {
        getItem: key => (key in mem ? mem[key] : null),
        setItem: (key, val) => { mem[key] = val; },
        removeItem: key => { delete mem[key]; }
      };
    }
  })();

  //
  // 2) CONFIG
  //
  const GITHUB_BASE   = 'https://raw.githubusercontent.com/jwabernathy/my-personas/main';
  const PERSONA_FILES = ['Aoi.json', 'Eleanor.json', 'Leticia.json'];
  const CACHE_TTL     = 1000 * 60 * 5; // 5 min

  //
  // 3) FETCH + CACHE LOGIC
  //
  async function fetchJSON(file) {
    const url = `${GITHUB_BASE}/${file}`;
    const key = `cache:${url}`;

    // Try reading from STORAGE
    let stored;
    try {
      stored = JSON.parse(STORAGE.getItem(key) || '{}');
    } catch {
      stored = {};
    }
    if (stored.ts > Date.now() - CACHE_TTL) {
      console.log(`[CHATUI] cache hit ${file}`);
      return stored.data;
    }

    console.log(`[CHATUI] fetching ${file}`);
    const res  = await fetch(url);
    const data = await res.json();

    // Write back to STORAGE
    try {
      STORAGE.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
    return data;
  }

  //
  // 4) LOAD PERSONAS
  //
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

  //
  // 5) UI INJECTION
  //
  function initUI() {
    const style = document.createElement('style');
    style.textContent = `
      #chatui-widget { position: fixed; bottom: 20px; right: 20px;
        width: 320px; height: 420px; background: #fff;
        border: 1px solid #ccc; display: flex; flex-direction: column;
        font-family: sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        z-index: 2147483647; }
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

    // Close button
    widget.querySelector('#chatui-close').onclick = () => {
      widget.style.display = 'none';
    };

    // Send handlers
    const sendBtn = widget.querySelector('#chatui-input button');
    const inputEl = widget.querySelector('#chatui-input textarea');
    sendBtn.onclick  = sendMessage;
    inputEl.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    };
  }

  //
  // 6) MESSAGE RENDER
  //
  function appendMessage(role, text) {
    const container = document.getElementById('chatui-messages');
    const msg = document.createElement('div');
    msg.textContent  = (role === 'user' ? 'You: ' : 'Bot: ') + text;
    msg.style.margin = '6px 0';
    container.appendChild(msg);
    msg.scrollIntoView({ behavior: 'smooth' });
  }

  //
  // 7) CHAT + MEMORY
  //
  async function sendMessage() {
    const sel      = document.getElementById('chatui-persona');
    const persona  = personas[sel.value];
    const inputEl  = document.querySelector('#chatui-input textarea');
    const userText = inputEl.value.trim();
    if (!userText) return;

    appendMessage('user', userText);
    inputEl.value = '';

    // Load memory array
    const memKey = `mem:${persona.name}`;
    let memArr;
    try {
      memArr = JSON.parse(STORAGE.getItem(memKey) || '[]');
    } catch {
      memArr = [];
    }
    const memBlock = memArr.length
      ? `\n\nMemory:\n- ${memArr.join('\n- ')}`
      : '';

    // Build system prompt
    const sysPrompt = [
      `You are ${persona.name} – ${persona.title}.`,
      persona.corePurpose,
      memBlock,
      'Speak with warmth and clarity.'
    ].filter(Boolean).join('\n\n');
    const fullPrompt = `${sysPrompt}\n\nUser: ${userText}\nAssistant:`;

    // Call your GPT-2 endpoint
    const res = await fetch('http://127.0.0.1:5000/v1/completions', {
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
    const data  = await res.json();
    const reply = (data.choices?.[0]?.text || '').trim();
    appendMessage('assistant', reply);

    // Extract one memory fact
    const memRes = await fetch('http://127.0.0.1:5000/v1/completions', {
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
    const memData = await memRes.json();
    const fact    = (memData.choices?.[0]?.text || '').trim();
    if (fact) {
      memArr.push(fact);
      try {
        STORAGE.setItem(memKey, JSON.stringify(memArr));
      } catch {}
    }
  }
})();
