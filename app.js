// ============================================================
// app.js v4.0 - نظام POS الكامل (مع تصحيح طباعة الهاتف)
// ============================================================
'use strict';

const API = 'api.php?action=';
let CURRENCY = 'DH';
let WHATSAPP = '+212600000000';

const State = {
  user:null, cart:[], products:[], categories:[], customers:[],
  orderType:'dine_in', payMethod:'cash', selectedCustomer:null,
  currentDebtId:null, chartSales:null, chartTop:null,
  taxRate:0, settings:{}, currentSort:'popular', currentCategory:0,
  // نظام رنة الطلبات الجديدة
  lastOrderCount: 0,
  orderCheckInterval: null,
};

document.addEventListener('DOMContentLoaded', () => {
  applyDarkMode();
  // عرض شعار المطعم واسمه في صفحة الدخول
  applyLoginScreenBranding();
  const saved = localStorage.getItem('pos_user');
  if (saved) { State.user = JSON.parse(saved); showApp(); }
});

function applyLoginScreenBranding() {
  const settings = JSON.parse(localStorage.getItem('pos_settings')||'{}');
  const logo = settings.logo_path || localStorage.getItem('pos_logo') || '';
  const shopName = settings.shop_name || '';

  // الشعار
  const logoImg = document.getElementById('loginLogo');
  const logoEmoji = document.getElementById('loginEmoji');
  if (logo && logoImg) {
    logoImg.src = logo;
    logoImg.style.display = 'block';
    if (logoEmoji) logoEmoji.style.display = 'none';
  }

  // اسم المحل
  const shopNameEl = document.getElementById('loginShopName');
  if (shopNameEl && shopName) shopNameEl.textContent = shopName;
}

// ── المصادقة ──────────────────────────────────────────────
function handleLogin(e) {
  e.preventDefault();
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const LOCAL = {
    admin:  {username:'admin', password:'admin123', full_name:'المدير العام', role:'admin'},
    worker: {username:'worker',password:'worker123',full_name:'موظف الكاشير',role:'worker'},
  };
  const user = LOCAL[u];
  if (user && user.password===p) { finishLogin(user); }
  else { toast('بيانات الدخول خاطئة','error'); }
}

// دخول الزبون مباشرة بدون كلمة سر
function handleCustomerLogin() {
  const name = document.getElementById('customerLoginName').value.trim();
  const phoneRaw = document.getElementById('customerLoginPhone').value.trim().replace(/\s/g,'');

  // التحقق من الاسم
  if (!name) { toast('أدخل اسمك الكامل من فضلك','warning'); return; }
  if (name.split(' ').length < 2) { toast('أدخل الاسم الكامل (الاسم والنسب)','warning'); return; }

  // التحقق من الهاتف
  if (!phoneRaw) { toast('أدخل رقم هاتفك','warning'); return; }
  if (!/^[0-9]{9}$/.test(phoneRaw)) { toast('رقم الهاتف يجب أن يكون 9 أرقام بعد +212','warning'); return; }

  const fullPhone = '+212' + phoneRaw;

  // التحقق من التسجيل المسبق باسم مطابق
  const customers = JSON.parse(localStorage.getItem('pos_customers')||'[]');
  const existing = customers.find(c => c.name.trim().toLowerCase() === name.toLowerCase());

  if (existing) {
    // مسجل مسبقاً — نتحقق من الهاتف للتأكد إنه هو
    if (existing.phone && existing.phone !== fullPhone) {
      toast('هذا الاسم مسجل مسبقاً برقم هاتف مختلف ❌','error'); return;
    }
    // دخول بنفس البيانات
    const customerUser = {username:'customer_'+existing.id, password:'', full_name:existing.name, phone:fullPhone, customer_id:existing.id, role:'customer'};
    finishLogin(customerUser);
    return;
  }

  // زبون جديد — تسجيل مباشر
  const newCust = {
    id: Date.now(), name, phone: fullPhone, city:'', notes:'',
    total_orders:0, total_spent:0, created_at: new Date().toISOString()
  };
  customers.push(newCust);
  localStorage.setItem('pos_customers', JSON.stringify(customers));
  State.customers = customers;

  const customerUser = {username:'customer_'+newCust.id, password:'', full_name:name, phone:fullPhone, customer_id:newCust.id, role:'customer'};
  finishLogin(customerUser);
}

function finishLogin(user) {
  State.user = user;
  localStorage.setItem('pos_user', JSON.stringify(user));
  showApp();
  toast('مرحباً ' + user.full_name + ' 👋');
}

function handleLogout() {
  if (!confirm('هل تريد الخروج؟')) return;
  localStorage.removeItem('pos_user');
  location.reload();
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  const role = State.user.role;
  document.getElementById('userBadge').textContent = role==='admin'?'👑 مدير': role==='customer'?'🛒 زبون':'👷 موظف';
  applyRolePermissions();
  loadSettings();
  showPage('pos');
  updateBadges();
  if (role==='admin'||role==='worker') startOrderPolling();
  // زر الطلب للزبون
  const cbtn=document.getElementById('checkoutBtn');
  if(cbtn&&role==='customer') cbtn.innerHTML='<i class="fas fa-paper-plane"></i> اطلب';
  // إخفاء عناصر غير مسموح للزبون
  if(role==='customer'){
    ['discount-row','payment-methods','cashRow'].forEach(cls=>{
      document.querySelectorAll('.'+cls+',#cashRow').forEach(el=>{if(el)el.style.display='none';});
    });
    const dr=document.querySelector('.discount-row');if(dr)dr.style.display='none';
    const pm=document.querySelector('.payment-methods');if(pm)pm.style.display='none';
    const cr=document.getElementById('cashRow');if(cr)cr.style.display='none';
  }
}

function applyRolePermissions() {
  const role = State.user.role;
  const isC = role==='customer';
  const isW = role==='worker';
  document.querySelectorAll('.admin-only').forEach(el => el.style.display = (isW||isC)?'none':'');
  document.querySelectorAll('[data-page="orders"]').forEach(el => el.style.display = isC?'none':'');
  if (isC) {
    document.querySelectorAll('.btn-print-receipt,.btn-whatsapp').forEach(el=>el.style.display='none');
  }
}

function startOrderPolling() {
  const orders = JSON.parse(localStorage.getItem('pos_orders')||'[]');
  State.lastOrderCount = orders.length;
  if (State.orderCheckInterval) clearInterval(State.orderCheckInterval);
  State.orderCheckInterval = setInterval(()=>{
    const newOrders = JSON.parse(localStorage.getItem('pos_orders')||'[]');
    if (newOrders.length > State.lastOrderCount) {
      State.lastOrderCount = newOrders.length;
      playNotificationSound();
      toast('🔔 طلب جديد وصل!','info',5000);
      updateBadges();
      const ordersPage = document.getElementById('page-orders');
      if (ordersPage && ordersPage.classList.contains('active')) loadOrders(_op);
    }
  }, 3000);
}

function playNotificationSound() {
  try {
    const ctx = new(window.AudioContext||window.webkitAudioContext)();
    const playTone=(freq,start,dur)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(freq,ctx.currentTime+start);g.gain.setValueAtTime(.3,ctx.currentTime+start);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+start+dur);o.start(ctx.currentTime+start);o.stop(ctx.currentTime+start+dur);};
    playTone(523,.0,.15);playTone(659,.18,.15);playTone(784,.36,.3);
  } catch{}
}

// ── التنقل ────────────────────────────────────────────────
function showPage(page) {
  const adminOnly = ['products','customers','debts','cash','reports','admin'];
  if (State.user?.role==='worker' && adminOnly.includes(page)) { toast('ليس لديك صلاحية','error'); return; }
  if (State.user?.role==='customer' && page!=='pos') { toast('ليس لديك صلاحية','error'); return; }
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pe = document.getElementById('page-'+page); if(pe) pe.classList.add('active');
  const ne = document.querySelector(`[data-page="${page}"]`); if(ne) ne.classList.add('active');
  switch(page){
    case 'pos':       loadPOS();          break;
    case 'orders':    loadOrders('day');  break;
    case 'products':  loadProductsAdmin();break;
    case 'customers': loadCustomers();    break;
    case 'debts':     loadDebts();        break;
    case 'cash':      loadCash();         break;
    case 'reports':   loadReports('day');break;
    case 'admin':     loadAdmin();        break;
  }
}

// ── الإعدادات ─────────────────────────────────────────────
function loadSettings() {
  const s = localStorage.getItem('pos_settings');
  if (s) State.settings = JSON.parse(s);
  applySettings();
}

function applySettings() {
  const s = State.settings;
  CURRENCY  = s.currency || 'DH';
  WHATSAPP  = s.shop_whatsapp || WHATSAPP;
  State.taxRate = parseFloat(s.tax_rate||0);
  const name = s.shop_name || 'المحل';
  const sn = document.getElementById('shopName'); if(sn) sn.textContent = name;
  document.title = name + ' - نقطة البيع';
  const logo = s.logo_path || localStorage.getItem('pos_logo') || '';
  if (logo) applyLogo(logo);
}

function applyLogo(src) {
  if (!src) return;
  ['currentLogo','loginLogo','sidebarLogo'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    el.src=src; el.style.display='block';
  });
  const lp=document.getElementById('logoPlaceholder'); if(lp) lp.style.display='none';
  const le=document.getElementById('loginEmoji');      if(le) le.style.display='none';
  const se=document.getElementById('sidebarEmoji');    if(se) se.style.display='none';
}

function uploadLogo(input) {
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    localStorage.setItem('pos_logo', e.target.result);
    State.settings.logo_path = e.target.result;
    localStorage.setItem('pos_settings', JSON.stringify(State.settings));
    applyLogo(e.target.result);
    toast('تم رفع الشعار ✅');
  };
  reader.readAsDataURL(file);
}

// ══════════════════════════════════════════════════════════
// ── POS ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
function loadPOS() {
  loadCategories();
  loadProducts();
  loadCartFromStorage();
}

function loadCategories() {
  State.categories = getDefCats();
  renderCategories();
}

function loadProducts() {
  document.getElementById('productsGrid').innerHTML = '<div class="skeleton-card"></div>'.repeat(6);
  State.products = getDefProds();
  renderProducts(State.products);
}

function getDefCats() {
  const saved = localStorage.getItem('pos_categories');
  if (saved) return JSON.parse(saved);
  const defaults = [{id:1,name:'المشروبات الساخنة',icon:'☕'},{id:2,name:'المشروبات الباردة',icon:'🧊'},{id:3,name:'الوجبات الرئيسية',icon:'🍽️'},{id:4,name:'السندويشات',icon:'🥪'},{id:5,name:'الحلويات',icon:'🍰'}];
  localStorage.setItem('pos_categories', JSON.stringify(defaults));
  return defaults;
}

function addCategory() {
  const name = document.getElementById('newCatName')?.value?.trim();
  const icon = document.getElementById('newCatIcon')?.value?.trim()||'📦';
  if (!name) { toast('أدخل اسم الفئة','warning'); return; }
  const cats = getDefCats();
  cats.push({id: Date.now(), name, icon});
  localStorage.setItem('pos_categories', JSON.stringify(cats));
  document.getElementById('newCatName').value='';
  document.getElementById('newCatIcon').value='';
  renderCategoriesAdmin();
  toast('تم إضافة الفئة ✅');
}

function deleteCategory(id) {
  if (!confirm('حذف هذه الفئة؟')) return;
  const cats = getDefCats().filter(c=>c.id!=id);
  localStorage.setItem('pos_categories', JSON.stringify(cats));
  renderCategoriesAdmin();
  toast('تم الحذف','info');
}

function renderCategoriesAdmin() {
  const cats = getDefCats();
  const el = document.getElementById('categoriesAdminList');
  if (!el) return;
  el.innerHTML = cats.map(c=>`<div class="cat-admin-item"><span>${c.icon} ${c.name}</span><button class="btn-icon danger" onclick="deleteCategory(${c.id})"><i class="fas fa-trash"></i></button></div>`).join('');
}

