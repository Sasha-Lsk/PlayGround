/* WebChat AI — free browser chat client (OpenAI-compatible, OpenCode Zen) + offline demo fallback */
const $ = (s) => document.querySelector(s);
const messagesEl = $('#messages'), inputEl = $('#input'), sendBtn = $('#sendBtn'),
  stopBtn = $('#stopBtn'), modelSelect = $('#modelSelect'), chatListEl = $('#chatList'),
  searchInput = $('#searchInput'), statusLine = $('#statusLine'), modeHint = $('#modeHint');

const DEFAULT_ENDPOINT = 'https://opencode.ai/zen/v1';
const FALLBACK_MODELS = ['mimo-v2.6-flash-free','muse-spark-1.3-contributor-free','muse-spark-1.2-contributor-free','ling-3.1-flash-free','nemotron-3.5-lightning-free','longcat-2.5-preview-free'];
const store = {
  get(k, d){ try{ const v = localStorage.getItem('webchat:'+k); return v==null?d:JSON.parse(v);}catch{return d;} },
  set(k, v){ try{ localStorage.setItem('webchat:'+k, JSON.stringify(v)); }catch{} }
};

let settings = Object.assign({ endpoint: DEFAULT_ENDPOINT, key: '', system: 'You are WebChat AI, a helpful friendly assistant. Answer concisely with markdown when useful.', offline: false },
  store.get('settings', {}));
let conversations = store.get('chats', []);
let activeId = store.get('activeId', null);
let aborter = null;

function save(){ store.set('chats', conversations); store.set('activeId', activeId); store.set('settings', settings); }
function active(){ return conversations.find(c=>c.id===activeId); }
function newChat(title){
  const c = { id: 'c'+Date.now().toString(36), title: title||'New chat', model: modelSelect.value||FALLBACK_MODELS[0], messages: [], created: Date.now() };
  conversations.unshift(c); activeId = c.id; save(); renderList(); renderMessages(); return c;
}
function ensureChat(){ let c = active(); if(!c) c = newChat(); return c; }

/* ---------- models ---------- */
async function loadModels(){
  modelSelect.innerHTML = '<option>loading…</option>';
  try{
    const r = await fetch(settings.endpoint + '/models', { headers: authHeaders() });
    const j = await r.json();
    const ids = (j.data||[]).map(m=>m.id);
    const free = ids.filter(id=>id.endsWith('-free'));
    const list = [...free, ...ids.filter(id=>!id.endsWith('-free'))].slice(0,60);
    if(!list.length) throw new Error('empty');
    modelSelect.innerHTML = list.map(id=>`<option value="${id}">${id}</option>`).join('');
    const cur = active()?.model || FALLBACK_MODELS[0];
    modelSelect.value = list.includes(cur) ? cur : list[0];
  }catch{
    modelSelect.innerHTML = FALLBACK_MODELS.map(id=>`<option value="${id}">${id}${id.endsWith('-free')?' ★free':''}</option>`).join('');
  }
}
function authHeaders(){
  const h = { 'Content-Type':'application/json' };
  h['Authorization'] = 'Bearer ' + (settings.key || 'public');
  return h;
}

