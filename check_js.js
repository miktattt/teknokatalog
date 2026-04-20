
const API = '';
const $ = id => document.getElementById(id);
const V = id => ($( id)||{}).value||'';
function show(id,t='block'){const e=$(id);if(e)e.style.display=t}
function hide(id){const e=$(id);if(e)e.style.display='none'}

let currentUser=null, token=localStorage.getItem('tk_token')||null;
let allProducts=[], cart=[], panelOpen=false, activeCat='Tümü';
let editingListId=null, editItems=[], settings={};

// ── API ────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})} };
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch(API+path, opts);
  const data = await res.json();
  if(!res.ok) throw new Error(data.error||'Bir hata oluştu');
  return data;
}
async function apiUpload(path, formData) {
  const res = await fetch(API+path, { method:'POST', headers:token?{Authorization:`Bearer ${token}`}:{}, body:formData });
  const data = await res.json();
  if(!res.ok) throw new Error(data.error||'Yükleme başarısız');
  return data;
}

function toast(msg,d=2800){const e=$('toast');e.textContent=msg;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),d)}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function statusBadge(s){const m={pending:['status-pending','⏳ Onay Bekliyor'],approved:['status-approved','✅ Onaylandı'],rejected:['status-rejected','❌ Reddedildi']};const[c,l]=m[s]||['status-pending',s];return `<span class="status ${c}">${l}</span>`}

// ── INIT ──────────────────────────────────────────────
async function init() {
  show('loading');
  try {
    settings = await api('GET','/api/settings');
    applySettings();
    await loadProducts();
    if(token){
      try{ const u=await api('GET','/api/auth/me'); onLogin(u,false); }
      catch{ token=null; localStorage.removeItem('tk_token'); }
    }
  } catch(e){ console.error(e); }
  hide('loading');
}

function applySettings() {
  const name = settings.catalog_name || 'TeknoKatalog';
  document.title = name;
  // Nav logo
  const navLogo = $('nav-logo');
  if(settings.catalog_logo) {
    navLogo.innerHTML = `<img src="${settings.catalog_logo}" alt="${name}"> <span style="font-size:18px">${name}</span>`;
  } else {
    const parts = name.match(/^(.+?)(\w+)$/) || [name, name.slice(0,-Math.ceil(name.length/3)), name.slice(-Math.ceil(name.length/3))];
    navLogo.innerHTML = `<div class="nav-logo-icon">⚡</div>` + parts[1] + `<span>${parts[2]}</span>`;
  }
  // Auth logo
  const authLogo = $('auth-logo-text');
  if(authLogo){
    const parts = name.match(/^(.+?)(\w+)$/) || [name, name.slice(0,-Math.ceil(name.length/3)), name.slice(-Math.ceil(name.length/3))];
    authLogo.innerHTML = parts[1] + `<span>${parts[2]}</span>`;
  }
  // Catalog title
  $('catalog-page-title').textContent = name;
  if($('catalog-page-sub')) $('catalog-page-sub').textContent = 'Profesyonel ürün yelpazesi — giriş yaparak fiyatlara erişin';
  // WhatsApp button
  updateWaFloat();
  // Settings form fields
  if($('set-name')) $('set-name').value = settings.catalog_name||'';
  if($('set-phone')) $('set-phone').value = settings.whatsapp_phone||'';
  if($('set-wa-msg')) $('set-wa-msg').value = settings.whatsapp_message||'';
  if($('logo-preview') && settings.catalog_logo){
    $('logo-preview').src = settings.catalog_logo;
    show('logo-preview');
  }
}

function updateWaFloat() {
  const btn = $('wa-float');
  if(settings.whatsapp_phone) {
    const msg = encodeURIComponent(settings.whatsapp_message || 'Merhaba, katalog hakkında bilgi almak istiyorum.');
    btn.href = `https://wa.me/${settings.whatsapp_phone}?text=${msg}`;
    show('wa-float','flex');
  } else {
    hide('wa-float');
  }
}

// ── PRODUCTS ──────────────────────────────────────────
async function loadProducts(){
  allProducts = await api('GET','/api/products');
  $('product-count').textContent = allProducts.length;
  // Update hero category stat
  const cats = new Set(allProducts.map(p=>p.category));
  const heroStat = $('hero-cat-stat');
  if(heroStat && cats.size > 0){
    $('hero-cat-count').textContent = cats.size;
    show('hero-cat-stat','block');
  }
  renderCatalog();
}

function renderCatalog(){
  const cats=['Tümü',...new Set(allProducts.map(p=>p.category))];
  $('category-filters').innerHTML = cats.map(c=>`<button class="filter-btn ${c===activeCat?'active':''}" onclick="setCategory(${JSON.stringify(c)})">${esc(c)}</button>`).join('');
  filterProducts();
}
function setCategory(cat){activeCat=cat;renderCatalog()}

function filterProducts(){
  const q=V('search-input').toLowerCase().trim();
  const filtered=allProducts.filter(p=>{
    const mc=activeCat==='Tümü'||p.category===activeCat;
    if(!q) return mc;
    const mq=p.name.toLowerCase().includes(q)||(p.sku||'').toLowerCase().includes(q)||(p.brand||'').toLowerCase().includes(q)||(p.description||'').toLowerCase().includes(q)||(p.category||'').toLowerCase().includes(q);
    return mc&&mq;
  });
  const grid=$('products-grid');
  if(!filtered.length){grid.innerHTML='<div style="color:var(--text3);padding:40px;grid-column:1/-1;text-align:center">Ürün bulunamadı.</div>';return}
  const bmap={new:['badge-new','Yeni'],hot:['badge-hot','Çok Satan'],stock:['badge-stock','Stokta']};
  const getSpecs=p=>(typeof p.specs==='string')?JSON.parse(p.specs||'[]'):(p.specs||[]);
  grid.innerHTML=filtered.map(p=>{
    const inCart=cart.find(i=>i.id===p.id);
    const badge=p.badge&&bmap[p.badge]?`<span class="product-badge ${bmap[p.badge][0]}">${bmap[p.badge][1]}</span>`:'';
    const imgHtml=p.image?`<img src="${esc(p.image)}" alt="${esc(p.name)}" style="width:100%;height:100%;object-fit:contain;padding:8px;background:#fff">`:`<span style="font-size:52px">${p.icon||'📦'}</span>`;
    const price=currentUser
      ?`<span class="product-price">₺${Number(p.price).toLocaleString('tr-TR')}</span>`
      :`<button onclick="openAuth('login')" class="price-lock">🔒 Fiyatı Gör</button>`;
    const outOfStock=p.stock_qty===0;
    const stockLabel=p.stock_qty>0?`<span style="position:absolute;bottom:8px;right:8px;background:rgba(22,163,74,.92);color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:50px">${p.stock_qty} adet</span>`:p.stock_qty===0?'<span style="position:absolute;bottom:8px;right:8px;background:rgba(220,38,38,.92);color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:50px">Stokta Yok</span>':'';
    const addBtn=currentUser
      ?(outOfStock?'<button class="add-btn" disabled style="background:var(--surface2);color:var(--text3);cursor:not-allowed;opacity:.7">Stokta Yok</button>':`<button class="add-btn ${inCart?'added':''}" onclick="event.stopPropagation();addToCart(${p.id})">${inCart?'✓':'+'}</button>`)
      :`<button onclick="event.stopPropagation();openAuth('login')" class="add-btn" style="background:var(--surface2);color:var(--text3);border:1px solid var(--border)">Giriş</button>`;
    return `<div class="product-card" onclick="openProductDetail(${p.id})">
      <div class="product-img">${imgHtml}${badge}${stockLabel}</div>
      <div class="product-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span class="product-cat">${esc(p.category)}${p.brand?' · '+esc(p.brand):''}</span>${p.sku?`<span style="font-size:10px;color:var(--text3);font-family:monospace">${esc(p.sku)}</span>`:''}</div>
        <div class="product-name">${esc(p.name)}</div>
        <div class="product-desc">${esc(p.description||'')}</div>
        <div class="product-specs">${getSpecs(p).slice(0,3).map(s=>`<span class="spec-tag">${esc(s)}</span>`).join('')}</div>
        <div class="product-footer">${price}${addBtn}</div>
      </div>
    </div>`;
  }).join('');
}