function getDefProds() {
  const s = localStorage.getItem('pos_products');
  if (s) return JSON.parse(s);
  return [
    {id:1,name:'قهوة عربية',description:'قهوة أصيلة بالهيل',category_id:1,selling_price:15,purchase_price:5,stock:100,total_sold:245,is_featured:true,image_path:'',category_name:'المشروبات الساخنة'},
    {id:2,name:'كابتشينو',description:'كابتشينو إيطالي',category_id:1,selling_price:22,purchase_price:8,stock:80,total_sold:198,is_featured:true,image_path:'',category_name:'المشروبات الساخنة'},
    {id:3,name:'شاي أخضر',description:'شاي طبيعي',category_id:1,selling_price:12,purchase_price:3,stock:150,total_sold:156,is_featured:false,image_path:'',category_name:'المشروبات الساخنة'},
    {id:4,name:'لاتيه',description:'لاتيه بالحليب',category_id:1,selling_price:25,purchase_price:9,stock:60,total_sold:134,is_featured:true,image_path:'',category_name:'المشروبات الساخنة'},
    {id:5,name:'عصير برتقال',description:'برتقال طبيعي طازج',category_id:2,selling_price:18,purchase_price:6,stock:50,total_sold:312,is_featured:true,image_path:'',category_name:'المشروبات الباردة'},
    {id:6,name:'موهيتو',description:'نعناع وليمون',category_id:2,selling_price:20,purchase_price:7,stock:45,total_sold:220,is_featured:true,image_path:'',category_name:'المشروبات الباردة'},
    {id:7,name:'عصير فراولة',description:'فراولة مع آيس كريم',category_id:2,selling_price:22,purchase_price:8,stock:40,total_sold:187,is_featured:false,image_path:'',category_name:'المشروبات الباردة'},
    {id:8,name:'ماء معدني',description:'500ml',category_id:2,selling_price:5,purchase_price:2,stock:200,total_sold:450,is_featured:false,image_path:'',category_name:'المشروبات الباردة'},
    {id:9,name:'برغر كلاسيك',description:'لحم مع خضروات',category_id:3,selling_price:55,purchase_price:25,stock:30,total_sold:89,is_featured:true,image_path:'',category_name:'الوجبات الرئيسية'},
    {id:10,name:'دجاج مشوي',description:'أرز وسلطة',category_id:3,selling_price:65,purchase_price:30,stock:25,total_sold:76,is_featured:true,image_path:'',category_name:'الوجبات الرئيسية'},
    {id:11,name:'بيتزا مارغريتا',description:'جبن وطماطم',category_id:3,selling_price:75,purchase_price:35,stock:15,total_sold:92,is_featured:true,image_path:'',category_name:'الوجبات الرئيسية'},
    {id:12,name:'شاورما دجاج',description:'صوص خاص',category_id:4,selling_price:35,purchase_price:15,stock:40,total_sold:267,is_featured:true,image_path:'',category_name:'السندويشات'},
    {id:13,name:'سندويش كلوب',description:'ثلاثي الطوابق',category_id:4,selling_price:40,purchase_price:18,stock:35,total_sold:143,is_featured:false,image_path:'',category_name:'السندويشات'},
    {id:14,name:'كيك شوكولاتة',description:'شوكولاتة بلجيكي',category_id:5,selling_price:30,purchase_price:12,stock:20,total_sold:98,is_featured:true,image_path:'',category_name:'الحلويات'},
    {id:15,name:'تشيز كيك',description:'كريمي بالفراولة',category_id:5,selling_price:35,purchase_price:15,stock:15,total_sold:72,is_featured:false,image_path:'',category_name:'الحلويات'},
  ];
}

function renderCategories() {
  const bar = document.getElementById('categoriesBar');
  bar.innerHTML = `<button class="cat-btn active" onclick="filterCategory(0,this)">🏠 الكل</button>`;
  State.categories.forEach(c => { bar.innerHTML += `<button class="cat-btn" onclick="filterCategory(${c.id},this)">${c.icon} ${c.name}</button>`; });
}

