require('dotenv').config();
const express  = require('express');
const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');

const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'gizli-anahtar-degistir';

// ── Uploads klasörü ────────────────────────────────────
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Multer — ürün görseli ──────────────────────────────
const productStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `product_${Date.now()}${ext}`);
  }
});
const uploadProduct = multer({
  storage: productStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg','.jpeg','.png','.webp'];
    ok.includes(path.extname(file.originalname).toLowerCase()) ? cb(null,true) : cb(new Error('Sadece JPG, PNG veya WebP'));
  }
});

// ── Multer — logo ──────────────────────────────────────
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `logo${ext}`);
  }
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg','.jpeg','.png','.webp','.svg'];
    ok.includes(path.extname(file.originalname).toLowerCase()) ? cb(null,true) : cb(new Error('Sadece JPG, PNG, WebP veya SVG'));
  }
});

// ── Middleware ─────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database ───────────────────────────────────────────
const db = new Database(path.join(__dirname, 'db', 'katalog.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    UNIQUE NOT NULL,
    password   TEXT    NOT NULL,
    phone      TEXT    DEFAULT '',
    role       TEXT    DEFAULT 'user',
    price_tier TEXT    DEFAULT 'retail',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sku         TEXT    DEFAULT '',
    brand       TEXT    DEFAULT '',
    name        TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    price       REAL    NOT NULL,
    icon        TEXT    DEFAULT '📦',
    image       TEXT    DEFAULT '',
    specs       TEXT    DEFAULT '[]',
    badge       TEXT    DEFAULT '',
    pack_qty    INTEGER DEFAULT 1,
    min_qty     INTEGER DEFAULT 1,
    stock_qty   INTEGER DEFAULT -1,
    currency    TEXT    DEFAULT 'TRY',
    price2      REAL    DEFAULT NULL,
    currency2   TEXT    DEFAULT NULL,
    active      INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS lists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    list_code   TEXT    UNIQUE NOT NULL,
    user_id     INTEGER NOT NULL,
    items       TEXT    NOT NULL,
    total       REAL    NOT NULL,
    status      TEXT    DEFAULT 'pending',
    note        TEXT    DEFAULT '',
    admin_note  TEXT    DEFAULT '',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS product_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    url        TEXT    NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS user_prices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    price      REAL    NOT NULL,
    UNIQUE(user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
\`);

// Kolon migration (eski DB'ler için)
// product_images & user_prices tabloları yukarıda CREATE IF NOT EXISTS ile oluşturuluyor

['price_tier TEXT DEFAULT \'retail\''].forEach(col=>{ try{db.exec(`ALTER TABLE users ADD COLUMN ${col}`)}catch{} });
['price2 REAL','currency2 TEXT','currency TEXT DEFAULT \'TRY\'','image TEXT DEFAULT \'\'','sku TEXT DEFAULT \'\'','brand TEXT DEFAULT \'\'','pack_qty INTEGER DEFAULT 1','min_qty INTEGER DEFAULT 1','stock_qty INTEGER DEFAULT -1'].forEach(col => {
  try { db.exec(`ALTER TABLE products ADD COLUMN ${col}`); } catch {}
});

// ── Seed ──────────────────────────────────────────────
function seedData() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@tekno.com';
  const adminPass  = process.env.ADMIN_PASSWORD || 'admin123';
  const adminName  = process.env.ADMIN_NAME || 'Admin';
  const hash = bcrypt.hashSync(adminPass, 10);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!existing) {
    db.prepare('INSERT INTO users (name, email, password, phone, role) VALUES (?, ?, ?, ?, ?)')
      .run(adminName, adminEmail, hash, '', 'admin');
    console.log(`✅ Admin oluşturuldu: ${adminEmail}`);
  } else {
    // .env'deki şifre her zaman geçerli — redeploy ile sıfırlanır
    db.prepare('UPDATE users SET password=?, name=? WHERE email=?').run(hash, adminName, adminEmail);
    console.log(`🔄 Admin şifresi güncellendi: ${adminEmail}`);
  }

  const defaultSettings = {
    catalog_name:       'TeknoKatalog',
    catalog_logo:       '',
    whatsapp_phone:     '',
    whatsapp_message:   'Merhaba, katalog hakkında bilgi almak istiyorum.',
    webhook_url:        '',
    exchange_rates:     '{"USD":32.5,"EUR":35.0,"GBP":41.0}',
    rates_updated_at:   '',
    price_tiers:        '[{"id":"retail","label":"Perakende","color":"#6366f1"},{"id":"wholesale","label":"Toptan","color":"#16a34a"}]',
    tier_map:           '{"retail":"price1","wholesale":"price2"}'
  };
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(defaultSettings).forEach(([k,v]) => ins.run(k,v));

  if (db.prepare('SELECT COUNT(*) as n FROM products').get().n === 0) {
    const products = [
      ['MacBook Pro M3',      'Laptop',   'Apple Silicon M3 çip, 18 saate kadar pil ömrü ve Liquid Retina ekranıyla profesyonellerin tercihi.',  89999,'💻','["M3 Chip","16GB RAM","512GB SSD"]','hot'],
      ['iPhone 15 Pro',       'Telefon',  'Titanyum çerçeve, A17 Pro çip ve gelişmiş üçlü kamera sistemiyle Apple\'ın amiral gemisi telefonu.',   59999,'📱','["A17 Pro","48MP","Titanyum"]',     'new'],
      ['iPad Pro 12.9"',      'Tablet',   'M2 çipli ProMotion ekranlı profesyonel tablet. Apple Pencil 2 ve Magic Keyboard desteği.',             45999,'📟','["M2 Chip","12MP","5G"]',           ''],
      ['Dell XPS 15',         'Laptop',   'OLED dokunmatik ekran ve 13. nesil Intel Core i9 işlemciyle üstün performanslı iş laptopu.',           62000,'🖥️','["i9-13900H","32GB","1TB SSD"]',    'stock'],
      ['Sony WH-1000XM5',    'Aksesuar', 'Sektörün en gelişmiş gürültü engelleme teknolojisi ve 30 saatlik pil ömrüyle Hi-Res kulaklık.',        12999,'🎧','["ANC","30 saat","Hi-Res"]',        ''],
      ['Samsung 27" OLED',   'Monitör',  '4K OLED panel, 144Hz yenileme hızı ve mükemmel renk doğruluğuyla tasarımcılar için idealdir.',         28500,'🖥️','["4K OLED","144Hz","USB-C"]',       'new'],
      ['Logitech MX Keys',   'Aksesuar', '3 cihaza kadar bağlanabilen akıllı aydınlatmalı profesyonel klavye. Sessiz ve ergonomik.',              3499, '⌨️','["Bluetooth","Backlit","3 cihaz"]', ''],
      ['Synology NAS DS923+','Depolama', '4 yuvalı kurumsal NAS. RAID desteği, 10GbE ağ ve genişletilebilir depolama kapasitesi.',               18750,'💾','["4 Bay","10GbE","Ryzen R1600"]',   ''],
    ];
    const stmt = db.prepare('INSERT INTO products (name,category,description,price,icon,specs,badge) VALUES (?,?,?,?,?,?,?)');
    products.forEach(p => stmt.run(...p));
    console.log('✅ Demo ürünler eklendi.');
  }
}
seedData();

// ── Auth Middleware ────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token gerekli' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Geçersiz token' }); }
}
function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Yetkisiz' });
    next();
  });
}

// ════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {}; rows.forEach(r => s[r.key] = r.value);
  res.json(s);
});

app.put('/api/settings', adminMiddleware, (req, res) => {
  const allowed = ['catalog_name','catalog_logo','whatsapp_phone','whatsapp_message'];
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(req.body).forEach(([k,v]) => { if(allowed.includes(k)) stmt.run(k,v); });
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {}; rows.forEach(r => s[r.key] = r.value);
  res.json(s);
});

app.post('/api/settings/logo', adminMiddleware, uploadLogo.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yüklenemedi.' });
  const logoPath = '/uploads/' + req.file.filename;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('catalog_logo', logoPath);
  res.json({ logo: logoPath });
});

// ════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name||!email||!password) return res.status(400).json({ error: 'Tüm alanları doldurun.' });
  if (password.length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı.' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email))
    return res.status(400).json({ error: 'Bu e-posta zaten kayıtlı.' });
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (name,email,password,phone) VALUES (?,?,?,?)').run(name,email,hash,phone||'');
  const user = db.prepare('SELECT id,name,email,phone,role FROM users WHERE id=?').get(result.lastInsertRowid);
  const token = jwt.sign({ id:user.id, email:user.email, role:user.role }, SECRET, { expiresIn:'30d' });
  res.json({ token, user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
  const token = jwt.sign({ id:user.id, email:user.email, role:user.role }, SECRET, { expiresIn:'30d' });
  const { password:_, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id,name,email,phone,role FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  res.json(user);
});

app.put('/api/auth/profile', authMiddleware, (req, res) => {
  const { name, phone } = req.body;
  db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(name, phone||'', req.user.id);
  res.json(db.prepare('SELECT id,name,email,phone,role FROM users WHERE id=?').get(req.user.id));
});

// ════════════════════════════════════════════════════════
// PRODUCTS
// ════════════════════════════════════════════════════════
app.get('/api/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE active=1 ORDER BY id DESC').all();
  let userId = null, userTier = 'retail';
  if (req.headers.authorization) {
    try {
      const decoded = jwt.verify(req.headers.authorization.split(' ')[1], SECRET);
      userId = decoded.id;
      const u = db.prepare('SELECT price_tier FROM users WHERE id=?').get(userId);
      userTier = u?.price_tier || 'retail';
    } catch {}
  }
  // tier_map: hangi tier hangi fiyat kolonunu kullanır
  let tierMapRaw = db.prepare("SELECT value FROM settings WHERE key='tier_map'").get();
  let tierMap = {};
  try { tierMap = JSON.parse(tierMapRaw?.value||'{}'); } catch {}

  res.json(products.map(p => {
    const images = db.prepare('SELECT url FROM product_images WHERE product_id=? ORDER BY sort_order').all(p.id).map(r=>r.url);
    // Fiyat seç: önce user_prices (özel), sonra tier'a göre price1/price2
    let price = p.price, currency = p.currency;
    if (userId) {
      const up = db.prepare('SELECT price FROM user_prices WHERE user_id=? AND product_id=?').get(userId, p.id);
      if (up) { price = up.price; }
      else {
        const col = tierMap[userTier] || 'price1';
        if (col === 'price2' && p.price2 != null) { price = p.price2; currency = p.currency2 || p.currency; }
      }
    }
    return { ...p, price, currency, specs: JSON.parse(p.specs||'[]'), images };
  }));
});

app.post('/api/products', adminMiddleware, (req, res) => {
  const { name, category, description, price, icon, image, specs, badge, sku, brand, pack_qty, min_qty, stock_qty, currency, price2, currency2 } = req.body;
  if (!name||!price) return res.status(400).json({ error: 'Ürün adı ve fiyat zorunlu.' });
  const result = db.prepare(
    'INSERT INTO products (sku,brand,name,category,description,price,icon,image,specs,badge,pack_qty,min_qty,stock_qty,currency,price2,currency2) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(sku||'', brand||'', name, category||'Genel', description||'', price, icon||'📦', image||'', JSON.stringify(specs||[]), badge||'', pack_qty||1, min_qty||1, stock_qty!==undefined?stock_qty:-1, currency||'TRY', price2||null, currency2||null);
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(result.lastInsertRowid);
  res.json({ ...p, specs: JSON.parse(p.specs) });
});

app.put('/api/products/:id', adminMiddleware, (req, res) => {
  const { name, category, description, price, icon, image, specs, badge, sku, brand, pack_qty, min_qty, stock_qty, currency, price2, currency2 } = req.body;
  db.prepare(
    'UPDATE products SET sku=?,brand=?,name=?,category=?,description=?,price=?,icon=?,image=?,specs=?,badge=?,pack_qty=?,min_qty=?,stock_qty=?,currency=?,price2=?,currency2=? WHERE id=?'
  ).run(sku||'', brand||'', name, category, description, price, icon, image||'', JSON.stringify(specs||[]), badge||'', pack_qty||1, min_qty||1, stock_qty!==undefined?stock_qty:-1, currency||'TRY', price2||null, currency2||null, req.params.id);
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  res.json({ ...p, specs: JSON.parse(p.specs) });
});

app.delete('/api/products/:id', adminMiddleware, (req, res) => {
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Görsel yükleme
app.post('/api/products/upload-image', adminMiddleware, uploadProduct.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yüklenemedi.' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// ════════════════════════════════════════════════════════
// LISTS
// ════════════════════════════════════════════════════════
app.get('/api/lists/my', authMiddleware, (req, res) => {
  const lists = db.prepare('SELECT * FROM lists WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json(lists.map(l => ({ ...l, items: JSON.parse(l.items) })));
});

app.get('/api/lists', adminMiddleware, (req, res) => {
  const lists = db.prepare(`
    SELECT l.*, u.name as user_name, u.phone as user_phone, u.email as user_email
    FROM lists l JOIN users u ON l.user_id=u.id
    ORDER BY CASE WHEN l.status='pending' THEN 0 ELSE 1 END, l.created_at DESC
  `).all();
  res.json(lists.map(l => ({ ...l, items: JSON.parse(l.items) })));
});

app.post('/api/lists', authMiddleware, (req, res) => {
  const { items, note } = req.body;
  if (!items||!items.length) return res.status(400).json({ error: 'Liste boş olamaz.' });
  const total     = items.reduce((s,i) => s + i.price * i.qty, 0);
  const list_code = 'LST-' + Date.now();
  const result = db.prepare('INSERT INTO lists (list_code,user_id,items,total,note) VALUES (?,?,?,?,?)')
    .run(list_code, req.user.id, JSON.stringify(items), total, note||'');
  const list = db.prepare('SELECT * FROM lists WHERE id=?').get(result.lastInsertRowid);
  res.json({ ...list, items: JSON.parse(list.items) });
});

app.put('/api/lists/:id', authMiddleware, (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id=?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'Liste bulunamadı.' });
  if (list.user_id !== req.user.id) return res.status(403).json({ error: 'Bu liste size ait değil.' });
  if (list.status !== 'pending') return res.status(400).json({ error: 'Onaylanmış listeler düzenlenemez.' });
  const { items, note } = req.body;
  const total = items.reduce((s,i) => s + i.price * i.qty, 0);
  db.prepare('UPDATE lists SET items=?,total=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(JSON.stringify(items), total, note||'', req.params.id);
  const updated = db.prepare('SELECT * FROM lists WHERE id=?').get(req.params.id);
  res.json({ ...updated, items: JSON.parse(updated.items) });
});

app.put('/api/lists/:id/approve', adminMiddleware, (req, res) => {
  db.prepare('UPDATE lists SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run('approved', req.body.admin_note||'', req.params.id);
  const list = db.prepare('SELECT * FROM lists WHERE id=?').get(req.params.id);
  sendWhatsAppWebhook(req.params.id, 'approved');
  res.json({ ...list, items: JSON.parse(list.items) });
});

app.put('/api/lists/:id/reject', adminMiddleware, (req, res) => {
  db.prepare('UPDATE lists SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run('rejected', req.body.admin_note||'', req.params.id);
  const list = db.prepare('SELECT * FROM lists WHERE id=?').get(req.params.id);
  sendWhatsAppWebhook(req.params.id, 'rejected');
  res.json({ ...list, items: JSON.parse(list.items) });
});

app.get('/api/users', adminMiddleware, (req, res) => {
  res.json(db.prepare('SELECT id,name,email,phone,role,price_tier,created_at FROM users ORDER BY created_at DESC').all());
});

// ── Fiyat Tier Yönetimi ──────────────────────────────
app.put('/api/users/:id/tier', adminMiddleware, (req, res) => {
  const { price_tier } = req.body;
  db.prepare('UPDATE users SET price_tier=? WHERE id=?').run(price_tier||'retail', req.params.id);
  res.json(db.prepare('SELECT id,name,email,phone,role,price_tier FROM users WHERE id=?').get(req.params.id));
});

app.put('/api/settings/tier-config', adminMiddleware, (req, res) => {
  const { price_tiers, tier_map } = req.body;
  if (price_tiers) db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('price_tiers',?)").run(JSON.stringify(price_tiers));
  if (tier_map)    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('tier_map',?)").run(JSON.stringify(tier_map));
  res.json({ success: true });
});

// ── Ürün Galerisi ─────────────────────────────────────
app.get('/api/products/:id/images', (req, res) => {
  const imgs = db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order').all(req.params.id);
  res.json(imgs);
});

app.post('/api/products/:id/images', adminMiddleware, uploadProduct.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yüklenemedi.' });
  const count = db.prepare('SELECT COUNT(*) as n FROM product_images WHERE product_id=?').get(req.params.id).n;
  if (count >= 5) return res.status(400).json({ error: 'Maksimum 5 görsel yüklenebilir.' });
  const url = '/uploads/' + req.file.filename;
  db.prepare('INSERT INTO product_images (product_id,url,sort_order) VALUES (?,?,?)').run(req.params.id, url, count);
  // Birinci görsel ana görsel olsun
  if (count === 0) db.prepare('UPDATE products SET image=? WHERE id=?').run(url, req.params.id);
  res.json({ url, id: db.prepare('SELECT last_insert_rowid() as id').get().id });
});

app.delete('/api/products/:id/images/:imgId', adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM product_images WHERE id=? AND product_id=?').run(req.params.imgId, req.params.id);
  // Ana görseli güncelle
  const first = db.prepare('SELECT url FROM product_images WHERE product_id=? ORDER BY sort_order LIMIT 1').get(req.params.id);
  db.prepare('UPDATE products SET image=? WHERE id=?').run(first?first.url:'', req.params.id);
  res.json({ success: true });
});

// ── Müşteri Özel Fiyat ────────────────────────────────
app.get('/api/user-prices/:userId', adminMiddleware, (req, res) => {
  const prices = db.prepare('SELECT up.*, p.name as product_name, p.price as base_price FROM user_prices up JOIN products p ON up.product_id=p.id WHERE up.user_id=?').all(req.params.userId);
  res.json(prices);
});

app.post('/api/user-prices', adminMiddleware, (req, res) => {
  const { user_id, product_id, price } = req.body;
  db.prepare('INSERT OR REPLACE INTO user_prices (user_id,product_id,price) VALUES (?,?,?)').run(user_id, product_id, price);
  res.json({ success: true });
});

app.delete('/api/user-prices/:id', adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM user_prices WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Dashboard ─────────────────────────────────────────
app.get('/api/dashboard', adminMiddleware, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const pending = db.prepare("SELECT COUNT(*) as n FROM lists WHERE status='pending'").get().n;
  const todayLists = db.prepare("SELECT COUNT(*) as n FROM lists WHERE date(created_at)=?").get(today).n;
  const monthStart = new Date(); monthStart.setDate(1);
  const monthRev = db.prepare("SELECT COALESCE(SUM(total),0) as t FROM lists WHERE status='approved' AND created_at>=?").get(monthStart.toISOString()).t;
  const totalUsers = db.prepare("SELECT COUNT(*) as n FROM users WHERE role='user'").get().n;
  const recentLists = db.prepare("SELECT l.*,u.name as user_name FROM lists l JOIN users u ON l.user_id=u.id ORDER BY l.created_at DESC LIMIT 8").all();
  res.json({ pending, todayLists, monthRev, totalUsers, recentLists: recentLists.map(l=>({...l,items:JSON.parse(l.items)})) });
});

// ── WhatsApp Webhook ──────────────────────────────────
async function sendWhatsAppWebhook(listId, action) {
  const setting = db.prepare("SELECT value FROM settings WHERE key='webhook_url'").get();
  const webhookUrl = setting?.value;
  if (!webhookUrl) return;
  const list = db.prepare('SELECT l.*,u.name as user_name,u.phone as user_phone,u.email as user_email FROM lists l JOIN users u ON l.user_id=u.id WHERE l.id=?').get(listId);
  if (!list) return;
  try {
    const fetch = (await import('node-fetch')).default;
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action, list_code: list.list_code, status: list.status,
        user_name: list.user_name, user_phone: list.user_phone, user_email: list.user_email,
        total: list.total, admin_note: list.admin_note, items: JSON.parse(list.items)
      })
    });
  } catch(e) { console.error('Webhook hatası:', e.message); }
}

// ── Bulk import ───────────────────────────────────────
app.post('/api/products/bulk-import', adminMiddleware, (req, res) => {
  const { products } = req.body;
  if (!products || !Array.isArray(products)) return res.status(400).json({ error: 'Geçersiz veri.' });
  const stmt = db.prepare(
    'INSERT INTO products (sku,brand,name,category,description,price,icon,image,specs,badge,pack_qty,min_qty,stock_qty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  let ok=0, fail=0;
  const insertMany = db.transaction((rows) => {
    for (const p of rows) {
      try {
        stmt.run(
          p.sku||'', p.brand||'', p.name||'', p.category||'Genel',
          p.description||'', parseFloat(p.price)||0, p.icon||'📦', '',
          JSON.stringify([]), p.badge||'', parseInt(p.pack_qty)||1,
          parseInt(p.min_qty)||1, parseInt(p.stock_qty)||(-1)
        );
        ok++;
      } catch { fail++; }
    }
  });
  insertMany(products);
  res.json({ ok, fail });
});

// ── Döviz Kuru Güncelle ───────────────────────────────
app.post('/api/exchange-rates/refresh', adminMiddleware, async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    // TCMB XML feed - USD, EUR, GBP
    const xml = await (await fetch('https://www.tcmb.gov.tr/kurlar/today.xml')).text();
    const parseRate = (code) => {
      const m = xml.match(new RegExp(`CurrencyCode="${code}"[\s\S]*?<ForexSelling>([\d.]+)<`));
      return m ? parseFloat(m[1]) : null;
    };
    const USD = parseRate('USD'), EUR = parseRate('EUR'), GBP = parseRate('GBP');
    if (!USD) throw new Error('TCMB verisi alınamadı');
    const rates = { USD, EUR, GBP };
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('exchange_rates',?)").run(JSON.stringify(rates));
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('rates_updated_at',?)").run(new Date().toISOString());
    res.json({ rates, updated_at: new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/exchange-rates', adminMiddleware, (req, res) => {
  const { rates } = req.body;
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('exchange_rates',?)").run(JSON.stringify(rates));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('rates_updated_at',?)").run(new Date().toISOString());
  res.json({ success: true, rates });
});

// ── SPA fallback ───────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`🚀 TeknoKatalog çalışıyor: http://localhost:${PORT}`);
  console.log(`📧 Admin: ${process.env.ADMIN_EMAIL || 'admin@tekno.com'}`);
});