/* ---------- markdown (tiny, safe) ---------- */
function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function md(src){
  let codeBlocks = [];
  src = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code)=>{
    codeBlocks.push(`<pre><code data-lang="${esc(lang||'code')}">${esc(code.replace(/\n$/,''))}</code></pre>`); return `\u0000${codeBlocks.length-1}\u0000`;
  });
  let h = esc(src);
  h = h.replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>');
  h = h.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/(^|\W)\*([^*\n]+)\*/g,'$1<em>$2</em>').replace(/`([^`\n]+)`/g,'<code>$1</code>');
  h = h.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/^(?:- |\* )(.*)$/gm,'<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g, m=>`<ul>${m}</ul>`);
  h = h.replace(/^\d+\. (.*)$/gm,'<li>$1</li>');
  h = h.split(/\n{2,}/).map(p=>/^\s*<(h\d|ul|pre|li)/.test(p)?p:`<p>${p.replace(/\n/g,'<br>')}</p>`).join('\n');
  h = h.replace(/\u0000(\d+)\u0000/g, (_,i)=>codeBlocks[+i]);
  return h;
}

/* ---------- render ---------- */
function renderList(){
  const q = (searchInput.value||'').toLowerCase();
  chatListEl.innerHTML = '';
  conversations.filter(c=>c.title.toLowerCase().includes(q)).forEach(c=>{
    const d = document.createElement('div');
    d.className = 'chat-item' + (c.id===activeId?' active':'');
    d.innerHTML = `<span class="t" title="${esc(c.title)}">${esc(c.title)}</span><span class="d">${c.messages.length?Math.ceil(c.messages.length/2):''}</span>`;
    const del = document.createElement('button'); del.className='del'; del.textContent='✕'; del.title='Delete';
    del.onclick = (e)=>{ e.stopPropagation(); conversations = conversations.filter(x=>x.id!==c.id); if(activeId===c.id) activeId = conversations[0]?.id||null; save(); renderList(); renderMessages(); };
    d.onclick = ()=>{ activeId=c.id; modelSelect.value=c.model||modelSelect.value; save(); renderList(); renderMessages(); if(innerWidth<820) $('#sidebar').classList.add('hidden'); };
    d.appendChild(del); chatListEl.appendChild(d);
  });
  if(!conversations.length) chatListEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px">No chats yet — start one below ✨</div>';
}
function bubble(role, content, idx){
  const wrap = document.createElement('div'); wrap.className = 'msg ' + (role==='user'?'user':'ai');
  const av = document.createElement('div'); av.className='avatar'; av.textContent = role==='user'?'🧑':'🤖';
  const b = document.createElement('div'); b.className='bubble';
  b.innerHTML = role==='user' ? esc(content) : md(content);
  if(role!=='user'){
    const actions = document.createElement('div'); actions.className='msg-actions';
    const copy = document.createElement('button'); copy.textContent='⧉ copy';
    copy.onclick = ()=>navigator.clipboard?.writeText(content);
    const re = document.createElement('button'); re.textContent='↻ regenerate';
    re.onclick = ()=>regenerate();
    actions.append(copy, re); b.appendChild(actions);
  }
  wrap.append(av, b); return wrap;
}
function renderMessages(){
  messagesEl.innerHTML = '';
  const c = active();
  if(!c || !c.messages.length){
    messagesEl.innerHTML = `<div class="welcome"><div style="font-size:48px">💬</div><h1>What can I help with?</h1><p>Free AI chat in your browser — streaming answers, code help, writing, ideas &amp; more.<br>Pick a suggestion below or just type.</p></div>`;
    return;
  }
  c.messages.forEach((m,i)=>messagesEl.appendChild(bubble(m.role, m.content, i)));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ---------- offline demo brain ---------- */
function offlineReply(userText){
  const t = userText.toLowerCase();
  if(/^(hi|hello|hey|yo)\b/.test(t)) return `Hey there! 👋 I'm **WebChat AI** running in *offline demo mode*.\n\nI can still help with:\n- Answering questions\n- Writing emails, posts, ideas\n- Explaining code\n\n> Tip: connect to the internet to use free live AI models.`;
  if(t.includes('python') && t.includes('sort')) return `Here's a Python helper to sort a list of dicts:\n\n\`\`\`python\ndef sort_dicts(rows, key, reverse=False):\n    return sorted(rows, key=lambda r: r.get(key))\n\nusers = [{"name": "Zoe", "age": 29}, {"name": "Ana", "age": 24}]\nprint(sort_dicts(users, "age"))\n# → Ana, Zoe\n\`\`\`\nWant it sorted by multiple keys or case-insensitive?`;
  if(t.includes('quantum')) return `**Quantum computing in simple terms:**\n\nClassical bits are like coins — heads *or* tails (0 or 1). Qubits are like *spinning* coins — a mix of both until measured.\n\n- **Superposition** → try many possibilities at once\n- **Entanglement** → qubits linked, act as one system\n- **Interference** → amplify right answers, cancel wrong ones\n\nBest at: optimization, simulation, cryptography. Not magic — just a different kind of computer. ⚛️`;
  if(t.includes('startup') || t.includes('idea')) return `Here are **5 AI startup ideas for 2026**:\n\n1. **Voice-first CRM** — auto-logs calls, drafts follow-ups\n2. **AI tutor for trades** — electricians/plumbers learn with AR + chat\n3. **Inbox triage for small biz** — quotes, invoices, scheduling on autopilot\n4. **Compliance copilot** — keeps AI-generated content legal & on-brand\n5. **Local-models toolkit** — run capable AI fully offline for clinics & schools\n\nWant a landing-page draft or business model for one?`;
  if(t.includes('email') && t.includes('extension')) return `**Subject:** Request for short extension on [project name]\n\nHi [Name],\n\nI hope you're well. I'm writing to ask for a **[2-day] extension** until [new date] so I can polish [deliverable] to the quality bar we want. Everything is on track — [what's done] is complete, and I'm finalizing [what's left].\n\nWould that work on your side? Happy to share a draft today if helpful.\n\nThanks so much,\n[Your name] ✉️`;
  if(t.includes('who are you') || t.includes('your name')) return `I'm **WebChat AI** 💬 — a lightweight chat website. Online I relay free open models; offline I answer from a built-in demo brain so the UI never feels dead.`;
  return `Got it — here's my take on **"${userText.slice(0,80)}"**:\n\nThat's a great prompt! In *offline demo mode* I give short template answers so you can try the full chat experience (history, streaming, markdown, export) without any API key.\n\n- Ask me for **startup ideas**, **quantum computing**, a **Python sorting helper**, or an **extension email** for richer demos\n- Or go online: the app auto-uses free models when the network is available 🌐\n\nWant me to draft, explain, or brainstorm around your topic?`;
}