function renderProducts(products) {
  const grid = document.getElementById('productsGrid');
  if (!products||!products.length) {
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text3)"><i class="fas fa-box-open" style="font-size:3rem"></i><p style="margin-top:1rem">لا توجد منتجات</p></div>';
    return;
  }
  const em={1:'☕',2:'🧃',3:'🍽️',4:'🥪',5:'🍰'};
  grid.innerHTML = products.map(p => {
    const oos = parseInt(p.stock)<=0;
    const e   = em[p.category_id]||'📦';
    const img = p.image_path
      ? `<img src="${p.image_path}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='<span style=font-size:2.5rem>${e}</span>'">`
      : `<span style="font-size:2.5rem">${e}</span>`;
    return `<div class="product-card ${oos?'out-of-stock':''}" onclick="${oos?'':'addToCart('+p.id+')'}" data-id="${p.id}">
      ${p.is_featured?'<span class="featured-badge">⭐</span>':''}
      <div class="product-img">${img}</div>
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-desc">${p.description||''}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.3rem">
          <div class="product-price">${parseFloat(p.selling_price).toFixed(2)} ${CURRENCY}</div>
          <div class="${parseInt(p.stock)<=5?'stock-low':'stock-ok'}" style="font-size:.75rem">${parseInt(p.stock)>0?'📦 '+p.stock:'❌ نفد'}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function filterCategory(id,btn) {
  State.currentCategory=id;
  document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  renderProducts(id?State.products.filter(p=>p.category_id==id):State.products);
}

function sortP(sort,btn) {
  document.querySelectorAll('.sort-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  let s=[...State.products];
  if(sort==='price_asc')  s.sort((a,b)=>a.selling_price-b.selling_price);
  if(sort==='price_desc') s.sort((a,b)=>b.selling_price-a.selling_price);
  if(sort==='popular')    s.sort((a,b)=>b.total_sold-a.total_sold);
  if(sort==='featured')   s.sort((a,b)=>b.is_featured-a.is_featured);
  renderProducts(s);
}

function filterProducts() {
  const q=document.getElementById('searchInput').value.toLowerCase();
  renderProducts(!q?State.products:State.products.filter(p=>p.name.toLowerCase().includes(q)||(p.description||'').toLowerCase().includes(q)));
}

function toggleGridCols() {
  const grid=document.getElementById('productsGrid');
  const cols=grid.getAttribute('data-cols')||'auto';
  if(cols==='auto')     { grid.style.gridTemplateColumns='repeat(auto-fill,minmax(130px,1fr))'; grid.setAttribute('data-cols','small'); }
  else if(cols==='small'){grid.style.gridTemplateColumns='repeat(auto-fill,minmax(220px,1fr))'; grid.setAttribute('data-cols','large'); }
  else                  { grid.style.gridTemplateColumns='repeat(auto-fill,minmax(155px,1fr))'; grid.setAttribute('data-cols','auto'); }
}

// ══════════════════════════════════════════════════════════
// ── السلة ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
function addToCart(productId) {
  const p=State.products.find(p=>p.id==productId); if(!p) return;
  const ex=State.cart.find(i=>i.id==productId);
  if(ex) { if(ex.quantity>=parseInt(p.stock)){toast('حد المخزون','warning');return;} ex.quantity++; }
  else   { State.cart.push({id:p.id,name:p.name,selling_price:parseFloat(p.selling_price),purchase_price:parseFloat(p.purchase_price),stock:parseInt(p.stock),quantity:1,notes:''}); }
  renderCart(); saveCartToStorage(); playBeep();
  const card=document.querySelector(`[data-id="${productId}"]`);
  if(card){card.style.transform='scale(0.95)';setTimeout(()=>card.style.transform='',150);}
  toast(`✅ ${p.name}`,'success',1200);
}

function removeFromCart(id){State.cart=State.cart.filter(i=>i.id!=id);renderCart();saveCartToStorage();}

function changeQty(id,delta) {
  const item=State.cart.find(i=>i.id==id); if(!item) return;
  item.quantity+=delta;
  if(item.quantity<=0){removeFromCart(id);return;}
  if(item.quantity>item.stock){item.quantity=item.stock;toast('حد المخزون','warning');}
  renderCart(); saveCartToStorage();
}

function clearCart() {
  if(!State.cart.length) return;
  if(!confirm('إفراغ السلة؟')) return;
  State.cart=[]; State.selectedCustomer=null;
  document.getElementById('cartCustomer').style.display='none';
  document.getElementById('orderNotes').value='';
  document.getElementById('discountValue').value=0;
  document.getElementById('amountPaid').value='';
  renderCart(); saveCartToStorage();
}

function renderCart() {
  const c=document.getElementById('cartItems');
  if(!State.cart.length){
    c.innerHTML=`<div class="cart-empty"><i class="fas fa-shopping-cart"></i><p>السلة فارغة</p><small>اضغط على منتج</small></div>`;
    updateTotals(); return;
  }
  c.innerHTML=State.cart.map(item=>{
    const lt=(parseFloat(item.selling_price)*parseInt(item.quantity)).toFixed(2);
    return `<div class="cart-item">
      <div style="flex:1;min-width:0">
        <div class="cart-item-name">${item.name}</div>
        <div style="font-size:.78rem;color:var(--text3)">${parseFloat(item.selling_price).toFixed(2)} ${CURRENCY} / وحدة</div>
      </div>
      <div class="qty-controls">
        <button class="qty-btn minus" onclick="changeQty(${item.id},-1)">−</button>
        <span class="qty-num">${item.quantity}</span>
        <button class="qty-btn plus" onclick="changeQty(${item.id},1)">+</button>
      </div>
      <div class="cart-item-price">${lt} ${CURRENCY}</div>
      <button class="cart-item-del" onclick="removeFromCart(${item.id})"><i class="fas fa-trash-alt"></i></button>
    </div>`;
  }).join('');
  updateTotals();
}

function updateTotals() {
  const sub  = State.cart.reduce((s,i)=>s+parseFloat(i.selling_price)*parseInt(i.quantity),0);
  const dTyp = document.getElementById('discountType')?.value||'fixed';
  const dVal = parseFloat(document.getElementById('discountValue')?.value)||0;
  const dAmt = dTyp==='percent'?sub*dVal/100:Math.min(dVal,sub);
  const tax  = (sub-dAmt)*(State.taxRate/100);
  const tot  = sub-dAmt+tax;
  document.getElementById('subtotalVal').textContent = sub.toFixed(2)+' '+CURRENCY;
  document.getElementById('discountVal').textContent = '-'+dAmt.toFixed(2)+' '+CURRENCY;
  document.getElementById('taxVal').textContent      = tax.toFixed(2)+' '+CURRENCY;
  document.getElementById('totalVal').textContent    = tot.toFixed(2)+' '+CURRENCY;
  if(State.taxRate>0) document.getElementById('taxRow').style.display='';
  calcChange();
}

function getTotal()    { return parseFloat((document.getElementById('totalVal')?.textContent||'0').replace(/[^0-9.]/g,''))||0; }
function getSubtotal() { return parseFloat((document.getElementById('subtotalVal')?.textContent||'0').replace(/[^0-9.]/g,''))||0; }
function getDiscount() { return parseFloat((document.getElementById('discountVal')?.textContent||'0').replace(/[^0-9.]/g,''))||0; }

function calcChange() {
  const tot=getTotal(), paid=parseFloat(document.getElementById('amountPaid')?.value)||0;
  const cd=document.getElementById('changeDisplay'), ca=document.getElementById('changeAmount');
  if(paid>0&&State.payMethod==='cash'){const ch=paid-tot;cd.style.display='block';ca.textContent=ch.toFixed(2);ca.style.color=ch>=0?'var(--success)':'var(--danger)';}
  else cd.style.display='none';
}

function setOrderType(t,btn){State.orderType=t;document.querySelectorAll('.type-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');}
function setPayMethod(m,btn){
  State.payMethod=m;
  document.querySelectorAll('.pay-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  document.getElementById('cashRow').style.display=m==='cash'?'flex':'none';
  if(m==='debt') toast('⚠️ اختر عميلاً لتسجيل الدين','warning',2500);
}

// ══════════════════════════════════════════════════════════
// ── تأكيد الطلب ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════
function checkout() {
  if(!State.cart.length){toast('السلة فارغة!','warning');return;}
  // الزبون: إضافة نفسه تلقائياً إن لم يكن مختاراً
  if(State.user?.role==='customer' && !State.selectedCustomer) {
    const custName = State.user.full_name;
    const customers = JSON.parse(localStorage.getItem('pos_customers')||'[]');
    let cust = customers.find(c=>c.name===custName);
    if (!cust) {
      cust = {id:Date.now(),name:custName,phone:'',city:'',total_orders:0,total_spent:0,created_at:new Date().toISOString()};
      customers.push(cust);
      localStorage.setItem('pos_customers',JSON.stringify(customers));
      State.customers = customers;
    }
    State.selectedCustomer = cust;
    document.getElementById('cartCustomer').style.display='flex';
    document.getElementById('cartCustomerName').textContent = cust.name;
  }
  if(State.payMethod==='debt'&&!State.selectedCustomer){toast('⚠️ اختر عميلاً للدين!','warning');showCustomerPicker();return;}
  const btn=document.getElementById('checkoutBtn');
  btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> جاري...';
  const total=getTotal(), sub=getSubtotal(), disc=getDiscount();
  const amtPaid=parseFloat(document.getElementById('amountPaid').value)||total;
  const orderNum='ORD-'+Date.now();
  const order={
    id:Date.now(), order_number:orderNum,
    customer_id:State.selectedCustomer?.id||null,
    customer_name:State.selectedCustomer?.name||'زبون',
    customer_phone:State.selectedCustomer?.phone||'',
    order_type:State.orderType,
    items:State.cart.map(i=>({
      id:i.id, product_name:i.name, name:i.name, quantity:parseInt(i.quantity),
      unit_price:parseFloat(i.selling_price), purchase_price:parseFloat(i.purchase_price),
      total_price:parseFloat(i.selling_price)*parseInt(i.quantity),
      profit:(parseFloat(i.selling_price)-parseFloat(i.purchase_price))*parseInt(i.quantity),
      notes:i.notes||'',
    })),
    subtotal:sub, discount_amount:disc, tax_amount:sub*State.taxRate/100, total,
    payment_method:State.payMethod,
    payment_status:State.payMethod==='debt'?'unpaid':'paid',
    amount_paid:State.payMethod==='debt'?0:amtPaid,
    change_amount:State.payMethod==='cash'?Math.max(0,amtPaid-total):0,
    order_status:'pending',
    notes:document.getElementById('orderNotes').value,
    cashier_name:State.user?.full_name||'كاشير',
    is_customer_order: State.user?.role==='customer',
    order_date:new Date().toISOString().split('T')[0],
    created_at:new Date().toISOString(),
    items_count:State.cart.length,
  };
  // حفظ الطلب محلياً
  const orders=JSON.parse(localStorage.getItem('pos_orders')||'[]');
  orders.unshift(order); localStorage.setItem('pos_orders',JSON.stringify(orders.slice(0,500)));
  // دين تلقائي
  if(order.payment_method==='debt'){
    const debts=JSON.parse(localStorage.getItem('pos_debts')||'[]');
    debts.unshift({id:Date.now()+1,customer_id:order.customer_id,customer_name:order.customer_name,customer_phone:order.customer_phone,order_id:order.id,order_number:orderNum,original_amount:total,paid_amount:0,remaining_amount:total,status:'pending',notes:'دين من طلب '+orderNum,created_at:new Date().toISOString()});
    localStorage.setItem('pos_debts',JSON.stringify(debts));
  }
  // تحديث الصندوق
  if(order.payment_method!=='debt'){
    const bal=parseFloat(localStorage.getItem('pos_cash_balance')||'0')+total;
    localStorage.setItem('pos_cash_balance',bal.toFixed(2));
  }
  // إحصائيات يومية
  const today=new Date().toDateString();
  const daily=JSON.parse(localStorage.getItem('pos_daily')||'{}');
  if(!daily[today]) daily[today]={orders:0,revenue:0,profit:0,products:{}};
  daily[today].orders++; daily[today].revenue+=total;
  order.items.forEach(i=>{daily[today].profit+=(i.profit||0);daily[today].products[i.name]=(daily[today].products[i.name]||0)+i.quantity;});
  localStorage.setItem('pos_daily',JSON.stringify(daily));
  // تحديث المخزون
  order.items.forEach(item=>{const p=State.products.find(pr=>pr.id==item.id);if(p){p.stock=Math.max(0,p.stock-item.quantity);p.total_sold=(p.total_sold||0)+item.quantity;}});
  localStorage.setItem('pos_products',JSON.stringify(State.products));
  // تحديث العميل
  if(State.selectedCustomer){
    const customers=JSON.parse(localStorage.getItem('pos_customers')||'[]');
    const idx=customers.findIndex(c=>c.id==State.selectedCustomer.id);
    if(idx!==-1){customers[idx].total_orders=(customers[idx].total_orders||0)+1;customers[idx].total_spent=(parseFloat(customers[idx].total_spent)||0)+total;localStorage.setItem('pos_customers',JSON.stringify(customers));}
  }
  setTimeout(()=>{
    btn.disabled=false; btn.innerHTML=State.user?.role==='customer'?'<i class="fas fa-paper-plane"></i> اطلب':'<i class="fas fa-check-circle"></i> تأكيد الطلب';
    playBeep(); showSuccessPopup(order); updateBadges();
    State.cart=[]; State.selectedCustomer=null;
    document.getElementById('cartCustomer').style.display='none';
    document.getElementById('orderNotes').value='';
    document.getElementById('discountValue').value=0;
    document.getElementById('amountPaid').value='';
    renderCart(); renderProducts(State.products);
  },400);
}

function showSuccessPopup(order) {
  const isDebt=order.payment_method==='debt';
  const isCustomer=State.user?.role==='customer';
  const div=document.createElement('div');
  div.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;animation:fadeIn .2s ease';
  if (isCustomer) {
    // واجهة مبسطة للزبون - يظهر رقم الطلب والثمن فقط
    div.innerHTML=`<div style="background:var(--bg2);border-radius:20px;padding:2.5rem;text-align:center;max-width:360px;width:90%;animation:slideUp .3s ease">
      <div style="font-size:5rem">✅</div>
      <h2 style="color:var(--success);margin:.5rem 0;font-size:1.4rem">تم إرسال طلبك!</h2>
      <div style="background:var(--bg3);border-radius:12px;padding:1rem;margin:1rem 0">
        <div style="font-size:.85rem;color:var(--text2);margin-bottom:.3rem">رقم طلبك</div>
        <div style="font-size:1.8rem;font-weight:900;color:var(--primary)">${order.order_number}</div>
      </div>
      <p style="color:var(--text2);font-size:1rem">المبلغ: <strong style="color:var(--text);font-size:1.2rem">${order.total.toFixed(2)} ${CURRENCY}</strong></p>
      <p style="color:var(--text3);font-size:.85rem;margin-top:.5rem">سيتم تجهيز طلبك قريباً 🍽️</p>
      <button onclick="this.closest('[style*=fixed]').remove()" style="margin-top:1.2rem;padding:.7rem 2rem;background:var(--primary);color:white;border:none;border-radius:8px;cursor:pointer;font-family:var(--font);font-weight:700;font-size:1rem">حسناً</button>
    </div>`;
  } else {
    div.innerHTML=`<div style="background:var(--bg2);border-radius:20px;padding:2rem;text-align:center;max-width:340px;width:90%;animation:slideUp .3s ease">
      <div style="font-size:4rem">${isDebt?'📝':'✅'}</div>
      <h2 style="color:${isDebt?'var(--warning)':'var(--success)'};margin:.5rem 0">تم تأكيد الطلب!</h2>
      <p style="font-weight:700;font-size:1.1rem;color:var(--primary)">${order.order_number}</p>
      <p style="color:var(--text2)">المجموع: <strong>${order.total.toFixed(2)} ${CURRENCY}</strong></p>
      ${order.change_amount>0?`<p style="color:var(--success);font-weight:700;font-size:1.1rem">الباقي: ${order.change_amount.toFixed(2)} ${CURRENCY}</p>`:''}
      ${isDebt?`<div style="background:#FFFFFB;border-radius:10px;padding:.7rem;margin-top:.7rem;font-size:.9rem;color:#444422;font-weight:600">⚠️ دين مسجل باسم: ${order.customer_name}</div>`:''}
      <div style="display:flex;gap:.5rem;margin-top:1.2rem;justify-content:center">
        <button onclick='printBon(${safeJ(order)})' style="padding:.5rem 1.2rem;background:var(--primary);color:white;border:none;border-radius:8px;cursor:pointer;font-family:var(--font);font-weight:600">🖨️ طباعة</button>
        <button onclick="this.closest('[style*=fixed]').remove()" style="padding:.5rem 1.2rem;background:var(--bg3);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:var(--font)">إغلاق</button>
      </div>
    </div>`;
  }
  document.body.appendChild(div);
  setTimeout(()=>div.remove(),isCustomer?15000:8000);
}

// ══════════════════════════════════════════════════════════
// ── طباعة البون (نسخة متوافقة مع الهواتف) ────────────────
// ══════════════════════════════════════════════════════════
function printBon(order) {
  if (typeof order === 'string') order = JSON.parse(order);
  const shopName = State.settings.shop_name || 'المحل';
  const footer = State.settings.receipt_footer || 'شكراً لزيارتكم! 🌟';
  const phone = State.settings.shop_phone || '';
  const address = State.settings.shop_address || '';
  const logo = State.settings.logo_path || localStorage.getItem('pos_logo') || '';
  const items = order.items || [];
  const payMap = { cash: '💵 نقدي', card: '💳 بطاقة', transfer: '📱 تحويل', debt: '📝 دين' };
  const typeMap = { dine_in: '🍽️ داخل المحل', takeaway: '🛍️ خارج', delivery: '🛵 توصيل' };

  const logoHtml = logo
    ? `<img src="${logo}" style="width:68px;height:68px;border-radius:50%;object-fit:cover;border:2.5px solid #6366f1;display:block;margin:0 auto 6px" onerror="this.style.display='none'">`
    : `<div style="width:60px;height:60px;border-radius:50%;background:#6366f1;color:white;font-size:22px;line-height:60px;text-align:center;margin:0 auto 6px">☕</div>`;

  const htmlContent = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>بون - ${order.order_number}</title>
<style>
  @page{size:80mm auto;margin:4mm}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Courier New',monospace;font-size:12px;color:#000;background:#fff;width:72mm;margin:0 auto}
  .c{text-align:center}.b{font-weight:bold}.big{font-size:15px}.xl{font-size:18px}
  .d{border:none;border-top:1px dashed #000;margin:5px 0}
  .s{border:none;border-top:2px solid #000;margin:5px 0}
  table{width:100%;border-collapse:collapse}
  td{padding:3px 1px;font-size:11px;vertical-align:top}
  .tl{font-weight:bold;font-size:13px}
  .dw{background:#000;color:#fff;text-align:center;padding:4px;font-weight:bold;margin:6px 0;font-size:11px}
</style>
</head>
<body>
  <div class="c">${logoHtml}</div>
  <div class="c b big">${shopName}</div>
  ${address ? `<div class="c" style="font-size:10px">${address}</div>` : ''}
  ${phone ? `<div class="c" style="font-size:10px">📞 ${phone}</div>` : ''}
  <hr class="d">
  <table>
    <tr><td class="b">رقم الطلب:</td><td>${order.order_number}</td></tr>
    <tr><td class="b">التاريخ:</td><td>${new Date(order.created_at || Date.now()).toLocaleString('ar-MA')}</td></tr>
    <tr><td class="b">من طرف:</td><td>${order.cashier_name || 'موظف'}</td></tr>
    <tr><td class="b">زبون:</td><td>${order.customer_name || 'زبون'}</td></tr>
    <tr><td class="b">النوع:</td><td>${typeMap[order.order_type] || '-'}</td></tr>
  </table>
  <hr class="d">
  <table>
    <tr><td class="b" style="width:50%">الصنف</td><td class="b" style="text-align:center;width:12%">ك</td><td class="b" style="text-align:left;width:38%">الثمن</td></tr>
    <tr><td colspan="3"><hr class="d"></td></tr>
    ${items.map(i => `
    <tr>
      <td>${i.product_name || i.name}</td>
      <td style="text-align:center">${i.quantity}</td>
      <td style="text-align:left">${parseFloat(i.total_price || 0).toFixed(2)}</td>
    </tr>
    ${i.notes ? `<tr><td colspan="3" style="font-size:10px;padding-right:8px">↳ ${i.notes}</td></tr>` : ''}`).join('')}
  </table>
  <hr class="s">
  <table>
    ${parseFloat(order.discount_amount || 0) > 0 ? `<tr><td>الخصم:</td><td style="text-align:left">-${parseFloat(order.discount_amount).toFixed(2)} ${CURRENCY}</td></tr>` : ''}
    ${parseFloat(order.tax_amount || 0) > 0 ? `<tr><td>الضريبة:</td><td style="text-align:left">${parseFloat(order.tax_amount).toFixed(2)} ${CURRENCY}</td></tr>` : ''}
    <tr class="tl"><td>═ المجموع ═</td><td style="text-align:left" class="xl">${parseFloat(order.total || 0).toFixed(2)} ${CURRENCY}</td></tr>
    <tr><td>الدفع:</td><td style="text-align:left">${payMap[order.payment_method] || '-'}</td></tr>
    ${parseFloat(order.change_amount || 0) > 0 ? `<tr><td>الباقي:</td><td style="text-align:left;font-weight:bold">${parseFloat(order.change_amount).toFixed(2)} ${CURRENCY}</td></tr>` : ''}
  </table>
  ${order.payment_method === 'debt' ? `<div class="dw">⚠️ هذا الطلب مسجل كدين ⚠️</div>` : ''}
  ${order.notes ? `<div style="border:1px dashed #000;padding:4px;font-size:10px;margin:4px 0">📝 ${order.notes}</div>` : ''}
  <hr class="d">
  <div class="c b" style="font-size:13px">${footer}</div>
</body>
</html>`;

  // استخدام iframe مخفي للطباعة (متوافق مع الهواتف)
  const oldFrame = document.getElementById('printIframe');
  if (oldFrame) oldFrame.remove();
  
  const iframe = document.createElement('iframe');
  iframe.id = 'printIframe';
  iframe.style.position = 'absolute';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  
  document.body.appendChild(iframe);
  
  const iframeDoc = iframe.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(htmlContent);
  iframeDoc.close();
  
  iframe.onload = function() {
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => {
          const f = document.getElementById('printIframe');
          if (f) f.remove();
        }, 5000);
      } catch (e) {
        console.error('خطأ في الطباعة:', e);
        toast('حدث خطأ في الطباعة، حاول مرة أخرى', 'error');
        const f = document.getElementById('printIframe');
        if (f) f.remove();
      }
    }, 200);
  };
  
  setTimeout(() => {
    if (document.getElementById('printIframe')) {
      try {
        iframe.contentWindow.print();
      } catch(e) {}
    }
  }, 800);
}

