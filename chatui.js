// chatui.js
(() => {
  if (window.__CHATUI_LOADED) return;
  window.__CHATUI_LOADED = true;

  // 1) STORAGE ABSTRACTION
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
        getItem: key => mem[key] || null,
        setItem: (key, val) => { mem[key] = val; },
        removeItem: key => { delete mem[key]; }
      };
    }
  })();

  // 2) CONFIG
  const JSON_BASE     = 'https://raw.githubusercontent.com/jwabernathy/my-personas/main';
  const PERSONA_FILES = ['Aoi.json','Eleanor.json','Leticia.json'];
  const CACHE_TTL     = 1000 * 60 * 5; // 5m

  // 3) FETCH+CACHE
  async function fetchJSON(file) {
    const url = `${JSON_BASE}/${file}`, key = `cache:${url}`;
    let stored = {};
    try { stored = JSON.parse(STORAGE.getItem(key)||'{}'); } catch{}
    if (stored.ts > Date.now()-CACHE_TTL) return stored.data;
    const data = await (await fetch(url)).json();
    try { STORAGE.setItem(key,JSON.stringify({ts:Date.now(),data})); } catch{}
    return data;
  }

  // 4) LOAD PERSONAS → UI
  const personas = {};
  (async()=>{
    for(const f of PERSONA_FILES){
      try{
        const j = await fetchJSON(f);
        personas[j.name] = j;
      }catch(e){console.error(e)}
    }
    initUI();
  })();

  // 5) UI
  function initUI(){
    const s=document.createElement('style');
    s.textContent=`
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
    document.head.appendChild(s);

    const w=document.createElement('div');
    w.id='chatui-widget';
    w.innerHTML=`
      <div id="chatui-header">
        <select id="chatui-persona">
          ${Object.keys(personas).map(n=>`<option>${n}</option>`).join('')}
        </select>
        <button id="chatui-close">✕</button>
      </div>
      <div id="chatui-messages"></div>
      <div id="chatui-input">
        <textarea rows="2" placeholder="Type a message…"></textarea>
        <button>Send</button>
      </div>
    `;
    document.body.appendChild(w);

    w.querySelector('#chatui-close').onclick = ()=> w.style.display='none';
    const btn = w.querySelector('#chatui-input button');
    const ta  = w.querySelector('#chatui-input textarea');
    btn.onclick = sendMessage;
    ta.onkeydown = e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}};
  }

  // 6) RENDER
  function appendMessage(role, text, isStream= false){
    const c = document.getElementById('chatui-messages');
    let m = isStream ? c.lastElementChild : null;
    if(!m||!isStream){
      m=document.createElement('div');
      m.textContent = (role==='user'?'You: ':'Bot: ') + (text||'');
      m.style.margin='6px 0';
      c.appendChild(m);
    } else {
      m.textContent += text;
    }
    m.scrollIntoView({behavior:'smooth'});
  }

  // 7) STREAM + AUTO-CONTINUE
  async function requestStream(prompt){
    const apiUrl='http://127.0.0.1:11435/v1/completions';
    const payload={
      model:          'llama2:13b',
      prompt,
      max_tokens:     1024,
      max_new_tokens: 1024,
      temperature:    0.7,
      stream:         true
    };
    const res=await fetch(apiUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'text/event-stream'},
      body:JSON.stringify(payload)
    });
    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let buff='',done=false,full='';
    while(!done){
      const {value,done:rd}=await reader.read();
      done=rd;
      if(value){
        buff+=dec.decode(value,{stream:true});
        const parts=buff.split('\n\n');
        buff=parts.pop();
        for(const p of parts){
          if(!p.startsWith('data: '))continue;
          const js=p.slice(6);
          if(js==='[DONE]'){done=true;break;}
          try{
            const msg = JSON.parse(js);
            const chunk = msg.choices?.[0]?.text;
            if(chunk){full+=chunk;appendMessage('assistant',chunk,true)}
          }catch{}
        }
      }
    }
    return full;
  }

  async function sendMessage(){
    const sel = document.getElementById('chatui-persona');
    const P   = personas[sel.value];
    const ta  = document.querySelector('#chatui-input textarea');
    const txt = ta.value.trim();
    if(!txt)return;
    appendMessage('user',txt);
    ta.value='';

    // build memory block
    const key = `mem:${P.name}`;
    let mem=[];
    try{mem=JSON.parse(STORAGE.getItem(key)||'[]')}catch{}
    const memBlock = mem.length?'\
\n\nMemory:\n- '+mem.join('\n- ') : '';

    // system prompt
    const sys = [
      `You are ${P.name} – ${P.title}.`,
      P.corePurpose,
      memBlock,
      'Speak with warmth and clarity.'
    ].filter(Boolean).join('\n\n');

    const basePrompt = `${sys}\n\nUser: ${txt}\nAssistant:`;

    // loop until we see a sentence end
    let aggregate = '';
    let lastChunk = '';
    do {
      appendMessage('assistant','',false); // placeholder for each pass
      lastChunk = await requestStream(basePrompt + aggregate + (aggregate?'\n\nAssistant (cont.):':''));
      aggregate += lastChunk;
    } while(!/[.?!]$/.test(lastChunk.trim()));

    // optional: extract one memory fact
    try {
      const factPrompt = `${sys}\n\nUser: ${txt}\nAssistant: ${aggregate}\n\nWhat’s one brief fact to remember?`;
      const factRes = await fetch('http://127.0.0.1:11435/v1/completions', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          model:'llama2:13b',
          prompt:factPrompt,
          max_tokens:40,
          temperature:0.5
        })
      });
      const factJson = await factRes.json();
      const fact = (factJson.choices?.[0]?.text||'').trim();
      if(fact){
        mem.push(fact);
        STORAGE.setItem(key,JSON.stringify(mem));
      }
    } catch{}

  }

})();