function openProductDetail(pid){
  const p=allProducts.find(pr=>pr.id===pid); if(!p) return;
  const bmap={new:['badge-new','Yeni'],hot:['badge-hot','Çok Satan'],stock:['badge-stock','Stokta']};
  const specs=(typeof p.specs==='string')?JSON.parse(p.specs||'[]'):(p.specs||[]);
  const badge=p.badge&&bmap[p.badge]?`<span class="status ${p.badge==='new'?'status-approved':p.badge==='hot'?'status-pending':'status-rejected'}" style="margin-left:8px">${bmap[p.badge][1]}</span>`:'';
  const inCart=cart.find(i=>i.id===p.id);
  const imgHtml=p.image
    ?`<img src="${p.image}" alt="${p.name}" style="width:100%;height:100%;object-fit:contain;padding:12px;background:#f8f9fc;border-radius:12px">`
    :`<span style="font-size:72px">${p.icon||'📦'}</span>`;
  const priceHtml=currentUser
    ?`<span style="font-family:'Plus Jakarta Sans',sans-serif;font-size:28px;font-weight:800;color:var(--text)">₺${Number(p.price).toLocaleString('tr-TR')}</span>`
    :`<button onclick="closeModal();openAuth('login')" style="display:flex;align-items:center;gap:6px;background:var(--accent-light);border:1px dashed var(--accent);border-radius:10px;padding:10px 16px;cursor:pointer;font-family:'Inter',sans-serif;font-size:13px;color:var(--accent);font-weight:600">🔒 Fiyatı görmek için giriş yapın</button>`;
  const addBtnHtml=currentUser?`<button class="add-btn ${inCart?'added':''}" id="detail-add-btn" onclick="addToCart(${p.id});updateDetailBtn(${p.id})" style="padding:12px 24px;font-size:14px;border-radius:10px">${inCart?'✓ Listede':'+ Listeye Ekle'}</button>`:'';
  openModal('',`
    <div style="display:flex;flex-direction:column;gap:0">
      <div style="width:100%;height:300px;background:#f8f9fc;border-radius:14px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:22px;border:1px solid var(--border)">${imgHtml}</div>
      <div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:1px">${p.category}</span>
          ${p.brand?`<span style="font-size:11px;font-weight:600;color:var(--text2)">· ${p.brand}</span>`:''}
          ${p.sku?`<span style="font-size:10px;color:var(--text3);font-family:monospace;background:var(--surface2);padding:3px 8px;border-radius:6px;border:1px solid var(--border)">${p.sku}</span>`:''}
          ${badge}
        </div>
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:800;color:var(--text);line-height:1.2;margin-bottom:10px;letter-spacing:-.4px">${p.name}</div>
        <div style="font-size:14px;color:var(--text2);line-height:1.7;margin-bottom:18px">${p.description||''}</div>
        ${specs.length?`<div style="margin-bottom:18px"><div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Özellikler</div><div style="display:flex;gap:6px;flex-wrap:wrap">${specs.map(s=>`<span style="padding:5px 14px;background:var(--surface2);border-radius:50px;font-size:12px;color:var(--text2);font-weight:500;border:1px solid var(--border)">${s}</span>`).join('')}</div></div>`:''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">
          ${(p.pack_qty||1)>1?`<span style="font-size:12px;background:#f0fdf4;color:var(--success);padding:5px 14px;border-radius:50px;font-weight:600;border:1px solid rgba(22,163,74,.2)">📦 Pakette ${p.pack_qty} adet</span>`:''}
          ${(p.min_qty||1)>1?`<span style="font-size:12px;background:#fffbeb;color:var(--warning);padding:5px 14px;border-radius:50px;font-weight:600;border:1px solid rgba(217,119,6,.2)">⚠️ Min. ${p.min_qty} adet sipariş</span>`:''}
        </div>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding-top:18px;border-top:1px solid var(--border)">${priceHtml}${addBtnHtml}</div>
      </div>
    </div>`,
    [{label:'Kapat',cls:'btn-ghost',action:'closeModal()'}]
  );
}
function updateDetailBtn(pid){
  const btn=$('detail-add-btn'); if(!btn) return;
  const inCart=cart.find(i=>i.id===pid);
  btn.className=`add-btn ${inCart?'added':''}`;
  btn.style.cssText='padding:12px 24px;font-size:14px;border-radius:10px';
  btn.textContent=inCart?'✓ Listede':'+ Listeye Ekle';
}

// ── CART ──────────────────────────────────────────────
function addToCart(pid){
  const p=allProducts.find(pr=>pr.id===pid); if(!p) return;
  const minQty = p.min_qty||1;
  const ex=cart.find(i=>i.id===pid);
  if(ex) ex.qty = Math.max(ex.qty+minQty, minQty);
  else cart.push({id:p.id,sku:p.sku||'',brand:p.brand||'',name:p.name,icon:p.icon||'📦',image:p.image||'',price:p.price,cost_price:p.cost_price||0,qty:minQty,pack_qty:p.pack_qty||1,min_qty:minQty});
  updateFab(); renderPanel(); filterProducts();
  toast(`${p.name} listeye eklendi ✓`);
}
function removeFromCart(pid){cart=cart.filter(i=>i.id!==pid);updateFab();renderPanel();filterProducts()}
function changeQty(pid,d){const i=cart.find(x=>x.id===pid);if(!i)return;const step=i.min_qty||1;i.qty=Math.max(step,i.qty+d*step);renderPanel();updateFab()}
function updateFab(){$('fab-count').textContent=cart.reduce((s,i)=>s+i.qty,0)}
function togglePanel(){panelOpen=!panelOpen;document.getElementById('list-panel').classList.toggle('open',panelOpen);if(panelOpen)renderPanel()}
function renderPanel(){
  const body=$('panel-body'),footer=$('panel-footer');
  if(!cart.length){body.innerHTML=`<div class="list-empty"><div style="font-size:44px;margin-bottom:10px">🛒</div><p style="font-size:13px">Listeniz boş.</p></div>`;footer.style.display='none';return}
  body.innerHTML=cart.map(item=>`
    <div class="list-item">
      <div class="list-item-img">${item.image?`<img src="${esc(item.image)}" alt="">`:`${item.icon||'📦'}`}</div>
      <div class="list-item-info">
        <div class="list-item-name">${esc(item.name)}</div>
        <div class="list-item-price">₺${(item.price*item.qty).toLocaleString('tr-TR')}</div>
      </div>
      <div class="list-item-qty">
        <button class="qty-btn" onclick="changeQty(${item.id},-1)">−</button>
        <span class="qty-val">${item.qty}</span>
        <button class="qty-btn" onclick="changeQty(${item.id},+1)">+</button>
      </div>
      <button class="list-remove" onclick="removeFromCart(${item.id})">🗑</button>
    </div>`).join('');
  const total=cart.reduce((s,i)=>s+i.price*i.qty,0);
  $('panel-total').textContent='₺'+total.toLocaleString('tr-TR');
  footer.style.display='block';
}

async function submitList(){
  if(!cart.length) return;
  const btn=$('submit-list-btn');
  btn.disabled=true; btn.textContent='Gönderiliyor…';
  try{
    await api('POST','/api/lists',{items:cart,note:''});
    cart=[]; updateFab(); renderPanel(); filterProducts();
    if(panelOpen) togglePanel();
    updateAdminBadge();
    toast('Liste gönderildi! Onay bekleniyor ⏳');
    showPage('customer');
  } catch(e){toast('Hata: '+e.message)}
  btn.disabled=false; btn.textContent='📤 Listeyi Gönder & Onaya Sun';
}
function sendWhatsApp(){
  if(!currentUser?.phone){toast('WhatsApp numarası tanımlı değil.');return}
  const lines=cart.map(i=>`${i.icon} ${i.name} × ${i.qty} → ₺${(i.price*i.qty).toLocaleString('tr-TR')}`);
  const total=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const txt=`📋 *${settings.catalog_name||'Katalog'} Listesi*\n👤 ${currentUser.name}\n📅 ${new Date().toLocaleDateString('tr-TR')}\n\n${lines.join('\n')}\n\n💰 *Toplam: ₺${total.toLocaleString('tr-TR')}*`;
  window.open(`https://wa.me/${currentUser.phone}?text=${encodeURIComponent(txt)}`,'_blank');
}

// ── PDF İNDİR ─────────────────────────────────────────
function downloadPDF(){
  if(!cart.length) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const catalogName = settings.catalog_name || 'Katalog';
  const date = new Date().toLocaleDateString('tr-TR');
  const total = cart.reduce((s,i) => s + i.price * i.qty, 0);

  // Header bg
  doc.setFillColor(26, 86, 219);
  doc.rect(0, 0, 210, 40, 'F');

  // Logo/name
  doc.setTextColor(255,255,255);
  doc.setFont('helvetica','bold');
  doc.setFontSize(22);
  doc.text(catalogName, 15, 18);

  doc.setFontSize(10);
  doc.setFont('helvetica','normal');
  doc.text('Urun Listesi', 15, 26);
  doc.text(date, 195, 18, {align:'right'});
  doc.text((currentUser?.name||''), 195, 26, {align:'right'});

  // Table header
  let y = 52;
  doc.setFillColor(240, 242, 248);
  doc.rect(10, y-6, 190, 9, 'F');
  doc.setTextColor(90,96,114);
  doc.setFont('helvetica','bold');
  doc.setFontSize(9);
  doc.text('URUN ADI', 14, y);
  doc.text('SKU', 90, y);
  doc.text('ADET', 120, y, {align:'right'});
  doc.text('BIRIM FIYAT', 155, y, {align:'right'});
  doc.text('TOPLAM', 197, y, {align:'right'});

  y += 6;
  doc.setDrawColor(226,228,233);

  cart.forEach((item, idx) => {
    if(y > 265){ doc.addPage(); y = 20; }
    if(idx % 2 === 0){ doc.setFillColor(250,251,252); doc.rect(10,y-5,190,9,'F'); }
    doc.setTextColor(13,15,20);
    doc.setFont('helvetica','normal');
    doc.setFontSize(9);
    const name = item.name.length > 38 ? item.name.slice(0,36)+'...' : item.name;
    doc.text(name, 14, y);
    doc.text(item.sku||'-', 90, y);
    doc.text(String(item.qty), 120, y, {align:'right'});
    doc.text('TL '+Number(item.price).toLocaleString('tr-TR'), 155, y, {align:'right'});
    doc.text('TL '+Number(item.price*item.qty).toLocaleString('tr-TR'), 197, y, {align:'right'});
    doc.setDrawColor(226,228,233);
    doc.line(10, y+3, 200, y+3);
    y += 10;
  });

  // Total box
  y += 4;
  doc.setFillColor(26,86,219);
  doc.rect(120, y-6, 80, 12, 'F');
  doc.setTextColor(255,255,255);
  doc.setFont('helvetica','bold');
  doc.setFontSize(11);
  doc.text('TOPLAM:', 125, y+1);
  doc.text('TL '+total.toLocaleString('tr-TR'), 197, y+1, {align:'right'});

  // Footer
  doc.setTextColor(150,160,180);
  doc.setFont('helvetica','normal');
  doc.setFontSize(8);
  doc.text(catalogName + ' — ' + date, 105, 290, {align:'center'});

  doc.save(`${catalogName}-liste-${Date.now()}.pdf`);
  toast('PDF indiriliyor… ⬇️');
}