/* ---------- send ---------- */
async function send(text){
  text = (text||'').trim(); if(!text || aborter) return;
  const c = ensureChat();
  if(c.messages.length===0){ c.title = text.slice(0,42); }
  c.model = modelSelect.value; c.messages.push({ role:'user', content:text });
  save(); renderList(); renderMessages();
  inputEl.value=''; autoresize(); setBusy(true);

  // streaming AI placeholder
  const aiWrap = document.createElement('div'); aiWrap.className='msg ai';
  aiWrap.innerHTML = `<div class="avatar">🤖</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>`;
  messagesEl.appendChild(aiWrap); messagesEl.scrollTop = messagesEl.scrollHeight;
  const aiBubble = aiWrap.querySelector('.bubble');

  const pushActionBar = (full)=>{
    aiBubble.innerHTML = md(full);
    const actions = document.createElement('div'); actions.className='msg-actions';
    const copy=document.createElement('button'); copy.textContent='⧉ copy'; copy.onclick=()=>navigator.clipboard?.writeText(full);
    const re=document.createElement('button'); re.textContent='↻ regenerate'; re.onclick=()=>regenerate();
    actions.append(copy,re); aiBubble.appendChild(actions);
  };

  try{
    if(settings.offline) throw new Error('offline-mode');
    aborter = new AbortController();
    const body = { model: c.model, stream: $('#streamToggle').checked,
      messages: [{ role:'system', content: settings.system }, ...c.messages].slice(-20) };
    const res = await fetch(settings.endpoint + '/chat/completions', {
      method:'POST', headers: authHeaders(), body: JSON.stringify(body), signal: aborter.signal });
    if(!res.ok) throw new Error('HTTP '+res.status);
    let full = '';
    if(body.stream && res.body){
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf='';
      while(true){
        const { done, value } = await reader.read(); if(done) break;
        buf += dec.decode(value, { stream:true });
        const parts = buf.split('\n\n'); buf = parts.pop();
        for(const p of parts){
          const line = p.trim().split('\n').find(l=>l.startsWith('data:'));
          if(!line) continue; const data = line.slice(5).trim();
          if(data==='[DONE]') continue;
          try{ full += JSON.parse(data).choices?.[0]?.delta?.content || ''; }catch{}
          aiBubble.innerHTML = md(full) + ' ▍'; messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }
    } else {
      const j = await res.json();
      full = j.choices?.[0]?.message?.content || '(empty response)';
    }
    if(!full) throw new Error('empty');
    c.messages.push({ role:'assistant', content: full });
    pushActionBar(full);
    setStatus(true);
  }catch(e){
    if(e?.name==='AbortError'){ aiWrap.remove(); setBusy(false); aborter=null; return; }
    // graceful offline fallback (Zen free tier only works inside OpenCode;
    // browser users need their own key in Settings, otherwise demo answers)
    let fake = offlineReply(text);
    const wasOnlineAttempt = !settings.offline;
    if (wasOnlineAttempt)
      fake = `> ⚠️ *Live AI unavailable from a plain browser (free tier is OpenCode-only). Showing a built-in demo answer — add your own OpenAI-compatible API key in ⚙ Settings for live responses.*\n\n---\n\n` + fake;
    if($('#streamToggle').checked && !settings.offline){
      // typewriter so streaming UI still delights
      let i = 0;
      await new Promise(res=>{
        const id = setInterval(()=>{
          i += 3; aiBubble.innerHTML = md(fake.slice(0,i)) + ' ▍';
          messagesEl.scrollTop = messagesEl.scrollHeight;
          if(i>=fake.length){ clearInterval(id); res(); }
        }, 12);
      });
    }
    c.messages.push({ role:'assistant', content: fake });
    pushActionBar(fake);
    setStatus(false, settings.offline ? 'offline demo' : 'demo fallback');
  }
  save(); renderList(); messagesEl.scrollTop = messagesEl.scrollHeight;
  setBusy(false); aborter = null;
}
async function regenerate(){
  const c = active(); if(!c || aborter) return;
  const lastUser = [...c.messages].reverse().find(m=>m.role==='user');
  c.messages = c.messages.filter(m=>m.role==='user' || c.messages.indexOf(m) < c.messages.lastIndexOf(lastUser));
  // remove trailing assistant msgs after last user
  const idx = c.messages.map(m=>m.role).lastIndexOf('user');
  c.messages = c.messages.slice(0, idx+1);
  save(); renderMessages();
  await send(lastUser.content);
  // send() pushed duplicate user msg; remove it
  c.messages.splice(idx+1, 1); save(); renderList(); renderMessages();
}
function setBusy(b){ sendBtn.disabled=b; stopBtn.hidden=!b; }
function setStatus(online, label){
  const dot = statusLine.querySelector('.dot');
  dot.className = 'dot ' + (online?'online':'offline');
  statusLine.childNodes[1].textContent = ' ' + (label || (online?'online':''));
  modeHint.textContent = settings.offline ? 'offline demo mode' : (online ? 'online mode' : 'demo fallback (offline)');
}

/* ---------- events ---------- */
function autoresize(){ inputEl.style.height='auto'; inputEl.style.height = Math.min(160, inputEl.scrollHeight)+'px'; }
$('#composer').addEventListener('submit', e=>{ e.preventDefault(); send(inputEl.value); });
inputEl.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(inputEl.value); } });
inputEl.addEventListener('input', autoresize);
stopBtn.onclick = ()=>aborter?.abort();
$('#newChatBtn').onclick = ()=>{ newChat(); if(innerWidth<820) $('#sidebar').classList.add('hidden'); inputEl.focus(); };
$('#collapseBtn').onclick = ()=>$('#sidebar').classList.toggle('hidden');
searchInput.oninput = renderList;
modelSelect.onchange = ()=>{ const c=active(); if(c){ c.model=modelSelect.value; save(); } };
$('#refreshModels').onclick = loadModels;
$('#exportBtn').onclick = ()=>{
  const c = active(); if(!c) return;
  const mdText = `# ${c.title}\n\n` + c.messages.map(m=>`**${m.role}:**\n${m.content}`).join('\n\n---\n\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([mdText],{type:'text/markdown'}));
  a.download = c.title.replace(/\W+/g,'-').slice(0,40)+'.md'; a.click();
};
$('#clearBtn').onclick = ()=>{ if(confirm('Delete all chats?')){ conversations=[]; activeId=null; save(); renderList(); renderMessages(); } };
document.querySelectorAll('#suggestions button').forEach(b=>b.onclick=()=>send(b.dataset.prompt));
$('#themeBtn').onclick = ()=>{
  const cur = document.documentElement.dataset.theme==='light'?'':'light';
  document.documentElement.dataset.theme = cur; store.set('theme', cur);
  $('#themeBtn').textContent = cur==='light'?'☀️':'🌙';
};
// settings
const modal = $('#settingsModal');
$('#settingsBtn').onclick = ()=>{
  $('#endpointInput').value = settings.endpoint; $('#keyInput').value = settings.key; $('#systemInput').value = settings.system;
  modal.hidden = false;
};
$('#closeSettings').onclick = ()=>modal.hidden = true;
$('#saveSettings').onclick = ()=>{
  settings.endpoint = $('#endpointInput').value.trim()||DEFAULT_ENDPOINT;
  settings.key = $('#keyInput').value.trim(); settings.system = $('#systemInput').value.trim()||settings.system;
  save(); modal.hidden = true; loadModels();
};
$('#demoModeBtn').onclick = ()=>{ settings.offline = !settings.offline; save(); setStatus(!settings.offline, settings.offline?'offline demo':''); modal.hidden=true; };

/* ---------- init ---------- */
document.documentElement.dataset.theme = store.get('theme','')||'';
if(document.documentElement.dataset.theme==='light') $('#themeBtn').textContent='☀️';
if(innerWidth<820) $('#sidebar').classList.add('hidden');
loadModels().then(()=>{ if(!active()) newChat(); else renderMessages(); renderList(); });
renderList(); renderMessages(); autoresize();
fetch(settings.endpoint + '/models').then(()=>setStatus(true,'online')).catch(()=>setStatus(false,'demo fallback'));