function printQuickReceipt() {
  if(!State.cart.length){toast('السلة فارغة','warning');return;}
  printBon({
    order_number:'DRAFT-'+Date.now(), customer_name:State.selectedCustomer?.name||'زبون',
    cashier_name:State.user?.full_name||'كاشير', created_at:new Date().toISOString(),
    order_type:State.orderType,
    items:State.cart.map(i=>({product_name:i.name,quantity:i.quantity,unit_price:i.selling_price,total_price:i.selling_price*i.quantity,notes:i.notes||''})),
    subtotal:getSubtotal(), discount_amount:getDiscount(), tax_amount:getSubtotal()*State.taxRate/100,
    total:getTotal(), payment_method:State.payMethod,
    change_amount:Math.max(0,(parseFloat(document.getElementById('amountPaid').value)||0)-getTotal()),
    notes:document.getElementById('orderNotes').value,
  });
}

// ══════════════════════════════════════════════════════════
// ── الفاتورة الشهرية (شعار دائري + جداول احترافية) ────────
// ══════════════════════════════════════════════════════════
function printMonthlyInvoice() {
  const orders  = JSON.parse(localStorage.getItem('pos_orders')||'[]');
  const expenses= JSON.parse(localStorage.getItem('pos_expenses')||'[]');
  const now     = new Date();
  const mnOrders= orders.filter(o=>{const d=new Date(o.created_at);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()&&o.order_status!=='cancelled';});
  const mnExp   = expenses.filter(e=>{const d=new Date(e.created_at||e.expense_date);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();});
  const totalRev = mnOrders.reduce((s,o)=>s+parseFloat(o.total||0),0);
  const totalProf= mnOrders.reduce((s,o)=>s+(o.items||[]).reduce((ss,i)=>ss+(i.profit||0),0),0);
  const totalOut = mnExp.filter(e=>e.type==='out'||!e.type).reduce((s,e)=>s+parseFloat(e.amount||0),0);
  const capital  = parseFloat(localStorage.getItem('pos_capital')||'0');
  const balance  = parseFloat(localStorage.getItem('pos_cash_balance')||'0');
  const netProfit= totalProf - totalOut;
  const monthName= now.toLocaleString('ar-MA',{month:'long',year:'numeric'});
  const shopName = State.settings.shop_name||'المحل';
  const logo     = State.settings.logo_path||localStorage.getItem('pos_logo')||'';

  const logoHtml = logo
    ? `<img src="${logo}" style="width:90px;height:90px;border-radius:50%;object-fit:cover;border:3px solid white;display:block;margin:0 auto 12px" onerror="this.style.display='none'">`
    : `<div style="width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.2);color:white;font-size:32px;line-height:80px;text-align:center;margin:0 auto 12px">☕</div>`;

  const prodStats={};
  mnOrders.forEach(o=>(o.items||[]).forEach(i=>{const k=i.product_name||i.name;if(!prodStats[k])prodStats[k]={qty:0,rev:0};prodStats[k].qty+=i.quantity;prodStats[k].rev+=parseFloat(i.total_price||0);}));
  const topProds=Object.entries(prodStats).sort((a,b)=>b[1].qty-a[1].qty);
  const byDay={};
  mnOrders.forEach(o=>{const d=o.order_date||new Date(o.created_at).toISOString().split('T')[0];if(!byDay[d])byDay[d]={orders:0,revenue:0};byDay[d].orders++;byDay[d].revenue+=parseFloat(o.total||0);});
  const weakDays=Object.entries(byDay).sort((a,b)=>a[1].revenue-b[1].revenue).slice(0,5);

  const html=`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>فاتورة شهرية - ${monthName}</title>
<style>
  @page{margin:12mm;size:A4}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#1e293b;background:#fff;font-size:13px}
  .header{background:linear-gradient(135deg,#1e1b4b,#4f46e5);color:white;padding:28px;border-radius:16px;margin-bottom:20px;text-align:center}
  .header h1{font-size:26px;font-weight:900;margin-bottom:4px}
  .month-badge{display:inline-block;background:rgba(255,255,255,.2);padding:5px 18px;border-radius:20px;font-size:15px;font-weight:700;margin-top:8px}
  .g4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
  .g3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
  .card{border-radius:12px;padding:14px;text-align:center;color:white}
  .card .val{font-size:20px;font-weight:900;margin:6px 0}
  .card .lbl{font-size:11px;opacity:.9}
  .blue{background:linear-gradient(135deg,#3b82f6,#1d4ed8)}
  .green{background:linear-gradient(135deg,#10b981,#059669)}
  .purple{background:linear-gradient(135deg,#8b5cf6,#6d28d9)}
  .red{background:linear-gradient(135deg,#ef4444,#dc2626)}
  .gold{background:linear-gradient(135deg,#FFFFFC,#CCCCAA)}
  .teal{background:linear-gradient(135deg,#14b8a6,#0f766e)}
  .net{border-radius:14px;padding:20px;text-align:center;margin-bottom:16px}
  .net.p{background:linear-gradient(135deg,#d1fae5,#a7f3d0)}
  .net.l{background:linear-gradient(135deg,#fee2e2,#fca5a5)}
  .net .val{font-size:32px;font-weight:900}
  .net.p .val{color:#065f46}
  .net.l .val{color:#991b1b}
  section{margin-bottom:18px}
  section h2{font-size:14px;font-weight:700;padding:8px 12px;background:#f1f5f9;border-right:4px solid #6366f1;border-radius:6px;margin-bottom:10px}
  table{width:100%;border-collapse:collapse;box-shadow:0 1px 6px rgba(0,0,0,.07);border-radius:10px;overflow:hidden}
  thead tr{background:#6366f1;color:white}
  th{padding:9px 10px;text-align:right;font-size:11px}
  td{padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:11px}
  tr:nth-child(even) td{background:#f8fafc}
  tfoot tr td{background:#e0e7ff;font-weight:bold}
  .wb{display:inline-block;background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:12px;font-size:11px}
  .footer{text-align:center;padding:14px;border-top:1px dashed #e2e8f0;color:#64748b;font-size:11px;margin-top:14px}
</style>
</head>
<body>
<div class="header">
  ${logoHtml}
  <h1>${shopName}</h1>
  <p style="opacity:.85">${State.settings.shop_address||''} ${State.settings.shop_phone?'| '+State.settings.shop_phone:''}</p>
  <div class="month-badge">📅 الفاتورة الشهرية — ${monthName}</div>
</div>

<div class="g4">
  <div class="card blue"><div class="lbl">عدد الطلبات</div><div class="val">${mnOrders.length}</div></div>
  <div class="card green"><div class="lbl">إجمالي المبيعات</div><div class="val">${totalRev.toFixed(2)}</div><div class="lbl">${CURRENCY}</div></div>
  <div class="card purple"><div class="lbl">الربح الإجمالي</div><div class="val">${totalProf.toFixed(2)}</div><div class="lbl">${CURRENCY}</div></div>
  <div class="card red"><div class="lbl">إجمالي المصاريف</div><div class="val">${totalOut.toFixed(2)}</div><div class="lbl">${CURRENCY}</div></div>
</div>
<div class="g3">
  <div class="card gold"><div class="lbl">رأس المال</div><div class="val">${capital.toFixed(2)}</div><div class="lbl">${CURRENCY}</div></div>
  <div class="card teal"><div class="lbl">رصيد الصندوق</div><div class="val">${balance.toFixed(2)}</div><div class="lbl">${CURRENCY}</div></div>
  <div class="card ${netProfit>=0?'green':'red'}"><div class="lbl">صافي الربح</div><div class="val">${netProfit>=0?'+':''}${netProfit.toFixed(2)}</div><div class="lbl">${CURRENCY}</div></div>
</div>
<div class="net ${netProfit>=0?'p':'l'}">
  <p style="color:#374151;margin-bottom:6px">النتيجة الصافية للشهر</p>
  <div class="val">${netProfit>=0?'+':''}${netProfit.toFixed(2)} ${CURRENCY}</div>
  <p style="color:#374151;margin-top:6px;font-size:14px">${netProfit>=0?'📈 المحل في ربح الحمد لله ✅':'📉 المحل في خسارة هذا الشهر ⚠️'}</p>
</div>

<section>
  <h2>🏆 أفضل المنتجات مبيعاً</h2>
  <table>
    <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>الإيراد</th><th></th></tr></thead>
    <tbody>${topProds.slice(0,10).map(([n,s],i)=>`
      <tr><td><b>${i+1}</b></td><td>${n}</td><td>${s.qty} وحدة</td><td><b>${s.rev.toFixed(2)} ${CURRENCY}</b></td>
      <td>${i===0?'🥇':i===1?'🥈':i===2?'🥉':'⭐'}</td></tr>`).join('')}
    </tbody>
  </table>
</section>

<section>
  <h2>📅 المبيعات اليومية</h2>
  <table>
    <thead><tr><th>التاريخ</th><th>الطلبات</th><th>الإيراد</th><th>المتوسط/طلب</th></tr></thead>
    <tbody>${Object.entries(byDay).sort().map(([d,v])=>`
      <tr><td>${d}</td><td>${v.orders}</td><td>${v.revenue.toFixed(2)} ${CURRENCY}</td><td>${(v.revenue/v.orders).toFixed(2)} ${CURRENCY}</td></tr>`).join('')}
    </tbody>
    <tfoot><tr><td>الإجمالي</td><td>${mnOrders.length} طلب</td><td>${totalRev.toFixed(2)} ${CURRENCY}</td><td>${mnOrders.length?(totalRev/mnOrders.length).toFixed(2):0} ${CURRENCY}</td></tr></tfoot>
  </table>
</section>

${weakDays.length?`
<section>
  <h2>📉 أضعف الأيام مبيعاً</h2>
  <table>
    <thead><tr><th>التاريخ</th><th>الطلبات</th><th>الإيراد</th><th>التقييم</th></tr></thead>
    <tbody>${weakDays.map(([d,v])=>`
      <tr><td>${d}</td><td>${v.orders}</td><td style="color:#ef4444">${v.revenue.toFixed(2)} ${CURRENCY}</td><td><span class="wb">⚠️ ضعيف</span></td></tr>`).join('')}
    </tbody>
  </table>
</section>`:''}

${mnExp.length?`
<section>
  <h2>💸 تفاصيل المصاريف</h2>
  <table>
    <thead><tr><th>البيان</th><th>الفئة</th><th>النوع</th><th>التاريخ</th><th>المبلغ</th></tr></thead>
    <tbody>${mnExp.map(e=>`
      <tr><td>${e.title}</td><td>${e.category||'عام'}</td>
      <td>${e.type==='in'?'<span style="color:green">إيداع</span>':'<span style="color:red">مصروف</span>'}</td>
      <td>${e.expense_date||''}</td>
      <td style="color:${e.type==='in'?'green':'red'};font-weight:bold">${e.type==='in'?'+':'-'}${parseFloat(e.amount||0).toFixed(2)} ${CURRENCY}</td></tr>`).join('')}
    </tbody>
    <tfoot><tr><td colspan="4">إجمالي المصاريف</td><td style="color:red">${totalOut.toFixed(2)} ${CURRENCY}</td></tr></tfoot>
  </table>
</section>`:''}

<div class="footer">تم الإنشاء: ${new Date().toLocaleString('ar-MA')} | ${shopName} © ${now.getFullYear()}</div>
</body></html>`;

  const w=window.open('','_blank','width=960,height=800');
  w.document.write(html); w.document.close();
  w.onload=()=>w.print();
}