// ── AUTH ──────────────────────────────────────────────
function togglePass(id, btn){
  const inp=$(id);
  if(!inp) return;
  const isPass = inp.type==='password';
  inp.type = isPass ? 'text' : 'password';
  btn.textContent = isPass ? '🙈' : '👁';
}
function openAuth(tab){document.getElementById('auth-overlay').classList.add('open');switchAuthTab(tab)}
function switchAuthTab(tab){
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
  document.querySelector(`[onclick="switchAuthTab('${tab}')"]`).classList.add('active');
  $('login-form').style.display=tab==='login'?'block':'none';
  $('register-form').style.display=tab==='register'?'block':'none';
  $('auth-error').style.display='none';
}
function authErr(msg){const e=$('auth-error');e.innerHTML=`⚠ ${msg}`;e.style.display='block'}

async function doLogin(){
  const btn=$('login-btn');btn.disabled=true;btn.textContent='Giriş yapılıyor…';
  $('auth-error').style.display='none';
  try{
    const{token:t,user}=await api('POST','/api/auth/login',{email:V('login-email').trim(),password:V('login-pass')});
    token=t;localStorage.setItem('tk_token',t);onLogin(user);
  }catch(e){authErr(e.message)}
  btn.disabled=false;btn.textContent='Giriş Yap →';
}
async function doRegister(){
  const pass=V('reg-pass');
  if(pass.length < 8){authErr('Şifre en az 8 karakter olmalı.');return;}
  if(!V('reg-name').trim()){authErr('Ad Soyad zorunlu.');return;}
  const btn=$('register-btn');btn.disabled=true;btn.textContent='Hesap oluşturuluyor…';
  $('auth-error').style.display='none';
  try{
    const{token:t,user}=await api('POST','/api/auth/register',{name:V('reg-name').trim(),email:V('reg-email').trim(),phone:V('reg-phone'),password:pass});
    token=t;localStorage.setItem('tk_token',t);onLogin(user);
  }catch(e){authErr(e.message)}
  btn.disabled=false;btn.textContent='Hesap Oluştur →';
}
function onLogin(user,closeOverlay=true){
  currentUser=user;
  if(closeOverlay) document.getElementById('auth-overlay').classList.remove('open');
  $('nav-avatar').textContent=(user.name||'?')[0].toUpperCase();
  $('nav-name').textContent=(user.name||'').split(' ')[0];
  show('nav-user-info','flex');show('nav-logout-btn');
  hide('nav-login-btn');hide('nav-reg-btn');
  show('tab-customer');hide('guest-banner');
  show('list-fab','flex');
  if(settings.whatsapp_phone) show('wa-float','flex');
  if(user.role==='admin') show('tab-admin');
  filterProducts();updateAdminBadge();
  if(closeOverlay) toast(`Hoş geldiniz, ${(user.name||'').split(' ')[0]}!`);
}
function doLogout(){
  currentUser=null;token=null;cart=[];
  localStorage.removeItem('tk_token');
  hide('nav-user-info');hide('nav-logout-btn');
  show('nav-login-btn');show('nav-reg-btn');
  hide('tab-customer');hide('tab-admin');show('guest-banner');hide('list-fab');
  document.getElementById('list-panel').classList.remove('open');panelOpen=false;
  updateFab();filterProducts();showPage('catalog');
}

// ── NAV ───────────────────────────────────────────────
function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  $('page-'+id).classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  const tab=document.querySelector(`[onclick="showPage('${id}')"]`);
  if(tab) tab.classList.add('active');
  if(id==='customer') loadCustomerPage();
  if(id==='admin') loadAdminPage();
}
function switchAdminTab(tab){
  ['lists','products','users','reports','settings'].forEach(t=>{
    $('admin-section-'+t).style.display=t===tab?'block':'none';
    const el=$('admin-tab-'+t); if(el) el.classList.toggle('active',t===tab);
  });
  if(tab==='products'){ loadProductsSection(); setTimeout(()=>fillCatSelect('prod-cat'),300); }
  if(tab==='users') loadUsersTable();
  if(tab==='lists') loadAdminLists();
  if(tab==='reports') loadReports();
  if(tab==='settings') applySettings();
}

// ── CUSTOMER ──────────────────────────────────────────
async function loadCustomerPage(){
  if(!currentUser) return;
  $('prof-name').value=currentUser.name;
  $('prof-phone').value=currentUser.phone||'';
  const lists=await api('GET','/api/lists/my');
  const pending=lists.filter(l=>l.status==='pending').length;
  const approved=lists.filter(l=>l.status==='approved').length;
  const totalVal=lists.filter(l=>l.status==='approved').reduce((s,l)=>s+l.total,0);
  $('cust-stats').innerHTML=`
    <div class="stat-card"><div class="stat-num">${lists.length}</div><div class="stat-label">Toplam Liste</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--warning)">${pending}</div><div class="stat-label">Bekleyen</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--success)">${approved}</div><div class="stat-label">Onaylanan</div></div>
    <div class="stat-card"><div class="stat-num">₺${totalVal>=1000?Math.round(totalVal/1000)+'K':totalVal.toLocaleString('tr-TR')}</div><div class="stat-label">Onaylı Tutar</div></div>`;
  const con=$('customer-lists-container');
  if(!lists.length){con.innerHTML='<div style="padding:32px;text-align:center;color:var(--text3)">Henüz liste göndermediniz.</div>';return}
  con.innerHTML=`<table class="data-table">
    <thead><tr><th>Liste No</th><th>Tarih</th><th>İçerik</th><th>Tutar</th><th>Durum</th><th>İşlem</th></tr></thead>
    <tbody>${lists.map(l=>`
      <tr style="${l.status==='pending'?'background:#fffcf0':''}">
        <td><strong style="font-size:12px">${l.list_code}</strong></td>
        <td style="color:var(--text3);font-size:12px">${new Date(l.created_at).toLocaleDateString('tr-TR')}</td>
        <td style="font-size:12px">${l.items.slice(0,2).map(i=>i.name).join(', ')}${l.items.length>2?` +${l.items.length-2}`:''}</td>
        <td><strong>₺${Number(l.total).toLocaleString('tr-TR')}</strong></td>
        <td>${statusBadge(l.status)}</td>
        <td style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="viewList(${l.id},'customer')">Görüntüle</button>
          ${l.status==='pending'?`<button class="btn btn-edit btn-sm" onclick="openEditModal(${l.id})">✏️</button>`:''}
        </td>
      </tr>`).join('')}
    </tbody></table>`;
}
async function saveProfile(){
  try{
    const user=await api('PUT','/api/auth/profile',{name:V('prof-name'),phone:V('prof-phone')});
    currentUser={...currentUser,...user};
    $('nav-name').textContent=currentUser.name.split(' ')[0];
    toast('Profil güncellendi ✓');
  }catch(e){toast('Hata: '+e.message)}
}

