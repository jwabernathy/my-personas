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
  const PERSONA_FILES = ['Aoi.json','Eleanor.json','Leticia.json'];
  const CACHE_TTL     = 1000 * 60 * 5;  // 5 minutes
  const MAX_HISTORY   = 16;            // last X turns of context

  //
  // 3) FETCH + CACHE
  //
  async function fetchJSON(file) {
    const url = `${JSON_BASE}/${file}`, key = `cache:${url}`;
    let stored = {};
    try { stored = JSON.parse(STORAGE.getItem(key)||'{}'); } catch {}
    if (stored.ts > Date.now() - CACHE_TTL) return stored.data;
    const data = await (await fetch(url)).json();
    try { STORAGE.setItem(key, JSON.stringify({ts:Date.now(),data})); } catch {}
    return data;
  }

  //
  // 4) LOAD PERSONAS → INIT UI
  //
  const personas = {};
  (async()=>{
    for(const f of PERSONA_FILES){
      try {
        const j = await fetchJSON(f);
        personas[j.name] = j;
      } catch(e){
        console.error('Failed to load',f,e);
      }
    }
    initUI();
  })();

  //
  // 5) UI INJECTION
  //
  function initUI(){
    const style = document.createElement('style');
    style.textContent = `
      #chatui-widget {position:fixed;bottom:20px;right:20px;width:320px;height:420px;
        background:#fff;border:1px solid #ccc;display:flex;flex-direction:column;
        font-family:sans-serif;box-shadow:0 2px 10px rgba(0,0,0,0.1);z-index:2147483647}
      #chatui-header {padding:8px;background:#333;color:#fff;display:flex;align-items:center}
      #chatui-header select{flex:1;margin-right:8px}
      #chatui-messages{flex:1;overflow-y:auto;padding:8px}
      #chatui-input{display:flex;border-top:1px solid #ddd}
      #chatui-input textarea{flex:1;border:none;padding:8px;resize:none;outline:none}
      #chatui-input button{width:60px;border:none;background:#333;color:#fff;cursor:pointer}
    `;
    document.head.appendChild(style);

    const w = document.createElement('div');
    w.id = 'chatui-widget';
    w.innerHTML = `
      <div id="chatui-header">
        <select id="chatui-persona">
          ${Object.keys(personas).map(n=>`<option>${n}</option>`).join('')}
        </select>
        <button id="chatui-close">✕</button>
      </div>
      <div id="chatui-messages"></div>
      <div id="chatui-input">
        <textarea rows="2" placeholder="Type a message..."></textarea>
        <button>Send</button>
      </div>
    `;
    document.body.appendChild(w);
    w.querySelector('#chatui-close').onclick = ()=> w.style.display='none';

    const btn = w.querySelector('#chatui-input button');
    const ta  = w.querySelector('#chatui-input textarea');
    btn.onclick = sendMessage;
    ta.onkeydown = e => {
      if (e.key==='Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    };
  }

  //
  // 6) APPEND MESSAGE
  //
  function appendMessage(role, text, isStream=false){
    const c = document.getElementById('chatui-messages');
    let m = isStream ? c.lastElementChild : null;
    if(!m||!isStream){
      m=document.createElement('div');
      m.textContent = (role==='user'?'You: ':'Bot: ')+(text||'');
      m.style.margin='6px 0';
      c.appendChild(m);
    } else {
      m.textContent += text;
    }
    m.scrollIntoView({behavior:'smooth'});
    return m;
  }

  //
  // 7) STREAM HELPER (SSE parsing)
  //
  async function streamChunks(prompt, el){
    const res = await fetch('http://127.0.0.1:11435/v1/completions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json','Accept':'text/event-stream' },
      body: JSON.stringify({
        model:          'llama2:13b',
        prompt,
        max_tokens:     1024,
        max_new_tokens: 1024,
        temperature:    0.7,
        stream:         true
      })
    });
    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let buf='', done=false, out='';
    while(!done){
      const {value, done:rd} = await reader.read();
      done = rd;
      if(value){
        buf += dec.decode(value,{stream:true});
        const evs = buf.split(/\r?\n\r?\n/);
        buf = evs.pop();
        for(const ev of evs){
          const line = ev.trim();
          if(!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if(data==='[DONE]'){ done = true; break; }
          try {
            const msg = JSON.parse(data);
            const txt = msg.choices?.[0]?.text || '';
            if(txt){
              out += txt;
              el.textContent += txt;
            }
          } catch(e){
            console.error('Parse SSE chunk',e, data);
          }
        }
      }
    }
    return out;
  }

  //
  // 8) SEND MESSAGE (with history + auto-continue)
  //
  async function sendMessage(){
    const sel    = document.getElementById('chatui-persona');
    const P      = personas[sel.value];
    const ta     = document.querySelector('#chatui-input textarea');
    const userTx = ta.value.trim();
    if(!userTx) return;

    appendMessage('user', userTx);
    ta.value = '';

    // load or init history
    const histKey = `hist:${P.name}`;
    let history = [];
    try { history = JSON.parse(STORAGE.getItem(histKey)||'[]'); }catch{}
    // trim to last turns
    if(history.length > MAX_HISTORY) {
      history = history.slice(history.length - MAX_HISTORY);
    }

    // load or init memory facts
    const memKey = `mem:${P.name}`;
    let memArr = [];
    try { memArr = JSON.parse(STORAGE.getItem(memKey)||'[]'); }catch{}

    const memBlock = memArr.length
      ? '\n\nMemory:\n- ' + memArr.join('\n- ')
      : '';

    // system prompt
    const sys = [
      `You are ${P.name} – ${P.title}.`,
      P.corePurpose,
      memBlock,
      'Speak with warmth and clarity.'
    ].filter(Boolean).join('\n\n');

    // build full prompt with history
    const conv = history.join('\n');
    const basePrompt = [
      sys,
      conv,
      `User: ${userTx}`,
      `Assistant:`
    ].filter(Boolean).join('\n\n');

    // first streaming pass
    const botEl = appendMessage('assistant','',false);
    let reply = await streamChunks(basePrompt, botEl);

    // auto-continue until sentence-final
    while(!/[.?!]$/.test(reply.trim())){
      const contPrompt = [
        sys,
        conv,
        `User: ${userTx}`,
        `Assistant: ${reply.trim()}`,
        `User: Please continue the above answer without repeating yourself.`,
        `Assistant:`
      ].join('\n\n');
      reply += await streamChunks(contPrompt, botEl);
    }

    // update history and persist
    history.push(`User: ${userTx}`);
    history.push(`Assistant: ${reply.trim()}`);
    STORAGE.setItem(histKey, JSON.stringify(history));

    // extract one memory fact (optional)
    try {
      const factPrompt = [
        sys,
        conv,
        `User: ${userTx}`,
        `Assistant: ${reply.trim()}`,
        `\n\nWhat’s one brief fact to remember?`
      ].join('\n\n');
      const factRes = await fetch('http://127.0.0.1:11435/v1/completions',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          model:       'llama2:13b',
          prompt:      factPrompt,
          max_tokens:  40,
          temperature: 0.5
        })
      });
      const factJson = await factRes.json();
      const factText = (factJson.choices?.[0]?.text||'').trim();
      if(factText){
        memArr.push(factText);
        STORAGE.setItem(memKey, JSON.stringify(memArr));
      }
    } catch(e){
      console.error('Memory extraction failed', e);
    }
  }

})();