// ══════════════════════════════════════════════════════════
// ── الطلبات ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
let _op='day';
function loadOrders(period,btn) {
  if(period){_op=period;document.querySelectorAll('#page-orders .period-btn').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');}
  const status=document.getElementById('statusFilter')?.value||'';
  const orders=JSON.parse(localStorage.getItem('pos_orders')||'[]');
  const now=new Date();
  const filtered=orders.filter(o=>{
    const d=new Date(o.created_at);
    if(_op==='day'&&d.toDateString()!==now.toDateString())return false;
    if(_op==='week'&&(now-d)>7*86400000)return false;
    if(_op==='month'&&(d.getMonth()!==now.getMonth()||d.getFullYear()!==now.getFullYear()))return false;
    if(status&&o.order_status!==status)return false;
    return true;
  });
  const c=document.getElementById('ordersList');
  if(!filtered.length){c.innerHTML='<div style="text-align:center;padding:3rem;color:var(--text3)"><i class="fas fa-box-open" style="font-size:3rem"></i><p style="margin-top:1rem">لا توجد طلبات</p></div>';return;}
  c.innerHTML=filtered.map(o=>`
    <div class="order-card${o.is_customer_order?' customer-order':''}">
      <div class="order-card-header">
        <span class="order-num">${o.order_number}</span>
        ${o.is_customer_order?'<span style="background:#FFFFFC;color:#333311;padding:2px 8px;border-radius:20px;font-size:.75rem;font-weight:700">🛒 طلب زبون</span>':''}
        <span class="order-customer"><i class="fas fa-user"></i> ${o.customer_name||'زبون'}</span>
        <span class="order-status status-${o.order_status}">${sLabel(o.order_status)}</span>
        <span class="order-total">${parseFloat(o.total||0).toFixed(2)} ${CURRENCY}</span>
        <small style="color:var(--text3)">${fDate(o.created_at)}</small>
      </div>
      <div style="color:var(--text2);font-size:.85rem;margin-bottom:.7rem">
        ${o.items_count||0} منتج | ${tLabel(o.order_type)} | ${pLabel(o.payment_method)}
        ${o.payment_status==='unpaid'?'<span style="color:var(--danger);font-weight:700"> ⚠️ دين غير مدفوع</span>':''}
        ${o.notes?`<br>📝 ${o.notes}`:''}
      </div>
      <div id="items-${o.id}" class="order-items-detail hidden">
        <div style="background:var(--bg3);border-radius:8px;padding:.7rem;margin-bottom:.5rem">
          <table style="width:100%;font-size:.83rem">
            <tr style="font-weight:700;border-bottom:1px solid var(--border)"><td>الصنف</td><td style="text-align:center">الكمية</td><td style="text-align:left">السعر</td></tr>
            ${(o.items||[]).map(i=>`<tr><td>${i.product_name||i.name}</td><td style="text-align:center">${i.quantity}</td><td style="text-align:left">${parseFloat(i.total_price||0).toFixed(2)} ${CURRENCY}</td></tr>`).join('')}
          </table>
        </div>
      </div>
      <div class="order-card-actions">
        <button class="btn-secondary" onclick="toggleOrderItems('${o.id}',this)"><i class="fas fa-list"></i> المنتجات</button>
        <select onchange="updateOrderStatus(${o.id},this.value)">
          <option value="pending" ${o.order_status==='pending'?'selected':''}>⏳ انتظار</option>
          <option value="preparing" ${o.order_status==='preparing'?'selected':''}>👨‍🍳 يحضر</option>
          <option value="ready" ${o.order_status==='ready'?'selected':''}>✅ جاهز</option>
          <option value="delivered" ${o.order_status==='delivered'?'selected':''}>🏠 سُلِّم</option>
          <option value="cancelled" ${o.order_status==='cancelled'?'selected':''}>❌ ملغي</option>
        </select>
        <button class="btn-secondary" onclick='printBon(${safeJ(o)})'><i class="fas fa-print"></i> بون</button>
        <button class="btn-secondary" onclick='sendOWA(${safeJ(o)})'><i class="fab fa-whatsapp"></i></button>
      </div>
    </div>`).join('');
  updateBadges();
}

function toggleOrderItems(id, btn) {
  const el = document.getElementById('items-'+id);
  if (!el) return;
  el.classList.toggle('hidden');
  btn.innerHTML = el.classList.contains('hidden') ? '<i class="fas fa-list"></i> المنتجات' : '<i class="fas fa-times"></i> إخفاء';
}

function updateOrderStatus(id,status){
  const orders=JSON.parse(localStorage.getItem('pos_orders')||'[]');
  const idx=orders.findIndex(o=>o.id==id);
  if(idx!==-1){orders[idx].order_status=status;localStorage.setItem('pos_orders',JSON.stringify(orders));}
  toast('تم التحديث ✅');updateBadges();
}

function sendOWA(order) {
  if(typeof order==='string') order=JSON.parse(order);
  const items=(order.items||[]).map(i=>`• ${i.product_name||i.name} x${i.quantity} = ${parseFloat(i.total_price||0).toFixed(2)} ${CURRENCY}`).join('\n');
  const msg=`*${State.settings.shop_name||'المحل'}*\n────────────\n🧾 ${order.order_number}\n👤 ${order.customer_name||'زبون'}\n────────────\n${items}\n────────────\n💰 *${parseFloat(order.total||0).toFixed(2)} ${CURRENCY}*\n${State.settings.receipt_footer||'شكراً!'}`;
  const custPhone = (order.customer_phone||'').replace(/[^0-9+]/g,'');
  const targetPhone = custPhone ? custPhone.replace(/\+/g,'') : WHATSAPP.replace(/[^0-9]/g,'');
  window.open('https://wa.me/'+targetPhone+'?text='+encodeURIComponent(msg));
}

function sendWhatsApp() {
  if(!State.cart.length){toast('السلة فارغة','warning');return;}
  const items=State.cart.map(i=>`• ${i.name} x${i.quantity} = ${(i.selling_price*i.quantity).toFixed(2)} ${CURRENCY}`).join('\n');
  const msg=`*${State.settings.shop_name||'المحل'}*\n────────────\n${items}\n────────────\n💰 *${getTotal().toFixed(2)} ${CURRENCY}*\n${State.settings.receipt_footer||'شكراً!'}`;
  window.open('https://wa.me/'+WHATSAPP.replace(/[^0-9]/g,'')+'?text='+encodeURIComponent(msg));
}

// ══════════════════════════════════════════════════════════
// ── المنتجات (إدارة + رفع صورة) ──────────────────────────
// ══════════════════════════════════════════════════════════
function loadProductsAdmin() {
  const products=State.products.length?State.products:getDefProds();
  const catSel=document.getElementById('prodCategory');
  if(catSel) catSel.innerHTML=getDefCats().map(c=>`<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
  const em={1:'☕',2:'🧃',3:'🍽️',4:'🥪',5:'🍰'};
  document.getElementById('productsTableBody').innerHTML=products.map(p=>{
    const profit=(parseFloat(p.selling_price)-parseFloat(p.purchase_price)).toFixed(2);
    const isLow=parseInt(p.stock)<=(p.min_stock||5);
    const e=em[p.category_id]||'📦';
    const thumb=p.image_path
      ?`<img src="${p.image_path}" class="prod-thumb" onerror="this.outerHTML='<div class=prod-thumb-placeholder>${e}</div>'">`
      :`<div class="prod-thumb-placeholder">${e}</div>`;
    return `<tr>
      <td>${thumb}</td>
      <td><strong>${p.name}</strong><br><small style="color:var(--text3)">${p.description||''}</small></td>
      <td>${p.category_name||'-'}</td>
      <td>${parseFloat(p.purchase_price).toFixed(2)} ${CURRENCY}</td>
      <td>${parseFloat(p.selling_price).toFixed(2)} ${CURRENCY}</td>
      <td><span class="profit-badge">+${profit}</span></td>
      <td class="${isLow?'stock-low':'stock-ok'}">${p.stock}${isLow?' ⚠️':''}</td>
      <td>${p.total_sold||0}</td>
      <td>
        <button class="btn-icon" onclick="editProduct(${p.id})"><i class="fas fa-edit"></i></button>
        <button class="btn-icon danger" onclick="deleteProduct(${p.id})"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function openProductModal(p=null) {
  document.getElementById('productModalTitle').textContent=p?'تعديل منتج':'إضافة منتج';
  document.getElementById('prodCategory').innerHTML=getDefCats().map(c=>`<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
  document.getElementById('prodId').value      =p?.id||'';
  document.getElementById('prodName').value    =p?.name||'';
  document.getElementById('prodDesc').value    =p?.description||'';
  document.getElementById('prodBarcode').value =p?.barcode||'';
  document.getElementById('prodPurchase').value=p?.purchase_price||'';
  document.getElementById('prodSelling').value =p?.selling_price||'';
  document.getElementById('prodStock').value   =p?.stock||0;
  document.getElementById('prodMinStock').value=p?.min_stock||5;
  document.getElementById('prodFeatured').value=p?.is_featured?'1':'0';
  if(p?.category_id) document.getElementById('prodCategory').value=p.category_id;
  const prev=document.getElementById('prodImagePreview');
  const plch=document.getElementById('prodImagePlaceholder');
  document.getElementById('productImageInput').value='';
  if(p?.image_path){prev.src=p.image_path;prev.style.display='block';plch.style.display='none';}
  else{prev.style.display='none';plch.style.display='flex';}
  openModal('productModal');
}

function previewProductImage(input) {
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const prev=document.getElementById('prodImagePreview');
    const plch=document.getElementById('prodImagePlaceholder');
    prev.src=e.target.result; prev.style.display='block'; plch.style.display='none';
  };
  reader.readAsDataURL(file);
}

function editProduct(id){const p=State.products.find(p=>p.id==id)||getDefProds().find(p=>p.id==id);if(p)openProductModal(p);}

function saveProduct() {
  const name=document.getElementById('prodName').value.trim();
  if(!name){toast('أدخل اسم المنتج','warning');return;}
  const id=document.getElementById('prodId').value;
  let imagePath=id?(State.products.find(p=>p.id==id)?.image_path||''):'';
  const prev=document.getElementById('prodImagePreview');
  if(prev.src&&prev.src.startsWith('data:')) imagePath=prev.src;
  const data={
    name, description:document.getElementById('prodDesc').value,
    barcode:document.getElementById('prodBarcode').value,
    category_id:parseInt(document.getElementById('prodCategory').value),
    purchase_price:parseFloat(document.getElementById('prodPurchase').value)||0,
    selling_price:parseFloat(document.getElementById('prodSelling').value)||0,
    stock:parseInt(document.getElementById('prodStock').value)||0,
    min_stock:parseInt(document.getElementById('prodMinStock').value)||5,
    is_featured:document.getElementById('prodFeatured').value==='1',
    image_path:imagePath,
    category_name:getDefCats().find(c=>c.id==document.getElementById('prodCategory').value)?.name||'',
  };
  const products=getDefProds();
  if(id){const idx=products.findIndex(p=>p.id==id);if(idx!==-1)products[idx]={...products[idx],...data};}
  else{data.id=Date.now();data.total_sold=0;products.push(data);State.products.push(data);}
  localStorage.setItem('pos_products',JSON.stringify(products));
  State.products=products;
  closeModal('productModal');loadProductsAdmin();toast(id?'تم التحديث ✅':'تم إضافة المنتج ✅');
}

function deleteProduct(id){
  if(!confirm('حذف هذا المنتج؟'))return;
  State.products=State.products.filter(p=>p.id!=id);
  localStorage.setItem('pos_products',JSON.stringify(State.products));
  loadProductsAdmin();toast('تم الحذف','info');
}

// ══════════════════════════════════════════════════════════
// ── العملاء ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
function loadCustomers(q='') {
  let customers=JSON.parse(localStorage.getItem('pos_customers')||'[]');
  if(!customers.length){customers=[{id:1,name:'أحمد محمد',phone:'0612345678',city:'الدار البيضاء',total_orders:5,total_spent:450},{id:2,name:'فاطمة الزهراء',phone:'0698765432',city:'الرباط',total_orders:3,total_spent:285}];localStorage.setItem('pos_customers',JSON.stringify(customers));}
  State.customers=customers;
  if(q) customers=customers.filter(c=>c.name.includes(q)||(c.phone||'').includes(q));
  const debts=JSON.parse(localStorage.getItem('pos_debts')||'[]');
  const c=document.getElementById('customersList');
  if(!customers.length){c.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text3)">لا يوجد عملاء</div>';return;}
  c.innerHTML=customers.map(cu=>{
    const cd=debts.filter(d=>d.customer_id==cu.id&&d.status!=='paid');
    const dt=cd.reduce((s,d)=>s+parseFloat(d.remaining_amount||0),0);
    return `<div class="customer-card">
      <div class="customer-avatar">${cu.name.charAt(0)}</div>
      <div class="customer-name">${cu.name}</div>
      <div class="customer-phone"><i class="fas fa-phone"></i> ${cu.phone||'-'}</div>
      <div style="font-size:.8rem;color:var(--text3)">${cu.city||''}</div>
      ${dt>0?`<div style="color:var(--danger);font-size:.82rem;font-weight:700;margin:.3rem 0">⚠️ دين: ${dt.toFixed(2)} ${CURRENCY}</div>`:''}
      <div class="customer-stats">
        <div><div class="customer-stat-val">${cu.total_orders||0}</div><div class="customer-stat-label">طلب</div></div>
        <div><div class="customer-stat-val">${parseFloat(cu.total_spent||0).toFixed(0)}</div><div class="customer-stat-label">${CURRENCY}</div></div>
      </div>
    </div>`;
  }).join('');
}

function searchCustomers(q){loadCustomers(q);}
function openCustomerModal(){openModal('customerModal');}
function saveCustomer(){
  const data={id:Date.now(),name:document.getElementById('custName').value.trim(),phone:document.getElementById('custPhone').value.trim(),city:document.getElementById('custCity').value.trim(),notes:document.getElementById('custNotes').value.trim(),total_orders:0,total_spent:0,created_at:new Date().toISOString()};
  if(!data.name){toast('أدخل اسم العميل','warning');return;}
  const customers=JSON.parse(localStorage.getItem('pos_customers')||'[]');
  customers.push(data);localStorage.setItem('pos_customers',JSON.stringify(customers));State.customers=customers;
  closeModal('customerModal');loadCustomers();toast('تم إضافة العميل ✅');
  ['custName','custPhone','custCity','custNotes'].forEach(id=>document.getElementById(id).value='');
}

function showCustomerPicker(){if(!State.customers.length)loadCustomers();renderCustomerPicker('');openModal('customerPickerModal');}
function renderCustomerPicker(q){
  const list=State.customers.filter(c=>!q||c.name.includes(q)||(c.phone||'').includes(q));
  document.getElementById('customerPickerList').innerHTML=list.map(c=>`
    <div class="picker-item" onclick="selectCustomer(${c.id})"><div><div style="font-weight:700">${c.name}</div><div style="font-size:.8rem;opacity:.7">${c.phone||''} ${c.city?'• '+c.city:''}</div></div></div>`).join('')||'<div style="text-align:center;color:var(--text3);padding:1rem">لا يوجد عملاء</div>';
}
function searchCustomerPicker(q){renderCustomerPicker(q);}
function selectCustomer(id){
  State.selectedCustomer=State.customers.find(c=>c.id==id);
  if(State.selectedCustomer){document.getElementById('cartCustomer').style.display='flex';document.getElementById('cartCustomerName').textContent=State.selectedCustomer.name;}
  closeModal('customerPickerModal');
}
function removeCartCustomer(){State.selectedCustomer=null;document.getElementById('cartCustomer').style.display='none';}
function quickAddCustomer(){closeModal('customerPickerModal');openModal('customerModal');}

// ══════════════════════════════════════════════════════════
// ── الديون ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
function loadDebts(status='',btn){
  if(btn){document.querySelectorAll('#page-debts .filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');}
  let debts=JSON.parse(localStorage.getItem('pos_debts')||'[]');
  if(status) debts=debts.filter(d=>d.status===status);
  const tot=debts.filter(d=>d.status!=='paid').reduce((s,d)=>s+parseFloat(d.remaining_amount||0),0);
  document.getElementById('debtsSummary').innerHTML=`
    <div class="stat-card red"><div class="stat-icon">💰</div><div class="stat-value">${tot.toFixed(2)} ${CURRENCY}</div><div class="stat-label">إجمالي الديون</div></div>
    <div class="stat-card orange"><div class="stat-icon">👤</div><div class="stat-value">${debts.filter(d=>d.status!=='paid').length}</div><div class="stat-label">مدين نشط</div></div>
    <div class="stat-card green"><div class="stat-icon">✅</div><div class="stat-value">${debts.filter(d=>d.status==='paid').length}</div><div class="stat-label">مسددة</div></div>`;
  document.getElementById('debtsList').innerHTML=debts.map(d=>{
    const pct=d.original_amount>0?Math.min(100,(d.paid_amount/d.original_amount*100)):0;
    return `<div class="debt-card">
      <div class="debt-card-header">
        <div>
          <div class="debt-name">${d.customer_name}</div>
          <div class="debt-phone"><i class="fas fa-phone"></i> ${d.customer_phone||'-'}</div>
          ${d.order_number?`<div style="font-size:.78rem;color:var(--text3)">طلب: ${d.order_number}</div>`:''}
        </div>
        <div class="debt-amount">${parseFloat(d.remaining_amount||0).toFixed(2)} ${CURRENCY}</div>
        <span class="debt-status ${d.status}">${dLabel(d.status)}</span>
      </div>
      <div class="debt-progress"><div class="debt-progress-bar" style="width:${pct}%"></div></div>
      <div class="debt-info">
        الأصلي: ${parseFloat(d.original_amount||0).toFixed(2)} | مدفوع: <strong style="color:var(--success)">${parseFloat(d.paid_amount||0).toFixed(2)}</strong> ${CURRENCY}
        ${d.due_date?` | ⏰ ${d.due_date}`:''}${d.notes?`<br>📝 ${d.notes}`:''}
        <br><small style="color:var(--text3)">${fDate(d.created_at)}</small>
      </div>
      <div class="debt-actions">
        ${d.status!=='paid'?`<button class="btn-primary" onclick="openPayDebt(${d.id},${d.remaining_amount})">💳 تسديد</button>`:''}
        ${d.customer_phone?`<button class="btn-secondary" onclick="remindDebt('${d.customer_phone}','${d.customer_name}',${d.remaining_amount})"><i class='fab fa-whatsapp'></i> تذكير</button>`:''}
      </div>
    </div>`;
  }).join('')||'<div style="text-align:center;padding:2rem;color:var(--text3)">لا توجد ديون</div>';
  updateBadges();
}

function openDebtModal(){openModal('debtModal');}
function saveDebt(){
  const data={id:Date.now(),customer_name:document.getElementById('debtCustomer').value.trim(),customer_phone:document.getElementById('debtPhone').value.trim(),original_amount:parseFloat(document.getElementById('debtAmount').value)||0,paid_amount:0,remaining_amount:parseFloat(document.getElementById('debtAmount').value)||0,due_date:document.getElementById('debtDue').value,notes:document.getElementById('debtNotes').value,status:'pending',created_at:new Date().toISOString()};
  if(!data.customer_name||!data.original_amount){toast('أدخل الاسم والمبلغ','warning');return;}
  const debts=JSON.parse(localStorage.getItem('pos_debts')||'[]');
  debts.unshift(data);localStorage.setItem('pos_debts',JSON.stringify(debts));
  closeModal('debtModal');loadDebts();toast('تم تسجيل الدين ✅');
  ['debtCustomer','debtPhone','debtAmount','debtDue','debtNotes'].forEach(id=>document.getElementById(id).value='');
}

function openPayDebt(id,rem){State.currentDebtId=id;document.getElementById('debtRemaining').textContent=parseFloat(rem).toFixed(2);document.getElementById('payDebtAmount').value=parseFloat(rem).toFixed(2);openModal('payDebtModal');}
function confirmPayDebt(){
  const amount=parseFloat(document.getElementById('payDebtAmount').value)||0;
  if(!amount){toast('أدخل المبلغ','warning');return;}
  const debts=JSON.parse(localStorage.getItem('pos_debts')||'[]');
  const idx=debts.findIndex(d=>d.id==State.currentDebtId);
  if(idx!==-1){
    debts[idx].paid_amount=(parseFloat(debts[idx].paid_amount)||0)+amount;
    debts[idx].remaining_amount=Math.max(0,parseFloat(debts[idx].original_amount)-debts[idx].paid_amount);
    debts[idx].status=debts[idx].remaining_amount<=0?'paid':'partial';
    localStorage.setItem('pos_debts',JSON.stringify(debts));
    const bal=parseFloat(localStorage.getItem('pos_cash_balance')||'0')+amount;
    localStorage.setItem('pos_cash_balance',bal.toFixed(2));
  }
  closeModal('payDebtModal');loadDebts();playBeep();toast('✅ تم تسجيل الدفع');
}

function remindDebt(phone,name,amount){
  const msg=`مرحباً ${name}،\nنذكركم بدين بمبلغ *${parseFloat(amount).toFixed(2)} ${CURRENCY}*\nيرجى التسديد.\n${State.settings.shop_name||'المحل'} 🌟`;
  window.open('https://wa.me/'+phone.replace(/[^0-9]/g,'')+'?text='+encodeURIComponent(msg));
}

// ══════════════════════════════════════════════════════════
// ── الصندوق ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
function loadCash(type='',btn){
  if(btn){document.querySelectorAll('#page-cash .filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');}
  let expenses=JSON.parse(localStorage.getItem('pos_expenses')||'[]');
  const orders=JSON.parse(localStorage.getItem('pos_orders')||'[]');
  const capital=parseFloat(localStorage.getItem('pos_capital')||'0');
  let balance=parseFloat(localStorage.getItem('pos_cash_balance')||'0');
  if(balance===0){
    const totalSales=orders.filter(o=>o.payment_method!=='debt'&&o.order_status!=='cancelled').reduce((s,o)=>s+parseFloat(o.total||0),0);
    const totalOut=expenses.filter(e=>e.type==='out'||!e.type).reduce((s,e)=>s+parseFloat(e.amount||0),0);
    const totalIn=expenses.filter(e=>e.type==='in').reduce((s,e)=>s+parseFloat(e.amount||0),0);
    balance=capital+totalSales+totalIn-totalOut;
  }
  const totalOut=expenses.filter(e=>e.type==='out'||!e.type).reduce((s,e)=>s+parseFloat(e.amount||0),0);
  const totalIn=expenses.filter(e=>e.type==='in').reduce((s,e)=>s+parseFloat(e.amount||0),0);
  const salesTotal=orders.filter(o=>o.payment_method!=='debt'&&o.order_status!=='cancelled').reduce((s,o)=>s+parseFloat(o.total||0),0);
  document.getElementById('cashDashboard').innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1rem;margin-bottom:1.5rem">
      <div class="stat-card orange"><div class="stat-icon">🏦</div><div class="stat-value">${capital.toFixed(2)} ${CURRENCY}</div><div class="stat-label">رأس المال الأولي</div>
        <button onclick="setCapital()" style="margin-top:.5rem;padding:.3rem .8rem;background:rgba(255,255,255,.25);border:none;border-radius:8px;cursor:pointer;font-family:var(--font);font-size:.8rem;color:white">✏️ تعديل</button></div>
      <div class="stat-card blue"><div class="stat-icon">💰</div><div class="stat-value">${salesTotal.toFixed(2)} ${CURRENCY}</div><div class="stat-label">إيرادات المبيعات</div></div>
      <div class="stat-card green"><div class="stat-icon">⬆️</div><div class="stat-value">${totalIn.toFixed(2)} ${CURRENCY}</div><div class="stat-label">الإيداعات</div></div>
      <div class="stat-card red"><div class="stat-icon">⬇️</div><div class="stat-value">${totalOut.toFixed(2)} ${CURRENCY}</div><div class="stat-label">المصاريف</div></div>
      <div class="stat-card ${balance>=0?'purple':'red'}" style="grid-column:span 2">
        <div class="stat-icon">${balance>=0?'💎':'⚠️'}</div>
        <div class="stat-value" style="font-size:2rem">${balance.toFixed(2)} ${CURRENCY}</div>
        <div class="stat-label">الرصيد الحالي في الصندوق</div>
      </div>
    </div>`;
  if(type) expenses=expenses.filter(e=>(e.type||'out')===type);
  const ci={'إيجار':'🏠','مشتريات مواد':'🛒','رواتب':'👤','كهرباء وماء':'💡','صيانة':'🔧','توصيل':'🛵','أخرى':'📝'};
  document.getElementById('cashList').innerHTML=expenses.map(e=>`
    <div class="cash-item ${e.type==='in'?'in':'out'}">
      <div class="cash-item-icon">${ci[e.category]||'📝'}</div>
      <div class="cash-item-info"><div class="cash-item-title">${e.title}</div><div class="cash-item-cat">${e.category||'عام'}</div></div>
      <div><div class="cash-item-amount">${e.type==='in'?'+':'-'}${parseFloat(e.amount||0).toFixed(2)} ${CURRENCY}</div><div class="cash-item-date">${e.expense_date||''}</div></div>
      <button onclick="delExpense(${e.id})" style="background:none;border:none;color:var(--danger);cursor:pointer"><i class="fas fa-trash"></i></button>
    </div>`).join('')||'<div style="text-align:center;padding:2rem;color:var(--text3)">لا توجد حركات</div>';
}

function setCapital(){
  const v=prompt('أدخل رأس المال الأولي:',localStorage.getItem('pos_capital')||'0');
  if(v!==null&&!isNaN(parseFloat(v))){
    localStorage.setItem('pos_capital',parseFloat(v).toFixed(2));
    const orders=JSON.parse(localStorage.getItem('pos_orders')||'[]');
    const expenses=JSON.parse(localStorage.getItem('pos_expenses')||'[]');
    const ts=orders.filter(o=>o.payment_method!=='debt'&&o.order_status!=='cancelled').reduce((s,o)=>s+parseFloat(o.total||0),0);
    const to=expenses.filter(e=>e.type==='out'||!e.type).reduce((s,e)=>s+parseFloat(e.amount||0),0);
    const ti=expenses.filter(e=>e.type==='in').reduce((s,e)=>s+parseFloat(e.amount||0),0);
    localStorage.setItem('pos_cash_balance',(parseFloat(v)+ts+ti-to).toFixed(2));
    loadCash();toast('تم تعيين رأس المال ✅');
  }
}

function openExpenseModal(type='out'){
  document.getElementById('expenseType').value=type;
  document.getElementById('expenseModalTitle').textContent=type==='in'?'💚 إيداع في الصندوق':'💸 إضافة مصروف';
  document.getElementById('expenseSubmitBtn').textContent=type==='in'?'💚 إيداع':'💾 حفظ';
  document.getElementById('expDate').value=new Date().toISOString().split('T')[0];
  ['expTitle','expAmount','expDesc'].forEach(id=>document.getElementById(id).value='');
  openModal('expenseModal');
}

function saveExpense(){
  const type=document.getElementById('expenseType').value;
  const title=document.getElementById('expTitle').value.trim();
  const amount=parseFloat(document.getElementById('expAmount').value)||0;
  if(!title||!amount){toast('أدخل البيان والمبلغ','warning');return;}
  const data={id:Date.now(),title,amount,type,category:document.getElementById('expCategory').value,description:document.getElementById('expDesc').value,expense_date:document.getElementById('expDate').value,created_at:new Date().toISOString()};
  const expenses=JSON.parse(localStorage.getItem('pos_expenses')||'[]');
  expenses.unshift(data);localStorage.setItem('pos_expenses',JSON.stringify(expenses));
  let bal=parseFloat(localStorage.getItem('pos_cash_balance')||'0');
  bal=type==='in'?bal+amount:bal-amount;
  localStorage.setItem('pos_cash_balance',bal.toFixed(2));
  closeModal('expenseModal');loadCash();toast(`تم ${type==='in'?'الإيداع':'إضافة المصروف'} ✅`);
}

function delExpense(id){
  if(!confirm('حذف هذا العنصر؟'))return;
  const expenses=JSON.parse(localStorage.getItem('pos_expenses')||'[]');
  const exp=expenses.find(e=>e.id==id);
  if(exp){let bal=parseFloat(localStorage.getItem('pos_cash_balance')||'0');bal=exp.type==='in'?bal-exp.amount:bal+exp.amount;localStorage.setItem('pos_cash_balance',bal.toFixed(2));}
  localStorage.setItem('pos_expenses',JSON.stringify(expenses.filter(e=>e.id!=id)));
  loadCash();toast('تم الحذف','info');
}

// ══════════════════════════════════════════════════════════
// ── التقارير ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
function loadReports(period,btn){
  if(btn){document.querySelectorAll('#page-reports .period-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');}
  const s=calcStats(period);
  renderStats(s);renderCharts(s);renderWeakDays(s.weakDays);renderMonthly(s.monthly);renderLowStock(s.lowStock);
}

function calcStats(period){
  const orders=JSON.parse(localStorage.getItem('pos_orders')||'[]');
  const now=new Date();
  const filtered=orders.filter(o=>{
    if(o.order_status==='cancelled')return false;
    const d=new Date(o.created_at);
    if(period==='day'&&d.toDateString()!==now.toDateString())return false;
    if(period==='week'&&(now-d)>7*86400000)return false;
    if(period==='month'&&(d.getMonth()!==now.getMonth()||d.getFullYear()!==now.getFullYear()))return false;
    return true;
  });
  const revenue=filtered.reduce((s,o)=>s+parseFloat(o.total||0),0);
  let profit=0;const pc={};
  filtered.forEach(o=>(o.items||[]).forEach(i=>{profit+=(i.profit||0);pc[i.product_name||i.name]=(pc[i.product_name||i.name]||0)+i.quantity;}));
  const top=Object.entries(pc).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([n,q])=>({name:n,qty:q}));
  const debts=JSON.parse(localStorage.getItem('pos_debts')||'[]');
  const totalDebts=debts.filter(d=>d.status!=='paid').reduce((s,d)=>s+parseFloat(d.remaining_amount||0),0);
  const products=State.products.length?State.products:getDefProds();
  const lowStock=products.filter(p=>parseInt(p.stock)<=(p.min_stock||5));
  const balance=parseFloat(localStorage.getItem('pos_cash_balance')||'0');
  const weekly=[];
  for(let i=29;i>=0;i--){const d=new Date(now-i*86400000);const dO=orders.filter(o=>new Date(o.created_at).toDateString()===d.toDateString()&&o.order_status!=='cancelled');weekly.push({date:d.toLocaleDateString('ar-MA',{day:'numeric',month:'short'}),revenue:dO.reduce((s,o)=>s+parseFloat(o.total||0),0),orders:dO.length});}
  const dayMap={};
  orders.filter(o=>o.order_status!=='cancelled').forEach(o=>{const d=o.order_date||new Date(o.created_at).toISOString().split('T')[0];if(!dayMap[d])dayMap[d]={revenue:0,orders:0};dayMap[d].revenue+=parseFloat(o.total||0);dayMap[d].orders++;});
  const weakDays=Object.entries(dayMap).sort((a,b)=>a[1].revenue-b[1].revenue).slice(0,5);
  const monthMap={};
  orders.filter(o=>o.order_status!=='cancelled').forEach(o=>{const d=new Date(o.created_at);const k=d.toLocaleString('ar-MA',{month:'long',year:'numeric'});if(!monthMap[k])monthMap[k]={revenue:0,orders:0};monthMap[k].revenue+=parseFloat(o.total||0);monthMap[k].orders++;});
  const monthly=Object.entries(monthMap).reverse();
  return{orders_count:filtered.length,revenue,profit,top,totalDebts,lowStock,balance,weekly,weakDays,monthly};
}

function renderStats(s){
  document.getElementById('statsGrid').innerHTML=`
    <div class="stat-card blue"><div class="stat-icon">📦</div><div class="stat-value">${s.orders_count}</div><div class="stat-label">عدد الطلبات</div></div>
    <div class="stat-card green"><div class="stat-icon">💰</div><div class="stat-value">${s.revenue.toFixed(2)}</div><div class="stat-label">المبيعات (${CURRENCY})</div></div>
    <div class="stat-card purple"><div class="stat-icon">📈</div><div class="stat-value">${s.profit.toFixed(2)}</div><div class="stat-label">الربح (${CURRENCY})</div></div>
    <div class="stat-card red"><div class="stat-icon">💳</div><div class="stat-value">${s.totalDebts.toFixed(2)}</div><div class="stat-label">الديون (${CURRENCY})</div></div>
    <div class="stat-card teal"><div class="stat-icon">💎</div><div class="stat-value">${s.balance.toFixed(2)}</div><div class="stat-label">رصيد الصندوق</div></div>
    <div class="stat-card orange"><div class="stat-icon">🏆</div><div class="stat-value" style="font-size:.95rem">${s.top[0]?.name||'-'}</div><div class="stat-label">أكثر مبيعاً</div></div>`;
}

function renderCharts(s){
  if(State.chartSales)State.chartSales.destroy();
  State.chartSales=new Chart(document.getElementById('salesChart').getContext('2d'),{type:'line',data:{labels:s.weekly.map(d=>d.date),datasets:[{label:'المبيعات',data:s.weekly.map(d=>d.revenue),borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,.1)',tension:.4,fill:true,pointRadius:2}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
  if(State.chartTop)State.chartTop.destroy();
  State.chartTop=new Chart(document.getElementById('topChart').getContext('2d'),{type:'bar',data:{labels:s.top.map(p=>p.name),datasets:[{data:s.top.map(p=>p.qty),backgroundColor:['#6366f1','#10b981','#FFFFFC','#ef4444','#3b82f6'],borderRadius:6}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
}

function renderWeakDays(wd){
  const sec=document.getElementById('weakDaysSection');
  if(!wd.length){sec.innerHTML='';return;}
  sec.innerHTML=`<div class="weak-section"><h3>📉 أضعف الأيام مبيعاً</h3>
    <table class="data-table"><thead><tr><th>التاريخ</th><th>الطلبات</th><th>الإيراد</th><th>التقييم</th></tr></thead>
    <tbody>${wd.map(([d,v])=>`<tr><td style="font-weight:600">${d}</td><td>${v.orders}</td><td style="color:var(--danger);font-weight:700">${v.revenue.toFixed(2)} ${CURRENCY}</td><td><span style="background:#fee2e2;color:#991b1b;padding:2px 10px;border-radius:12px;font-size:.8rem">⚠️ ضعيف</span></td>`).join('')}</tbody>}</div>`;
}

function renderMonthly(monthly){
  const sec=document.getElementById('monthlySection');
  if(!monthly.length){sec.innerHTML='';return;}
  const maxR=Math.max(...monthly.map(([,d])=>d.revenue));
  sec.innerHTML=`<div class="monthly-section"><h3>📊 أداء الأشهر</h3>
    <div style="display:flex;flex-direction:column;gap:.6rem">
    ${monthly.map(([month,d])=>{
      const pct=maxR>0?(d.revenue/maxR*100):0;
      const isW=d.revenue<maxR*.5;
      return `<div style="display:flex;align-items:center;gap:.8rem">
        <div style="width:120px;font-size:.83rem;font-weight:600;flex-shrink:0">${month}</div>
        <div style="flex:1;background:var(--border);border-radius:6px;height:24px;overflow:hidden">
          <div style="width:${pct}%;background:${isW?'var(--warning)':'var(--primary)'};height:100%;border-radius:6px;display:flex;align-items:center;padding:0 8px;min-width:36px;transition:width .5s">
            <span style="color:white;font-size:.72rem;font-weight:700;white-space:nowrap">${d.revenue.toFixed(0)}</span>
          </div>
        </div>
        <div style="width:60px;text-align:left;font-size:.8rem">${d.orders} طلب</div>
        ${isW?'<span style="background:#FFFFFB;color:#444422;padding:2px 7px;border-radius:12px;font-size:.72rem;flex-shrink:0">ضعيف</span>':''}
      </div>`;
    }).join('')}
    </div></div>`;
}

function renderLowStock(items){
  const sec=document.getElementById('lowStockSection');
  if(!items.length){sec.innerHTML='';return;}
  sec.innerHTML=`<div class="low-stock-section"><h3>⚠️ مخزون منخفض (${items.length})</h3>
    <div>${items.map(p=>`<div class="low-stock-item"><span>${p.name}</span><span class="stock-low">متبقي: ${p.stock}${parseInt(p.stock)===0?' ❌ نفد!':''}</span></div>`).join('')}</div></div>`;
}

// ══════════════════════════════════════════════════════════
// ── الإدارة ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
function loadAdmin(){
  loadSettings();renderSettingsForm();
  document.getElementById('usersList').innerHTML=`
    <div class="picker-item" style="margin-bottom:.4rem"><i class="fas fa-user-shield" style="color:var(--primary)"></i><div><div style="font-weight:700">admin — المدير العام</div><div style="font-size:.8rem;opacity:.7">صلاحيات كاملة</div></div></div>
    <div class="picker-item"><i class="fas fa-user"></i><div><div style="font-weight:700">worker — موظف الكاشير</div><div style="font-size:.8rem;opacity:.7">POS + الطلبات فقط</div></div></div>`;
  const logo=State.settings.logo_path||localStorage.getItem('pos_logo')||'';
  if(logo){const cl=document.getElementById('currentLogo');const lp=document.getElementById('logoPlaceholder');if(cl){cl.src=logo;cl.style.display='block';}if(lp)lp.style.display='none';}
  renderCategoriesAdmin();
}

function renderSettingsForm(){
  const s=State.settings;
  document.getElementById('settingsForm').innerHTML=`
    <div class="form-group"><label>اسم المحل</label><input type="text" id="set_shop_name" value="${s.shop_name||''}"></div>
    <div class="form-group"><label>العنوان</label><input type="text" id="set_shop_address" value="${s.shop_address||''}"></div>
    <div class="form-group"><label>الهاتف</label><input type="text" id="set_shop_phone" value="${s.shop_phone||''}"></div>
    <div class="form-group"><label>WhatsApp</label><input type="text" id="set_shop_whatsapp" value="${s.shop_whatsapp||''}"></div>
    <div class="form-group"><label>العملة (DH / SAR / DA)</label><input type="text" id="set_currency" value="${s.currency||'DH'}"></div>
    <div class="form-group"><label>الضريبة %</label><input type="number" id="set_tax_rate" value="${s.tax_rate||0}" min="0" max="100"></div>
    <div class="form-group"><label>🔐 كلمة سر اللوحة السرية</label><input type="password" id="set_secret_password" placeholder="أدخل كلمة السر الجديدة" value=""></div>
    <div class="form-group"><label>نص أسفل البون</label><input type="text" id="set_receipt_footer" value="${s.receipt_footer||'شكراً لزيارتكم! 🌟'}"></div>`;
}

function saveSettings(){
  ['shop_name','shop_address','shop_phone','shop_whatsapp','currency','tax_rate','receipt_footer'].forEach(k=>{const el=document.getElementById('set_'+k);if(el)State.settings[k]=el.value;});
  const spEl=document.getElementById('set_secret_password');
  if(spEl&&spEl.value.trim()) State.settings.secret_password=spEl.value.trim();
  localStorage.setItem('pos_settings',JSON.stringify(State.settings));
  applySettings();toast('تم حفظ الإعدادات ✅');
}

function openUserModal(){openModal('userModal');}
function saveUser(){
  const data={username:document.getElementById('newUsername').value,full_name:document.getElementById('newFullName').value,password:document.getElementById('newPassword').value,role:document.getElementById('newRole').value};
  if(!data.username||!data.password){toast('أدخل الاسم وكلمة المرور','warning');return;}
  closeModal('userModal');toast('تم إضافة المستخدم ✅');
  ['newUsername','newFullName','newPassword'].forEach(id=>document.getElementById(id).value='');
}

function generateQR(){const c=document.getElementById('qrContainer');c.innerHTML='';new QRCode(c,{text:window.location.href,width:150,height:150});toast('تم توليد QR Code ✅');}

function backupData(){
  const data={products:JSON.parse(localStorage.getItem('pos_products')||'[]'),orders:JSON.parse(localStorage.getItem('pos_orders')||'[]'),customers:JSON.parse(localStorage.getItem('pos_customers')||'[]'),debts:JSON.parse(localStorage.getItem('pos_debts')||'[]'),expenses:JSON.parse(localStorage.getItem('pos_expenses')||'[]'),settings:JSON.parse(localStorage.getItem('pos_settings')||'{}'),capital:localStorage.getItem('pos_capital'),balance:localStorage.getItem('pos_cash_balance'),logo:localStorage.getItem('pos_logo'),backup_date:new Date().toISOString()};
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='pos_backup_'+new Date().toISOString().split('T')[0]+'.json';a.click();toast('تم تنزيل النسخة ✅');
}

function restoreData(e){
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const d=JSON.parse(ev.target.result);
      if(d.products)  localStorage.setItem('pos_products', JSON.stringify(d.products));
      if(d.orders)    localStorage.setItem('pos_orders',   JSON.stringify(d.orders));
      if(d.customers) localStorage.setItem('pos_customers',JSON.stringify(d.customers));
      if(d.debts)     localStorage.setItem('pos_debts',    JSON.stringify(d.debts));
      if(d.expenses)  localStorage.setItem('pos_expenses', JSON.stringify(d.expenses));
      if(d.settings)  localStorage.setItem('pos_settings', JSON.stringify(d.settings));
      if(d.capital)   localStorage.setItem('pos_capital',  d.capital);
      if(d.balance)   localStorage.setItem('pos_cash_balance',d.balance);
      if(d.logo)      localStorage.setItem('pos_logo',     d.logo);
      toast('تم استرجاع البيانات ✅');setTimeout(()=>location.reload(),1000);
    }catch{toast('ملف خاطئ','error');}
  };
  r.readAsText(e.target.files[0]);
}

// ══════════════════════════════════════════════════════════
// ── اللوحة السرية ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════
function openSecretPanel(){document.getElementById('secretPanel').classList.remove('hidden');}
function closeSecretPanel(){document.getElementById('secretPanel').classList.add('hidden');document.getElementById('secretLock').style.display='block';document.getElementById('secretData').classList.add('hidden');document.getElementById('secretPassInput').value='';}
function verifySecret(){
  const pass=document.getElementById('secretPassInput').value;
  if(pass===(State.settings.secret_password||'secret2024')){
    document.getElementById('secretLock').style.display='none';
    document.getElementById('secretData').classList.remove('hidden');
    const s=calcStats('day');
    document.getElementById('secretOrders').textContent=s.orders_count;
    document.getElementById('secretRevenue').textContent=s.revenue.toFixed(2)+' '+CURRENCY;
    document.getElementById('secretProfit').textContent=s.profit.toFixed(2)+' '+CURRENCY;
    document.getElementById('secretTop').textContent=s.top[0]?.name||'-';
    document.getElementById('secretBalance').textContent=s.balance.toFixed(2)+' '+CURRENCY;
    document.getElementById('secretDebts').textContent=s.totalDebts.toFixed(2)+' '+CURRENCY;
  }else{toast('كلمة السر خاطئة ❌','error');document.getElementById('secretPassInput').value='';}
}

// ══════════════════════════════════════════════════════════
// ── مساعدات ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
function openModal(id){document.getElementById(id).classList.remove('hidden');}
function closeModal(id){document.getElementById(id).classList.add('hidden');}
document.addEventListener('click',e=>{if(e.target.classList.contains('modal'))closeModal(e.target.id);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal:not(.hidden)').forEach(m=>m.classList.add('hidden'));});

function toast(msg,type='success',dur=3000){
  const c=document.getElementById('toastContainer');
  const icons={success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'};
  const el=document.createElement('div');el.className=`toast ${type}`;el.innerHTML=`<span>${icons[type]}</span><span>${msg}</span>`;c.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transition='opacity .3s';setTimeout(()=>el.remove(),300);},dur);
}

function playBeep(){
  try{const ctx=new(window.AudioContext||window.webkitAudioContext)();const o=ctx.createOscillator();const g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(880,ctx.currentTime);g.gain.setValueAtTime(.2,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.18);o.start();o.stop(ctx.currentTime+.18);}catch{}
}

function fDate(d){if(!d)return'';try{return new Date(d).toLocaleString('ar-MA');}catch{return d;}}
function sLabel(s){return{pending:'⏳ انتظار',preparing:'👨‍🍳 يحضر',ready:'✅ جاهز',delivered:'🏠 سُلِّم',cancelled:'❌ ملغي'}[s]||s;}
function tLabel(t){return{dine_in:'🍽️ داخل',takeaway:'🛍️ خارج',delivery:'🛵 توصيل'}[t]||t;}
function pLabel(m){return{cash:'💵 نقدي',card:'💳 بطاقة',transfer:'📱 تحويل',debt:'📝 دين'}[m]||m;}
function dLabel(s){return{pending:'غير مدفوع',partial:'جزئي',paid:'✅ مدفوع'}[s]||s;}
function safeJ(o){return JSON.stringify(o).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');}

function toggleDark(){
  document.body.classList.toggle('dark');const d=document.body.classList.contains('dark');localStorage.setItem('pos_dark',d);
  document.getElementById('darkIcon').className=d?'fas fa-sun':'fas fa-moon';document.getElementById('darkText').textContent=d?'وضع نهاري':'وضع ليلي';
}
function applyDarkMode(){
  if(localStorage.getItem('pos_dark')==='true'){document.body.classList.add('dark');const i=document.getElementById('darkIcon');if(i){i.className='fas fa-sun';document.getElementById('darkText').textContent='وضع نهاري';}}
}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('collapsed');}
function saveCartToStorage(){localStorage.setItem('pos_cart',JSON.stringify(State.cart));}
function loadCartFromStorage(){const c=JSON.parse(localStorage.getItem('pos_cart')||'[]');if(c.length){State.cart=c;renderCart();}}
function updateBadges(){
  const orders=JSON.parse(localStorage.getItem('pos_orders')||'[]');
  const pending=orders.filter(o=>o.order_status==='pending'&&new Date(o.created_at).toDateString()===new Date().toDateString()).length;
  const pb=document.getElementById('pendingBadge');if(pb){pb.textContent=pending;pb.style.display=pending?'':'none';}
  const debts=JSON.parse(localStorage.getItem('pos_debts')||'[]');
  const unpaid=debts.filter(d=>d.status!=='paid').length;
  const db=document.getElementById('debtsBadge');if(db){db.textContent=unpaid;db.style.display=unpaid?'':'none';}
}
if('serviceWorker'in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{});}

// ── تبديل تبويب الدخول ────────────────────────────────────
function switchLoginTab(type, btn) {
  document.querySelectorAll('.login-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('staffLoginForm').style.display = type==='staff'?'':'none';
  document.getElementById('customerLoginForm').style.display = type==='customer'?'':'none';
}