// ── ADMIN ─────────────────────────────────────────────
async function updateAdminBadge(){
  if(!currentUser||currentUser.role!=='admin') return;
  try{
    const lists=await api('GET','/api/lists');
    const n=lists.filter(l=>l.status==='pending').length;
    $('admin-badge').textContent=n;
    $('admin-badge').style.display=n>0?'flex':'none';
  }catch{}
}
async function loadAdminPage(){
  if(!currentUser||currentUser.role!=='admin') return;
  await loadAdminLists();
}
async function loadAdminLists(){
  const con=$('admin-lists-container');
  try{
    const lists=await api('GET','/api/lists');
    $('pending-num').textContent=lists.filter(l=>l.status==='pending').length;
    if(!lists.length){con.innerHTML='<div style="padding:32px;text-align:center;color:var(--text3)">Henüz liste gönderilmedi.</div>';return}
    con.innerHTML=`<table class="data-table">
      <thead><tr><th>Liste No</th><th>Müşteri</th><th>Tarih</th><th>İçerik</th><th>Tutar</th><th>Durum</th><th>İşlem</th></tr></thead>
      <tbody>${lists.map(l=>`
        <tr style="${l.status==='pending'?'background:#fffcf0':''}">
          <td><strong style="font-size:12px">${l.list_code}</strong></td>
          <td><div style="font-weight:600;font-size:13px">${esc(l.user_name)}</div>${l.user_phone?`<div style="font-size:11px;color:var(--text3)">${esc(l.user_phone)}</div>`:''}</td>
          <td style="color:var(--text3);font-size:12px">${new Date(l.created_at).toLocaleDateString('tr-TR')}</td>
          <td style="font-size:12px">${l.items.slice(0,2).map(i=>esc(i.name)).join(', ')}${l.items.length>2?` +${l.items.length-2}`:''}</td>
          <td><strong>₺${Number(l.total).toLocaleString('tr-TR')}</strong></td>
          <td>${statusBadge(l.status)}</td>
          <td style="display:flex;gap:4px;align-items:center">
            <button class="btn btn-ghost btn-sm" onclick="viewList(${l.id},'admin')">Detay</button>
            <div style="display:flex;gap:4px">${l.status==='pending'?`<button class="btn btn-success btn-sm" onclick="approveList(${l.id})">✓ Onayla</button><button class="btn btn-danger btn-sm" onclick="rejectList(${l.id})">✗ Ret</button>`:l.status==='approved'?'<span style="font-size:11px;color:var(--success);font-weight:600">✓ Onaylandi</span>':'<span style="font-size:11px;color:var(--danger);font-weight:600">✗ Reddedildi</span>'}</div>
          </td>
        </tr>`).join('')}
      </tbody></table>`;
  }catch(e){con.innerHTML=`<div style="padding:20px;color:var(--danger)">${e.message}</div>`}
}

