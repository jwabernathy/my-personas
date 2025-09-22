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
      const ls = window.localStorage;
      ls.setItem('__chatui_ls_test__', 'test');
      ls.removeItem('__chatui_ls_test__');
      STORAGE = ls;
    } catch {
      const mem = {};
      STORAGE = {
        getItem: key => (key in mem ? mem[key] : null),
        setItem: (key, val) => { mem[key] = val; },
        removeItem: key => { delete mem[key]; }
      };
    }
  })();

  //
  // 2) CONFIGURATION
  //
  const JSON_BASE     = 'https://raw.githubusercontent.com/jwabernathy/my-personas/main';
  const PERSONA_FILES = ['Aoi.json', 'Eleanor.json', 'Leticia.json'];
  const CACHE_TTL     = 1000 * 60 * 5; // 5 minutes

  //
  // 3) FETCH + CACHE LOGIC
  //
  async function fetchJSON(file) {
    const url = `${JSON_BASE}/${file}`;
    const key = `cache:${url}`;
    let stored = {};
    try { stored = JSON.parse(STORAGE.getItem(key) || '{}'); } catch {}
    if (stored.ts > Date.now() - CACHE_TTL) {
      return stored.data;
    }
    const res  = await fetch(url);
    const data = await res.json();
    try {
      STORAGE.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
    return data;
  }

  //
  // 4) LOAD PERSONAS THEN INIT UI
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
          ${Object.keys(personas).map(name => `<option>${name}</option>`).join('')}
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

    widget.querySelector('#chatui-close').onclick = () => {
      widget.style.display = 'none';
    };

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
  // 6) MESSAGE RENDERING
  //
  function appendMessage(role, text, isStreaming = false) {
    const container = document.getElementById('chatui-messages');
    let msg = isStreaming ? container.lastElementChild : null;

    if (!msg || !isStreaming) {
      msg = document.createElement('div');
      msg.textContent = (role === 'user' ? 'You: ' : 'Bot: ') + (text || '');
      msg.style.margin = '6px 0';
      container.appendChild(msg);
    } else {
      msg.textContent += text;
    }
    msg.scrollIntoView({ behavior: 'smooth' });
    return msg;
  }

  //
  // 7) STREAM HELPER
  //
  async function streamToElement(prompt, el) {
    const apiUrl = 'http://127.0.0.1:11435/v1/completions';
    const payload = {
      model:          'llama2:13b',
      prompt,
      max_tokens:     1024,
      max_new_tokens: 1024,
      temperature:    0.7,
      stream:         true
    };
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(payload)
    });

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done   = false;
    let full   = '';

    while (!done) {
      const { value, done: rd } = await reader.read();
      done = rd;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop();

      for (const ev of events) {
        const line = ev.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          done = true;
          break;
        }
        try {
          const msg = JSON.parse(payload);
          const chunk = msg.choices?.[0]?.text || '';
          if (chunk) {
            full += chunk;
            el.textContent += chunk;
          }
        } catch (err) {
          console.error('SSE parse error:', err, payload);
        }
      }
    }

    return full;
  }

  //
  // 8) SEND MESSAGE WITH AUTO-CONTINUE
  //
  async function sendMessage() {
    const personaSel = document.getElementById('chatui-persona');
    const P = personas[personaSel.value];
    const inputEl = document.querySelector('#chatui-input textarea');
    const userText = inputEl.value.trim();
    if (!userText) return;

    // 1) Show user message
    appendMessage('user', userText);
    inputEl.value = '';

    // 2) Build system prompt + memory
    const memKey = `mem:${P.name}`;
    let memArr = [];
    try { memArr = JSON.parse(STORAGE.getItem(memKey) || '[]'); } catch {}

    const memBlock = memArr.length
      ? '\n\nMemory:\n- ' + memArr.join('\n- ')
      : '';

    const sysPrompt = [
      `You are ${P.name} – ${P.title}.`,
      P.corePurpose,
      memBlock,
      'Speak with warmth and clarity.'
    ].filter(Boolean).join('\n\n');

    // 3) First streaming pass
    const basePrompt = `${sysPrompt}\n\nUser: ${userText}\nAssistant:`;
    const botEl = appendMessage('assistant', '', false);
    let accumulated = await streamToElement(basePrompt, botEl);

    // 4) Auto-continue until sentence ends
    while (!/[.?!]$/.test(accumulated.trim())) {
      const contPrompt = [
        sysPrompt,
        `User: ${userText}`,
        `Assistant: ${accumulated.trim()}`,
        `User: Please continue the above answer without repeating yourself.`
      ].join('\n\n');
      // leave botEl as-is, append next stream
      const more = await streamToElement(contPrompt, botEl);
      accumulated += more;
    }

    // 5) (Optional) Extract and store a memory fact
    try {
      const factPrompt = `${sysPrompt}\n\nUser: ${userText}\nAssistant: ${accumulated}\n\nWhat’s one brief fact to remember?`;
      const resFact = await fetch('http://127.0.0.1:11435/v1/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:       'llama2:13b',
          prompt:      factPrompt,
          max_tokens:  40,
          temperature: 0.5
        })
      });
      const j = await resFact.json();
      const fact = (j.choices?.[0]?.text || '').trim();
      if (fact) {
        memArr.push(fact);
        STORAGE.setItem(memKey, JSON.stringify(memArr));
      }
    } catch {
      // ignore memory errors
    }
  }

})();