// ── EXCEL DISA AKTARMA ──────────────────────────────────
function exportProductsExcel(){
  const products = window._allAdminProducts||[];
  if(!products.length){toast('Once urunler sekmesini acin');return}
  const cols=['SKU','Marka','Urun Adi','Kategori','Aciklama','Fiyat','Ikon','Badge','Paket Adedi','Min Siparis','Stok'];
  const rows=products.map(p=>[
    p.sku||'',p.brand||'',p.name,p.category,p.description||'',
    p.price,p.icon||'',p.badge||'',p.pack_qty||1,p.min_qty||1,
    p.stock_qty!=null?p.stock_qty:-1
  ]);
  const xml=`<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#1A56DB" ss:Pattern="Solid"/><Font ss:Color="#FFFFFF" ss:Bold="1"/></Style></Styles><Worksheet ss:Name="Urunler"><Table><Row>${cols.map(c=>`<Cell ss:StyleID="h"><Data ss:Type="String">${c}</Data></Cell>`).join('')}</Row>${rows.map(r=>`<Row>${r.map(v=>`<Cell><Data ss:Type="${typeof v==='number'?'Number':'String'}">${v}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`;
  const blob=new Blob([xml],{type:'application/vnd.ms-excel;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='urunler.xls';a.click();
  URL.revokeObjectURL(url);
  toast('Excel indiriliyor');
}

// ── EXCEL ICEYE AKTARMA ──────────────────────────────────
async function importProductsExcel(input){
  const file=input.files[0]; if(!file) return;
  const ext=file.name.split('.').pop().toLowerCase();
  
  if(ext==='csv'){
    const text=await file.text();
    const lines=text.split('\n').map(l=>l.trim()).filter(Boolean);
    const headers=lines[0].split(',').map(h=>h.replace(/"/g,'').trim().toLowerCase());
    const products=lines.slice(1).map(line=>{
      const vals=line.match(/(".*?"|[^,]+)/g)||[];
      const clean=vals.map(v=>v.replace(/^"|"$/g,'').trim());
      const obj={};
      headers.forEach((h,i)=>obj[h]=clean[i]||'');
      return {
        sku:obj['sku']||obj['urun kodu']||'',
        brand:obj['marka']||'',
        name:obj['urun adi']||obj['adi']||obj['name']||'',
        category:obj['kategori']||obj['category']||'Genel',
        description:obj['aciklama']||obj['description']||'',
        price:parseFloat(obj['fiyat']||obj['price']||0)||0,
        icon:obj['ikon']||obj['icon']||'',
        badge:obj['badge']||'',
        pack_qty:parseInt(obj['paket adedi']||obj['pack_qty']||1)||1,
        min_qty:parseInt(obj['min siparis']||obj['min_qty']||1)||1,
        stock_qty:parseInt(obj['stok']||obj['stock_qty']||-1)||(-1),
      };
    }).filter(p=>p.name);
    await doImport(products);
  } else {
    toast('CSV formati destekleniyor. Excel icin once CSV olarak kaydedin.');
  }
  input.value='';
}

async function doImport(products){
  if(!products.length){toast('Iceri aktarilacak urun bulunamadi');return}
  const confirmed=confirm(`${products.length} urun iceri aktarilacak. Devam?`);
  if(!confirmed) return;
  try{
    const res=await api('POST','/api/products/bulk-import',{products});
    toast(`${res.ok} urun eklendi${res.fail?', '+res.fail+' hata':''}`);
    await loadProducts(); await loadProductsSection();
  }catch(e){toast('Hata: '+e.message)}
}
async function approveList(id){
  const note=await showNotePrompt('Onay Notu (opsiyonel)','Musteriye iletilecek not...');
  if(note===null) return;
  try{await api('PUT',`/api/lists/${id}/approve`,{admin_note:note});toast('Liste onaylandi');loadAdminLists();updateAdminBadge()}
  catch(e){toast('Hata: '+e.message)}
}
async function rejectList(id){
  const note=await showNotePrompt('Red Nedeni','Musteriye red nedenini yazin...');
  if(note===null) return;
  try{await api('PUT',`/api/lists/${id}/reject`,{admin_note:note});toast('Liste reddedildi');loadAdminLists();updateAdminBadge()}
  catch(e){toast('Hata: '+e.message)}
}
function showNotePrompt(title,placeholder){
  return new Promise(resolve=>{
    openModal(title,'<div class="form-group" style="margin:0"><textarea class="form-control" id="admin-note-inp" placeholder="'+esc(placeholder)+'" rows="3" style="resize:none;width:100%"></textarea></div>',
      [{label:'Gönder',cls:'btn-primary',action:"window._noteRes(document.getElementById('admin-note-inp').value||'');closeModal()"},
       {label:'İptal',cls:'btn-ghost',action:"window._noteRes(null);closeModal()"}]);
    window._noteRes=resolve;
  });
}

// Varsayılan kategoriler
const DEFAULT_CATS = ['Laptop','Telefon','Tablet','Aksesuar','Yazıcı','Monitör','Ağ Ekipmanı','Depolama'];

function getCategoryList(products){
  const saved = JSON.parse(localStorage.getItem('extra_cats')||'[]');
  const fromProducts = products.map(p=>p.category);
  return [...new Set([...DEFAULT_CATS,...saved,...fromProducts])].filter(Boolean).sort();
}

function fillCatSelect(selectId, selectedVal=''){
  const sel = $(selectId); if(!sel) return;
  const cats = getCategoryList(window._allAdminProducts||[]);
  sel.innerHTML = cats.map(c=>`<option value="${c}" ${c===selectedVal?'selected':''}>${c}</option>`).join('');
}

function addCategoryEp(){
  const name = prompt('Yeni kategori adı:');
  if(!name||!name.trim()) return;
  const saved = JSON.parse(localStorage.getItem('extra_cats')||'[]');
  if(!saved.includes(name.trim())){
    saved.push(name.trim());
    localStorage.setItem('extra_cats', JSON.stringify(saved));
  }
  const sel=$('ep-cat');
  if(sel){ const opt=document.createElement('option'); opt.value=name.trim(); opt.textContent=name.trim(); opt.selected=true; sel.appendChild(opt); }
  toast('Kategori eklendi: '+name.trim());
}

function addCategory(){
  const name = prompt('Yeni kategori adı:');
  if(!name||!name.trim()) return;
  const saved = JSON.parse(localStorage.getItem('extra_cats')||'[]');
  if(!saved.includes(name.trim())){
    saved.push(name.trim());
    localStorage.setItem('extra_cats', JSON.stringify(saved));
  }
  fillCatSelect('prod-cat', name.trim());
  toast('Kategori eklendi: '+name.trim());
}

function deleteCategory(){
  const sel = $('prod-cat');
  const val = sel?.value;
  if(!val) return;
  const used = (window._allAdminProducts||[]).some(p=>p.category===val);
  if(used){ toast('Bu kategori ürünlerde kullanılıyor, silinemez!'); return; }
  if(!confirm(`"${val}" kategorisini silmek istiyor musunuz?`)) return;
  const saved = JSON.parse(localStorage.getItem('extra_cats')||'[]');
  localStorage.setItem('extra_cats', JSON.stringify(saved.filter(c=>c!==val)));
  fillCatSelect('prod-cat');
  toast('Kategori silindi');
}

async function loadProductsSection(){
  const products=await api('GET','/api/products');
  window._allAdminProducts = products;
  fillCatSelect('prod-cat');
  const cats=[...new Set(products.map(p=>p.category))];
  $('admin-cat-stats').innerHTML=`<div style="display:grid;gap:8px">${cats.map(cat=>{
    const n=products.filter(p=>p.category===cat).length;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--bg);border-radius:8px"><span style="font-weight:500;font-size:13px">${cat}</span><span style="background:var(--accent-light);color:var(--accent);padding:2px 10px;border-radius:50px;font-size:12px;font-weight:600">${n}</span></div>`;
  }).join('')}</div>`;
  $('products-tbody').innerHTML=products.map(p=>{
    const imgCell=p.image?`<img src="${p.image}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px">`:`<span style="font-size:24px">${p.icon||'📦'}</span>`;
    return `<tr>
      <td>${imgCell}</td>
      <td style="font-family:monospace;font-size:12px;color:var(--text3)">${p.sku||'—'}</td>
      <td><strong style="font-size:13px">${p.name}</strong>${p.brand?`<div style="font-size:11px;color:var(--accent);margin-top:1px">${p.brand}</div>`:''}</td>
      <td style="font-size:13px">${p.category}</td>
      <td><strong>₺${Number(p.price).toLocaleString('tr-TR')}</strong></td>
      <td style="text-align:center">${p.stock_qty===0?'<span class="status status-rejected" style="font-size:10px">Yok</span>':p.stock_qty>0?`<span class="status status-approved" style="font-size:10px">${p.stock_qty}</span>`:`<span style="color:var(--text3);font-size:16px">∞</span>`}</td>
      <td style="font-size:12px;color:var(--text2)">${(p.min_qty||1)>1?`Min: ${p.min_qty}`:'—'}${(p.pack_qty||1)>1?`<br>Paket: ${p.pack_qty}`:''}  </td>
      <td style="display:flex;gap:4px"><button class="btn btn-edit btn-sm" onclick="openEditProduct(${p.id})">✏️</button><button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id})">Sil</button></td>
    </tr>`;
  }).join('');
}

// Görsel önizleme (ekle formu)
function previewImage(input, previewId, hiddenId) {
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = $(previewId);
    img.src = e.target.result;
    img.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function uploadImageFile(inputEl) {
  const file = inputEl.files[0]; if(!file) return null;
  const fd = new FormData();
  fd.append('image', file);
  try {
    const data = await apiUpload('/api/products/upload-image', fd);
    return data.url;
  } catch(e) { toast('Görsel yükleme hatası: '+e.message); return null; }
}

async function addProduct(){
  const name=V('prod-name'),price=parseFloat(V('prod-price'));
  if(!name||!price){toast('Ürün adı ve fiyat zorunlu!');return}
  const specs=V('prod-specs').split(',').map(s=>s.trim()).filter(Boolean);
  let imageUrl = '';
  const imgInput = $('add-img-input');
  if(imgInput.files[0]) imageUrl = await uploadImageFile(imgInput) || '';
  try{
    await api('POST','/api/products',{
      sku:V('prod-sku'), brand:V('prod-brand'),
      name, category:V('prod-cat'), description:V('prod-desc'),
      price, cost_price: parseFloat(V('prod-cost-price'))||0,
      icon:V('prod-icon')||'📦', image:imageUrl, specs, badge:V('prod-badge'),
      pack_qty: parseInt(V('prod-pack-qty'))||1,
      min_qty:  parseInt(V('prod-min-qty'))||1,
      stock_qty: V('prod-stock-qty')===''?-1:parseInt(V('prod-stock-qty')),
    });
    ['prod-sku','prod-brand','prod-name','prod-desc','prod-price','prod-cost-price','prod-icon','prod-specs'].forEach(id=>$(id).value='');
    $('prod-pack-qty').value='1'; $('prod-min-qty').value='1'; $('prod-stock-qty').value='';
    $('add-img-input').value='';
    $('add-img-preview').style.display='none';
    await loadProducts();await loadProductsSection();
    toast('Ürün eklendi ✓');
  }catch(e){toast('Hata: '+e.message)}
}

async function deleteProduct(id){
  if(!confirm('Bu ürünü silmek istediğinizden emin misiniz?')) return;
  try{await api('DELETE',`/api/products/${id}`);await loadProducts();await loadProductsSection();toast('Ürün silindi')}
  catch(e){toast('Hata: '+e.message)}
}

function openEditProduct(id){
  const p=allProducts.find(p=>p.id===id); if(!p) return;
  const specs=(typeof p.specs==='string')?JSON.parse(p.specs||'[]'):(p.specs||[]);
  const cats=getCategoryList(window._allAdminProducts||[]);
  const badges=[['','Yok'],['new','Yeni'],['hot','Çok Satan'],['stock','Stokta']];
  openModal(`✏️ Ürünü Düzenle`,`
    <div class="form-row">
      <div class="form-group"><label>Ürün Kodu (SKU)</label><input class="form-control" id="ep-sku" value="${esc(p.sku||'')}"></div>
      <div class="form-group"><label>Marka</label><input class="form-control" id="ep-brand" value="${esc(p.brand||'')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Ürün Adı</label><input class="form-control" id="ep-name" value="${esc(p.name)}"></div>
      <div class="form-group"><label>Kategori</label><div style="display:flex;gap:6px"><select class="form-control" id="ep-cat" style="flex:1">${cats.map(c=>`<option value="${esc(c)}" ${c===p.category?'selected':''}>${esc(c)}</option>`).join('')}</select><button type="button" class="btn btn-edit btn-sm" onclick="addCategoryEp()" style="flex-shrink:0;padding:0 12px;font-size:18px">+</button></div></div>
    </div>
    <div class="form-group"><label>Açıklama</label><input class="form-control" id="ep-desc" value="${esc(p.description||'')}"></div>
    <div class="form-row">
      <div class="form-group"><label>Satış Fiyatı (₺)</label><input class="form-control" id="ep-price" type="number" min="0" step="0.01" value="${p.price}"></div>
      <div class="form-group"><label>Alış Fiyatı (₺) <span style="font-weight:400;color:var(--text3)">(maliyet)</span></label><input class="form-control" id="ep-cost-price" type="number" min="0" step="0.01" value="${p.cost_price||0}"><div style="font-size:11px;color:var(--text3);margin-top:4px">Müşteriye görünmez</div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Emoji İkon</label><input class="form-control" id="ep-icon" value="${esc(p.icon||'📦')}"></div>
      <div class="form-group"><label>Stok Adedi</label><input class="form-control" id="ep-stock-qty" type="number" min="-1" value="${p.stock_qty!=null?p.stock_qty:-1}"><div style="font-size:11px;color:var(--text3);margin-top:4px">-1 = limitsiz, 0 = stokta yok</div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Paket İçeriği (adet)</label><input class="form-control" id="ep-pack-qty" type="number" min="1" value="${p.pack_qty||1}"><div style="font-size:11px;color:var(--text3);margin-top:4px">Pakette kaç adet var</div></div>
      <div class="form-group"><label>Min. Sipariş Adedi</label><input class="form-control" id="ep-min-qty" type="number" min="1" value="${p.min_qty||1}"><div style="font-size:11px;color:var(--text3);margin-top:4px">Müşteri en az kaç adet seçebilir</div></div>
    </div>
    <div class="form-group"><label>Özellikler (virgülle)</label><input class="form-control" id="ep-specs" value="${esc(specs.join(', '))}"></div>
    <div class="form-group"><label>Rozet</label><select class="form-control" id="ep-badge">${badges.map(([v,l])=>`<option value="${v}" ${v===p.badge?'selected':''}>${l}</option>`).join('')}</select></div>
    <div class="form-group">
      <label>Ürün Görseli</label>
      ${p.image?`<img src="${p.image}" id="ep-img-preview" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px">`:`<div id="ep-img-preview"></div>`}
      <div class="img-upload-area" onclick="document.getElementById('ep-img-input').click()">
        <input type="file" id="ep-img-input" accept=".jpg,.jpeg,.png,.webp" style="display:none" onchange="previewEditImage(this)">
        <div class="upload-icon">🖼️</div>
        <div class="upload-text">${p.image?'Görseli değiştirmek için tıklayın':'Görsel yüklemek için tıklayın'}</div>
      </div>
      <div class="img-upload-hint">📐 Önerilen: <strong>800 × 600 px</strong> · Format: JPG, PNG, WebP · Maks: <strong>2 MB</strong></div>
      <input type="hidden" id="ep-img-current" value="${p.image||''}">
    </div>`,
    [{label:'💾 Kaydet',cls:'btn-primary',action:`saveEditProduct(${id})`},{label:'Vazgeç',cls:'btn-ghost',action:'closeModal()'}]
  );
}
function previewEditImage(input){
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    let prev=$('ep-img-preview');
    if(prev.tagName!=='IMG'){prev.outerHTML=`<img id="ep-img-preview" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px" src="">`;prev=$('ep-img-preview')}
    prev.src=e.target.result;
  };
  reader.readAsDataURL(file);
}
async function saveEditProduct(id){
  const name=V('ep-name'),price=parseFloat(V('ep-price'));
  if(!name||!price){toast('Ürün adı ve fiyat zorunlu!');return}
  const specs=V('ep-specs').split(',').map(s=>s.trim()).filter(Boolean);
  let imageUrl = $('ep-img-current')?.value || '';
  const imgInput=$('ep-img-input');
  if(imgInput?.files[0]){
    const uploaded = await uploadImageFile(imgInput);
    if(uploaded) imageUrl = uploaded;
  }
  try{
    await api('PUT',`/api/products/${id}`,{
      sku:V('ep-sku'), brand:V('ep-brand'),
      name, category:V('ep-cat'), description:V('ep-desc'),
      price, cost_price: parseFloat(V('ep-cost-price'))||0,
      icon:V('ep-icon')||'📦', image:imageUrl, specs, badge:V('ep-badge'),
      pack_qty: parseInt(V('ep-pack-qty'))||1,
      min_qty:  parseInt(V('ep-min-qty'))||1,
      stock_qty: V('ep-stock-qty')===''?-1:parseInt(V('ep-stock-qty')),
    });
    closeModal();await loadProducts();await loadProductsSection();
    toast('Ürün güncellendi ✓');
  }catch(e){toast('Hata: '+e.message)}
}

// ════════════════════════════════════════════════════════
// REPORTS
// ════════════════════════════════════════════════════════
const _rpt = { lists:[], period:'month', breakdown:'daily' };

function fmtMoney(v){
  if(v>=1000000) return '₺'+(v/1000000).toFixed(1)+'M';
  if(v>=1000)    return '₺'+(v/1000).toFixed(1)+'K';
  return '₺'+Math.round(v).toLocaleString('tr-TR');
}

function setReportPeriod(p){
  _rpt.period=p;
  ['today','week','month','year','all'].forEach(x=>{
    const el=$('rp-'+x); if(el) el.classList.toggle('active',x===p);
  });
  // Yıl seçiciyi sadece "yıl" modunda aktif göster
  const ySel=$('report-year');
  if(ySel) ySel.style.opacity=p==='year'?'1':'0.4';
  renderReports();
}

function setReportBreakdown(b){
  _rpt.breakdown=b;
  ['daily','weekly','monthly'].forEach(x=>{
    const el=$('rb-'+x); if(el) el.classList.toggle('active',x===b);
  });
  renderBreakdown(getFilteredLists());
}

async function loadReports(){
  if(!currentUser||currentUser.role!=='admin') return;
  // Yıl seçici
  const yearSel=$('report-year');
  const thisYear=new Date().getFullYear();
  if(yearSel&&yearSel.options.length===0){
    for(let y=thisYear;y>=thisYear-4;y--){
      const o=document.createElement('option');o.value=y;o.textContent=y;yearSel.appendChild(o);
    }
  }
  try{
    const lists=await api('GET','/api/lists');
    _rpt.lists=lists;
    window._reportLists=lists;
    renderReports();
  }catch(e){toast('Rapor yüklenemedi: '+e.message);}
}

function getFilteredLists(){
  const now=new Date();
  const lists=_rpt.lists;
  switch(_rpt.period){
    case 'today':{
      const d=now.toDateString();
      return lists.filter(l=>new Date(l.created_at).toDateString()===d);
    }
    case 'week':{
      const start=new Date(now);
      const day=now.getDay();
      start.setDate(now.getDate()-(day===0?6:day-1));
      start.setHours(0,0,0,0);
      return lists.filter(l=>new Date(l.created_at)>=start);
    }
    case 'month':{
      return lists.filter(l=>{
        const d=new Date(l.created_at);
        return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();
      });
    }
    case 'year':{
      const year=parseInt($('report-year')?.value)||now.getFullYear();
      return lists.filter(l=>new Date(l.created_at).getFullYear()===year);
    }
    default: return lists;
  }
}

function calcMetrics(filtered){
  const approved=filtered.filter(l=>l.status==='approved');
  const revenue=approved.reduce((s,l)=>s+l.total,0);
  let cost=0;
  approved.forEach(l=>{
    l.items.forEach(i=>{
      if(i.cost_price>0) cost+=i.cost_price*(i.qty||1);
    });
  });
  const profit=revenue-cost;
  const margin=revenue>0?(profit/revenue*100):0;
  return{
    total:filtered.length,
    approved:approved.length,
    rejected:filtered.filter(l=>l.status==='rejected').length,
    pending:filtered.filter(l=>l.status==='pending').length,
    revenue,cost,profit,margin,
    avgOrder:approved.length?revenue/approved.length:0,
    hasCost:cost>0
  };
}

function renderReports(){
  const filtered=getFilteredLists();
  const m=calcMetrics(filtered);
  const kpiEl=$('report-kpis');
  if(!kpiEl) return;
  kpiEl.innerHTML=`
    <div class="stat-card"><div class="stat-num">${m.total}</div><div class="stat-label">Toplam Liste</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--warning)">${m.pending}</div><div class="stat-label">Bekleyen</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--success)">${m.approved}</div><div class="stat-label">Onaylanan</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--danger)">${m.rejected}</div><div class="stat-label">Reddedilen</div></div>
    <div class="stat-card" style="border-color:rgba(37,99,235,.2);background:var(--accent-light)"><div class="stat-num" style="color:var(--accent)">${fmtMoney(m.revenue)}</div><div class="stat-label">Ciro</div></div>
    ${m.hasCost?`
    <div class="stat-card" style="border-color:rgba(217,119,6,.2)"><div class="stat-num" style="color:var(--warning)">${fmtMoney(m.cost)}</div><div class="stat-label">Maliyet</div></div>
    <div class="stat-card" style="border-color:rgba(22,163,74,.2);background:#f0fdf4"><div class="stat-num" style="color:var(--success)">${fmtMoney(m.profit)}</div><div class="stat-label">Kar</div></div>
    <div class="stat-card" style="border-color:rgba(22,163,74,.2)"><div class="stat-num" style="color:var(--success)">${m.margin.toFixed(1)}%</div><div class="stat-label">Kar Marjı</div></div>
    `:''}
    <div class="stat-card"><div class="stat-num">${fmtMoney(m.avgOrder)}</div><div class="stat-label">Ort. Sipariş</div></div>
  `;
  renderBreakdown(filtered);
  renderTopProducts(filtered);
  renderTopCustomers(filtered);
}

function _buildBreakdownHtml(rows,hasCost,labelKey){
  if(!rows.length) return`<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:24px">Bu dönemde veri yok.</td></tr>`;
  return rows.map(r=>{
    const profit=r.revenue-r.cost;
    const margin=r.revenue>0?(profit/r.revenue*100):0;
    const avg=r.approved?Math.round(r.revenue/r.approved):0;
    return`<tr>
      <td><strong>${esc(r[labelKey])}</strong></td>
      <td>${r.total}</td>
      <td><span class="status status-approved">${r.approved}</span></td>
      <td><span class="status status-rejected">${r.rejected}</span></td>
      <td><strong style="color:var(--accent)">₺${r.revenue.toLocaleString('tr-TR')}</strong></td>
      ${hasCost?`<td style="color:var(--warning)">₺${r.cost.toLocaleString('tr-TR')}</td><td style="color:var(--success);font-weight:700">₺${profit.toLocaleString('tr-TR')}</td><td style="color:var(--success)">%${margin.toFixed(1)}</td>`:''}
      <td style="color:var(--text3)">₺${avg.toLocaleString('tr-TR')}</td>
    </tr>`;
  }).join('');
}

function _breakdownHead(firstCol,hasCost){
  return`<tr>
    <th>${firstCol}</th><th>Toplam</th><th>Onaylanan</th><th>Reddedilen</th><th>Ciro</th>
    ${hasCost?'<th style="color:var(--warning)">Maliyet</th><th style="color:var(--success)">Kar</th><th style="color:var(--success)">Marj</th>':''}
    <th>Ort. Sipariş</th>
  </tr>`;
}

function renderBreakdown(filtered){
  if(!filtered) filtered=getFilteredLists();
  const b=_rpt.breakdown;
  const map={};

  filtered.forEach(l=>{
    const d=new Date(l.created_at);
    let key,label;
    if(b==='daily'){
      key=d.toISOString().slice(0,10);
      label=d.toLocaleDateString('tr-TR');
    } else if(b==='weekly'){
      const day=d.getDay();
      const start=new Date(d);
      start.setDate(d.getDate()-(day===0?6:day-1));
      start.setHours(0,0,0,0);
      const end=new Date(start);end.setDate(start.getDate()+6);
      key=start.toISOString().slice(0,10);
      label=`${start.toLocaleDateString('tr-TR')} – ${end.toLocaleDateString('tr-TR')}`;
    } else {
      const months=['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
      key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      label=`${months[d.getMonth()]} ${d.getFullYear()}`;
    }
    if(!map[key]) map[key]={label,total:0,approved:0,rejected:0,revenue:0,cost:0,ts:d.getTime()};
    map[key].total++;
    if(l.status==='approved'){
      map[key].approved++;
      map[key].revenue+=l.total;
      l.items.forEach(i=>{if(i.cost_price>0)map[key].cost+=i.cost_price*(i.qty||1);});
    }
    if(l.status==='rejected') map[key].rejected++;
  });

  const rows=Object.values(map).sort((a,x)=>x.ts-a.ts).slice(0,60);
  const hasCost=rows.some(r=>r.cost>0);
  const labels={'daily':'Tarih','weekly':'Hafta','monthly':'Ay'};

  const head=$('report-breakdown-head');
  const body=$('report-breakdown-body');
  if(head) head.innerHTML=_breakdownHead(labels[b],hasCost);
  if(body) body.innerHTML=_buildBreakdownHtml(rows,hasCost,'label');
}

function renderTopProducts(filtered){
  const approved=(filtered||getFilteredLists()).filter(l=>l.status==='approved');
  const pmap={};
  approved.forEach(l=>{
    l.items.forEach(i=>{
      if(!pmap[i.name]) pmap[i.name]={name:i.name,qty:0,revenue:0,cost:0};
      pmap[i.name].qty+=i.qty||1;
      pmap[i.name].revenue+=i.price*(i.qty||1);
      if(i.cost_price>0) pmap[i.name].cost+=i.cost_price*(i.qty||1);
    });
  });
  const top=Object.values(pmap).sort((a,b)=>b.revenue-a.revenue).slice(0,10);
  const maxRev=top[0]?.revenue||1;
  const hasCost=top.some(p=>p.cost>0);
  $('report-top-products').innerHTML=top.length
    ?top.map((p,i)=>`
        <div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px">
            <span style="font-size:13px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i+1}. ${esc(p.name)}</span>
            <div style="text-align:right;flex-shrink:0;font-size:11px;line-height:1.5">
              <div style="font-weight:700;color:var(--accent)">${p.qty} adet</div>
              <div style="color:var(--text2)">₺${p.revenue.toLocaleString('tr-TR')}</div>
              ${hasCost&&p.cost>0?`<div style="color:var(--success)">Kar: ₺${(p.revenue-p.cost).toLocaleString('tr-TR')}</div>`:''}
            </div>
          </div>
          <div style="background:var(--surface2);border-radius:50px;height:5px">
            <div style="background:var(--accent);height:5px;border-radius:50px;width:${Math.round(p.revenue/maxRev*100)}%"></div>
          </div>
        </div>`).join('')
    :'<div style="color:var(--text3);padding:20px;text-align:center">Henüz onaylı sipariş yok.</div>';
}

function renderTopCustomers(filtered){
  const approved=(filtered||getFilteredLists()).filter(l=>l.status==='approved');
  const cmap={};
  approved.forEach(l=>{
    const k=l.user_name||l.user_email||'?';
    if(!cmap[k]) cmap[k]={name:k,phone:l.user_phone||'',count:0,revenue:0};
    cmap[k].count++;cmap[k].revenue+=l.total;
  });
  const top=Object.values(cmap).sort((a,b)=>b.revenue-a.revenue).slice(0,10);
  $('report-top-customers').innerHTML=top.length
    ?top.map((c,i)=>`
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="width:26px;height:26px;background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;flex-shrink:0">${i+1}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div>
            <div style="font-size:11px;color:var(--text3)">${c.count} liste · ₺${c.revenue.toLocaleString('tr-TR')}</div>
          </div>
        </div>`).join('')
    :'<div style="color:var(--text3);padding:20px;text-align:center">Veri yok.</div>';
}

// ── CSV Export ──────────────────────────────────────────
function exportCSV(){
  const lists = window._reportLists;
  if(!lists||!lists.length){toast('Önce Raporlar sekmesini açın.');return}
  const rows=[['Liste No','Müşteri','Telefon','Tarih','Ürünler','Tutar (₺)','Maliyet (₺)','Kar (₺)','Durum']];
  lists.forEach(l=>{
    let cost=0;
    l.items.forEach(i=>{if(i.cost_price>0)cost+=i.cost_price*(i.qty||1);});
    rows.push([
      l.list_code,
      l.user_name||'',
      l.user_phone||'',
      new Date(l.created_at).toLocaleDateString('tr-TR'),
      l.items.map(i=>i.name+'×'+(i.qty||1)).join(' | '),
      l.total,
      cost>0?cost:'',
      cost>0?(l.total-cost):'',
      l.status==='approved'?'Onaylandı':l.status==='rejected'?'Reddedildi':'Bekliyor'
    ]);
  });
  const csv = rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='listeler.csv'; a.click();
  URL.revokeObjectURL(url);
  toast('CSV indiriliyor ⬇️');
}

// ── Excel Export ────────────────────────────────────────
function exportExcel(){
  const lists = window._reportLists;
  if(!lists||!lists.length){toast('Önce Raporlar sekmesini açın.');return}

  // Basit XLSX (XML tabanlı, harici kütüphane gerektirmez)
  const cols = ['Liste No','Müşteri','Telefon','Tarih','Ürün Sayısı','Tutar (₺)','Durum'];
  const rows = lists.map(l=>[
    l.list_code,
    l.user_name||'',
    l.user_phone||'',
    new Date(l.created_at).toLocaleDateString('tr-TR'),
    l.items.reduce((s,i)=>s+i.qty,0),
    l.total,
    l.status==='approved'?'Onaylandı':l.status==='rejected'?'Reddedildi':'Bekliyor'
  ]);

  // Ürün detay sheet
  const prodCols = ['Liste No','Müşteri','Ürün Adı','SKU','Adet','Birim Fiyat','Alış Fiyatı','Toplam Satış','Toplam Maliyet','Kar'];
  const prodRows = [];
  lists.forEach(l=>{
    l.items.forEach(item=>{
      const qty=item.qty||1;
      const satış=item.price*qty;
      const maliyet=(item.cost_price||0)*qty;
      prodRows.push([l.list_code, l.user_name||'', item.name, item.sku||'', qty, item.price, item.cost_price||0, satış, maliyet, satış-maliyet]);
    });
  });

  function makeSheet(columns, data){
    const maxCol = String.fromCharCode(64+columns.length);
    const header = columns.map((c,i)=>`<Cell ss:StyleID="header"><Data ss:Type="String">${c}</Data></Cell>`).join('');
    const dataRows = data.map(row=>'<Row>'+row.map((v,i)=>{
      const type = typeof v==='number'?'Number':'String';
      return `<Cell><Data ss:Type="${type}">${v}</Data></Cell>`;
    }).join('')+'</Row>').join('');
    return `<Table><Row>${header}</Row>${dataRows}</Table>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#1A56DB" ss:Pattern="Solid"/>
      <Font ss:Color="#FFFFFF" ss:Bold="1"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Listeler">
    ${makeSheet(cols, rows)}
  </Worksheet>
  <Worksheet ss:Name="Urun Detaylari">
    ${makeSheet(prodCols, prodRows)}
  </Worksheet>
</Workbook>`;

  const blob = new Blob([xml],{type:'application/vnd.ms-excel;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='listeler.xls'; a.click();
  URL.revokeObjectURL(url);
  toast('Excel indiriliyor ⬇️');
}

// ── TOPLU FİYAT GÜNCELLEME ──────────────────────────────
function openBulkPriceModal(){
  const cats = [...new Set(allProducts.map(p=>p.category))];
  openModal('🏷️ Toplu Fiyat Güncelleme',`
    <div style="background:#fff8e6;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;font-size:12px;color:#92400e;margin-bottom:16px">
      ⚠️ Bu işlem seçili kategorideki tüm ürün fiyatlarını günceller. Geri alınamaz.
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Kategori</label>
        <select class="form-control" id="bulk-cat">
          <option value="__all__">— Tümü —</option>
          ${cats.map(c=>`<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>İşlem</label>
        <select class="form-control" id="bulk-op">
          <option value="pct_up">% Artır</option>
          <option value="pct_down">% İndir</option>
          <option value="fixed_up">₺ Artır</option>
          <option value="fixed_down">₺ İndir</option>
          <option value="set">= Sabit Fiyat Yap</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Değer</label>
      <input class="form-control" id="bulk-val" type="number" min="0" placeholder="10">
      <div style="font-size:11px;color:var(--text3);margin-top:4px">Örnek: %10 artış için "10" girin</div>
    </div>
    <div id="bulk-preview" style="background:var(--bg);border-radius:8px;padding:12px;margin-top:8px;font-size:12px;color:var(--text2)">
      Değer girin, önizleme burada görünür.
    </div>`,
    [{label:'✅ Uygula',cls:'btn-primary',action:'applyBulkPrice()'},{label:'Vazgeç',cls:'btn-ghost',action:'closeModal()'}]
  );
  // Canlı önizleme
  setTimeout(()=>{
    ['bulk-cat','bulk-op','bulk-val'].forEach(id=>{
      const el=$(id); if(el) el.addEventListener('input', previewBulkPrice);
    });
  },100);
}

function previewBulkPrice(){
  const cat = V('bulk-cat');
  const op  = V('bulk-op');
  const val = parseFloat(V('bulk-val'))||0;
  const targets = allProducts.filter(p=> cat==='__all__' || p.category===cat);
  if(!val||!targets.length){$('bulk-preview').innerHTML='Değer girin, önizleme burada görünür.';return}
  const sample = targets.slice(0,4);
  const lines = sample.map(p=>{
    let newPrice = p.price;
    if(op==='pct_up')   newPrice = p.price*(1+val/100);
    if(op==='pct_down') newPrice = p.price*(1-val/100);
    if(op==='fixed_up') newPrice = p.price+val;
    if(op==='fixed_down') newPrice = p.price-val;
    if(op==='set')      newPrice = val;
    newPrice = Math.max(0, Math.round(newPrice));
    return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">
      <span>${p.name}</span>
      <span>₺${p.price.toLocaleString('tr-TR')} → <strong style="color:var(--accent)">₺${newPrice.toLocaleString('tr-TR')}</strong></span>
    </div>`;
  });
  const more = targets.length>4 ? `<div style="margin-top:6px;color:var(--text3)">+${targets.length-4} ürün daha etkilenecek</div>` : '';
  $('bulk-preview').innerHTML = lines.join('')+more;
}

async function applyBulkPrice(){
  const cat = V('bulk-cat');
  const op  = V('bulk-op');
  const val = parseFloat(V('bulk-val'));
  if(!val||val<=0){toast('Geçerli bir değer girin.');return}
  const targets = allProducts.filter(p=> cat==='__all__' || p.category===cat);
  if(!targets.length){toast('Ürün bulunamadı.');return}
  if(!confirm(`${targets.length} ürünün fiyatı güncellenecek. Emin misiniz?`)) return;

  let ok=0, fail=0;
  for(const p of targets){
    let newPrice = p.price;
    if(op==='pct_up')   newPrice = p.price*(1+val/100);
    if(op==='pct_down') newPrice = p.price*(1-val/100);
    if(op==='fixed_up') newPrice = p.price+val;
    if(op==='fixed_down') newPrice = p.price-val;
    if(op==='set')      newPrice = val;
    newPrice = Math.max(0, Math.round(newPrice*100)/100);
    const specs = typeof p.specs==='string'?JSON.parse(p.specs||'[]'):(p.specs||[]);
    try{
      await api('PUT',`/api/products/${p.id}`,{...p,price:newPrice,specs,image:p.image||'',sku:p.sku||'',brand:p.brand||'',pack_qty:p.pack_qty||1,min_qty:p.min_qty||1,stock_qty:p.stock_qty!=null?p.stock_qty:-1,cost_price:p.cost_price||0});
      ok++;
    } catch{ fail++; }
  }
  closeModal();
  await loadProducts();
  await loadProductsSection();
  toast(`${ok} ürün güncellendi${fail?' ('+fail+' hata)':''}  ✓`);
}

// ════════════════════════════════════════════════════════
async function loadUsersTable(){
  try{
    const users=await api('GET','/api/users');
    $('users-tbody').innerHTML=users.map(u=>`
      <tr>
        <td><strong style="font-size:13px">${u.name}</strong></td>
        <td style="color:var(--text3);font-size:12px">${u.email}</td>
        <td style="font-size:12px">${u.phone||'—'}</td>
        <td><span style="background:var(--accent-light);color:var(--accent);padding:2px 8px;border-radius:50px;font-size:12px;font-weight:600">${u.list_count||0}</span></td>
        <td style="font-size:12px;color:var(--text3)">${new Date(u.created_at).toLocaleDateString('tr-TR')}</td>
      </tr>`).join('');
  }catch(e){toast('Hata: '+e.message)}
}

// ── SETTINGS ──────────────────────────────────────────
async function saveSetting(key, value){
  try{
    settings = await api('PUT','/api/settings',{[key]:value});
    applySettings();
    toast('Ayar kaydedildi ✓');
  }catch(e){toast('Hata: '+e.message)}
}
async function uploadLogo(input){
  const file=input.files[0]; if(!file) return;
  const fd=new FormData(); fd.append('logo',file);
  try{
    const data=await apiUpload('/api/settings/logo',fd);
    settings.catalog_logo=data.logo;
    applySettings();
    toast('Logo güncellendi ✓');
  }catch(e){toast('Hata: '+e.message)}
}

// ── VIEW LIST ─────────────────────────────────────────
async function viewList(id,context){
  const endpoint=context==='admin'?'/api/lists':'/api/lists/my';
  const lists=await api('GET',endpoint);
  const list=lists.find(l=>l.id===id); if(!list) return;
  const itemsHtml=list.items.map(i=>`
    <div style="display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
      <span style="font-size:18px;margin-right:10px">${i.icon||'📦'}</span>
      <span style="flex:1;font-weight:500;font-size:13px">${i.name}</span>
      <span style="color:var(--text3);margin:0 10px;font-size:12px">×${i.qty}</span>
      <span style="font-weight:700;color:var(--accent);font-size:13px">₺${(i.price*i.qty).toLocaleString('tr-TR')}</span>
    </div>`).join('');
  const btns=[];
  if(context==='admin'&&list.status==='pending'){btns.push({label:'Onayla',cls:'btn-success',action:`closeModal();approveList(${id})`});btns.push({label:'Reddet',cls:'btn-danger',action:`closeModal();rejectList(${id})`});}
  btns.push({label:'Kapat',cls:'btn-ghost',action:'closeModal()'});
  openModal(`📋 ${list.list_code}`,`
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;padding:14px;background:var(--bg);border-radius:10px">
      <div><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase">Müşteri</div><div style="font-weight:600;margin-top:3px;font-size:13px">${list.user_name||currentUser.name}</div></div>
      <div><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase">Tarih</div><div style="font-weight:600;margin-top:3px;font-size:13px">${new Date(list.created_at).toLocaleDateString('tr-TR')}</div></div>
      <div><div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase">Durum</div><div style="margin-top:3px">${statusBadge(list.status)}</div></div>
    </div>
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:12px">
      ${itemsHtml}
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--bg)">
        <strong style="font-size:13px">Toplam</strong>
        <strong style="font-family:'Plus Jakarta Sans',sans-serif;font-size:18px">₺${Number(list.total).toLocaleString('tr-TR')}</strong>
      </div>
    </div>
    ${list.note?`<div style="background:var(--accent-light);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--accent)">📝 ${list.note}</div>`:''}
    ${list.admin_note?`<div style="background:#f0fff4;border-radius:8px;padding:10px 14px;font-size:13px;color:var(--success);margin-top:8px">✅ İşletme: ${list.admin_note}</div>`:''}`,
    btns
  );
}

// ── EDIT LIST ─────────────────────────────────────────
async function openEditModal(id){
  const lists=await api('GET','/api/lists/my');
  const list=lists.find(l=>l.id===id);
  if(!list||list.status!=='pending'){toast('Bu liste düzenlenemez.');return}
  editingListId=id; editItems=list.items.map(i=>({...i}));
  renderEditModal(list.note||'');
}
function renderEditModal(note){
  const total=editItems.reduce((s,i)=>s+i.price*i.qty,0);
  openModal(`✏️ Listeyi Düzenle`,`
    <div style="background:#fff8e6;border:1px solid #fcd34d;border-radius:8px;padding:9px 12px;font-size:12px;color:#92400e;margin-bottom:14px">
      ⚠️ Yalnızca onay bekleyen listeler düzenlenebilir.
    </div>
    <div id="edit-items-wrap">${editItems.map((item,idx)=>`
      <div class="edit-item-row" id="erow-${idx}">
        <span class="icon">${item.icon||'📦'}</span>
        <span class="name">${item.name}</span>
        <div style="display:flex;align-items:center;gap:4px">
          <button class="qty-btn" onclick="eQty(${idx},-1)">−</button>
          <span class="qty-val" id="eqty-${idx}">${item.qty}</span>
          <button class="qty-btn" onclick="eQty(${idx},+1)">+</button>
        </div>
        <span class="line-total" id="etotal-${idx}">₺${(item.price*item.qty).toLocaleString('tr-TR')}</span>
        <button class="list-remove" onclick="eRemove(${idx})">🗑</button>
      </div>`).join('')}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-top:1px solid var(--border);margin-top:6px">
      <strong style="font-size:13px">Toplam</strong>
      <strong style="font-family:'Plus Jakarta Sans',sans-serif;font-size:18px" id="e-grand-total">₺${total.toLocaleString('tr-TR')}</strong>
    </div>
    <div style="margin-top:8px">
      <label style="font-size:13px;color:var(--text2);display:block;margin-bottom:5px">Not (opsiyonel)</label>
      <input class="form-control" id="edit-note" placeholder="Teslimat notu…" value="${note}">
    </div>`,
    [{label:'💾 Kaydet',cls:'btn-primary',action:'saveEdit()'},{label:'Vazgeç',cls:'btn-ghost',action:'closeModal()'}]
  );
}
function eQty(idx,d){
  editItems[idx].qty=Math.max(1,editItems[idx].qty+d);
  $(`eqty-${idx}`).textContent=editItems[idx].qty;
  $(`etotal-${idx}`).textContent='₺'+(editItems[idx].price*editItems[idx].qty).toLocaleString('tr-TR');
  const total=editItems.reduce((s,i)=>s+i.price*i.qty,0);
  const el=$('e-grand-total');if(el)el.textContent='₺'+total.toLocaleString('tr-TR');
}
function eRemove(idx){
  editItems.splice(idx,1);
  if(!editItems.length){closeModal();toast('Tüm ürünler silindi.');return}
  const note=$('edit-note')?.value||'';
  renderEditModal(note);
}
async function saveEdit(){
  if(!editItems.length){toast('Liste boş olamaz.');return}
  try{
    await api('PUT',`/api/lists/${editingListId}`,{items:editItems,note:$('edit-note')?.value||''});
    closeModal();loadCustomerPage();toast('Liste güncellendi ✓');
  }catch(e){toast('Hata: '+e.message)}
}

// ── MODAL ─────────────────────────────────────────────
function openModal(title,body,btns=[]){
  $('modal-title').textContent=title;
  $('modal-body').innerHTML=body;
  $('modal-btns').innerHTML=btns.map(b=>`<button class="btn ${b.cls}" onclick="${b.action}">${b.label}</button>`).join('');
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal(){
  document.getElementById('modal-overlay').classList.remove('open');
  editingListId=null;editItems=[];
}

// ── EVENTS ────────────────────────────────────────────
document.getElementById('modal-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal()});
document.getElementById('auth-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.classList.remove('open')});

init();
