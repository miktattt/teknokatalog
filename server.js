require('dotenv').config();
const express   = require('express');
const Database  = require('better-sqlite3');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');
const multer    = require('multer');
const https     = require('https');
let nodemailer;
try { nodemailer = require('nodemailer'); } catch {}
const crypto = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'gizli-anahtar-degistir';

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
    ok.includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new Error('Sadece JPG, PNG veya WebP'));
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
    ok.includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new Error('Sadece JPG, PNG, WebP veya SVG'));
  }
});

// ── Middleware ─────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : null;

app.use(cors({
  origin: allowedOrigins
    ? (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error('CORS: izin verilmeyen origin'));
      }
    : true
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc:       ["'self'", "fonts.gstatic.com"],
      imgSrc:        ["'self'", "data:", "blob:"],
      connectSrc:    ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false,
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Çok fazla istek. Lütfen bekleyin.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json({ limit: '5mb' }));
app.use('/api/', globalLimiter);

// Türkçe karakter desteği için açık charset
app.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return origJson(body);
  };
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  }
}));

// ── Database ───────────────────────────────────────────
const db = new Database(path.join(__dirname, 'db', 'katalog.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    email           TEXT    UNIQUE NOT NULL,
    password        TEXT    NOT NULL,
    phone           TEXT    DEFAULT '',
    company         TEXT    DEFAULT '',
    tax_no          TEXT    DEFAULT '',
    role            TEXT    DEFAULT 'user',
    customer_type   TEXT    DEFAULT 'retail',
    status          TEXT    DEFAULT 'active',
    discount_pct    REAL    DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sku             TEXT    DEFAULT '',
    barcode         TEXT    DEFAULT '',
    brand           TEXT    DEFAULT '',
    name            TEXT    NOT NULL,
    category        TEXT    NOT NULL,
    description     TEXT    DEFAULT '',
    price           REAL    NOT NULL,
    price_retail    REAL    DEFAULT 0,
    price_wholesale REAL    DEFAULT 0,
    cost_price      REAL    DEFAULT 0,
    vat_rate        REAL    DEFAULT 0,
    icon            TEXT    DEFAULT '📦',
    image           TEXT    DEFAULT '',
    images          TEXT    DEFAULT '[]',
    specs           TEXT    DEFAULT '[]',
    badge           TEXT    DEFAULT '',
    pack_qty        INTEGER DEFAULT 1,
    min_qty         INTEGER DEFAULT 1,
    stock_qty       INTEGER DEFAULT -1,
    active          INTEGER DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS lists (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    list_code       TEXT    UNIQUE NOT NULL,
    user_id         INTEGER NOT NULL,
    items           TEXT    NOT NULL,
    total           REAL    NOT NULL,
    status          TEXT    DEFAULT 'pending',
    note            TEXT    DEFAULT '',
    admin_note      TEXT    DEFAULT '',
    delivery_date   TEXT    DEFAULT '',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    body        TEXT    DEFAULT '',
    url         TEXT    DEFAULT '',
    type        TEXT    DEFAULT 'info',
    active      INTEGER DEFAULT 1,
    sort_order  INTEGER DEFAULT 0,
    starts_at   DATETIME DEFAULT NULL,
    ends_at     DATETIME DEFAULT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    token       TEXT    UNIQUE NOT NULL,
    expires_at  DATETIME NOT NULL,
    used        INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id    INTEGER NOT NULL,
    action      TEXT    NOT NULL,
    entity_type TEXT    DEFAULT '',
    entity_id   TEXT    DEFAULT '',
    details     TEXT    DEFAULT '{}',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Migrations for existing DBs ────────────────────────
const migrations = [
  "image TEXT DEFAULT ''",
  "sku TEXT DEFAULT ''",
  "brand TEXT DEFAULT ''",
  "pack_qty INTEGER DEFAULT 1",
  "min_qty INTEGER DEFAULT 1",
  "stock_qty INTEGER DEFAULT -1",
  "cost_price REAL DEFAULT 0",
  "price_retail REAL DEFAULT 0",
  "price_wholesale REAL DEFAULT 0",
  "vat_rate REAL DEFAULT 0",
  "barcode TEXT DEFAULT ''",
  "images TEXT DEFAULT '[]'",
];
migrations.forEach(col => {
  try { db.exec(`ALTER TABLE products ADD COLUMN ${col}`); } catch {}
});

const userMigrations = [
  "company TEXT DEFAULT ''",
  "tax_no TEXT DEFAULT ''",
  "customer_type TEXT DEFAULT 'retail'",
  "status TEXT DEFAULT 'active'",
  "discount_pct REAL DEFAULT 0",
];
userMigrations.forEach(col => {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch {}
});

const listMigrations = [
  "delivery_date TEXT DEFAULT ''",
];
listMigrations.forEach(col => {
  try { db.exec(`ALTER TABLE lists ADD COLUMN ${col}`); } catch {}
});

const announcementMigrations = [
  "url TEXT DEFAULT ''",
  "starts_at DATETIME DEFAULT NULL",
  "ends_at DATETIME DEFAULT NULL",
];
announcementMigrations.forEach(col => {
  try { db.exec(`ALTER TABLE announcements ADD COLUMN ${col}`); } catch {}
});

// Performance indexes
[
  'CREATE INDEX IF NOT EXISTS idx_lists_user_id ON lists(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_lists_status ON lists(status)',
  'CREATE INDEX IF NOT EXISTS idx_lists_created_at ON lists(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)',
  'CREATE INDEX IF NOT EXISTS idx_products_active ON products(active)',
  'CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)',
].forEach(sql => { try { db.exec(sql); } catch {} });

// ── Seed ──────────────────────────────────────────────
function seedData() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@tekno.com';
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail)) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
    db.prepare('INSERT INTO users (name, email, password, phone, role, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(process.env.ADMIN_NAME || 'Admin', adminEmail, hash, '', 'admin', 'active');
    console.log(`✅ Admin oluşturuldu: ${adminEmail}`);
  }

  const defaultSettings = {
    catalog_name:      'TeknoKatalog',
    catalog_logo:      '',
    whatsapp_phone:    '',
    whatsapp_message:  'Merhaba, katalog hakkında bilgi almak istiyorum.',
    foreign_currency:  'USD',
    exchange_rate:     '0',
    default_vat_rate:  '0',
    require_approval:  '0',
    show_vat_prices:   '0',
    mail_host:         '',
    mail_port:         '587',
    mail_user:         '',
    mail_pass:         '',
    mail_from:         '',
    mail_to_admin:     '',
  };
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(defaultSettings).forEach(([k, v]) => ins.run(k, v));

  if (db.prepare('SELECT COUNT(*) as n FROM products').get().n === 0) {
    const products = [
      ['MacBook Pro M3',      'Laptop',   'Apple Silicon M3 çip, 18 saate kadar pil ömrü ve Liquid Retina ekranıyla profesyonellerin tercihi.',  89999, 72000, '💻', '["M3 Chip","16GB RAM","512GB SSD"]', 'hot',   0, 0],
      ['iPhone 15 Pro',       'Telefon',  "Titanyum çerçeve, A17 Pro çip ve gelişmiş üçlü kamera sistemiyle Apple'ın amiral gemisi telefonu.",   59999, 48000, '📱', '["A17 Pro","48MP","Titanyum"]',      'new',   0, 0],
      ['iPad Pro 12.9"',      'Tablet',   'M2 çipli ProMotion ekranlı profesyonel tablet.',                                                      45999, 37000, '📟', '["M2 Chip","12MP","5G"]',            '',      0, 0],
      ['Dell XPS 15',         'Laptop',   '13. nesil Intel Core i9 işlemciyle üstün performanslı iş laptopu.',                                   62000, 50000, '🖥️', '["i9-13900H","32GB","1TB SSD"]',     'stock', 0, 0],
      ['Sony WH-1000XM5',     'Aksesuar', 'Sektörün en gelişmiş gürültü engelleme teknolojisiyle Hi-Res kulaklık.',                              12999,  9500, '🎧', '["ANC","30 saat","Hi-Res"]',         '',      0, 0],
      ['Samsung 27" OLED',    'Monitör',  '4K OLED panel, 144Hz yenileme hızı ile tasarımcılar için ideal.',                                     28500, 22000, '🖥️', '["4K OLED","144Hz","USB-C"]',        'new',   0, 0],
      ['Logitech MX Keys',    'Aksesuar', '3 cihaza kadar bağlanabilen akıllı aydınlatmalı profesyonel klavye.',                                   3499,  2500, '⌨️', '["Bluetooth","Backlit","3 cihaz"]',  '',      0, 0],
      ['Synology NAS DS923+', 'Depolama', '4 yuvalı kurumsal NAS. RAID desteği, 10GbE ağ ve genişletilebilir depolama kapasitesi.',              18750, 14500, '💾', '["4 Bay","10GbE","Ryzen R1600"]',    '',      0, 0],
    ];
    const stmt = db.prepare(
      'INSERT INTO products (name,category,description,price,cost_price,icon,specs,badge,price_retail,price_wholesale) VALUES (?,?,?,?,?,?,?,?,?,?)'
    );
    products.forEach(p => stmt.run(...p));
    console.log('✅ Demo ürünler eklendi.');
  }
}
seedData();

// ── Audit log helper ───────────────────────────────────
function logAudit(adminId, action, entityType, entityId, details) {
  try {
    db.prepare('INSERT INTO audit_log (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)')
      .run(adminId, action, entityType || '', String(entityId || ''), JSON.stringify(details || {}));
  } catch {}
}

// ── Email helper ───────────────────────────────────────
function getMailSettings() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'mail_%'").all();
  const s = {};
  rows.forEach(r => s[r.key] = r.value);
  return s;
}

async function sendMail({ to, subject, html }) {
  if (!nodemailer) return;
  const ms = getMailSettings();
  if (!ms.mail_host || !ms.mail_user || !ms.mail_pass) return;
  try {
    const transporter = nodemailer.createTransport({
      host: ms.mail_host,
      port: parseInt(ms.mail_port) || 587,
      secure: parseInt(ms.mail_port) === 465,
      auth: { user: ms.mail_user, pass: ms.mail_pass },
      tls: { rejectUnauthorized: false },
    });
    await transporter.sendMail({
      from: ms.mail_from || ms.mail_user,
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error('E-posta gönderilemedi:', err.message);
  }
}

// ── Auth Middleware ────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token gerekli' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Geçersiz token' }); }
}
function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Yetkisiz' });
    next();
  });
}

// ── Input validation ───────────────────────────────────
function validateProduct(body) {
  const { name, price, pack_qty, min_qty } = body;
  if (!name || !String(name).trim()) return 'Ürün adı zorunlu.';
  if (price === undefined || price === null || price === '' || isNaN(Number(price)) || Number(price) <= 0)
    return 'Fiyat geçerli bir pozitif sayı olmalı.';
  if (pack_qty !== undefined && (isNaN(Number(pack_qty)) || Number(pack_qty) < 1))
    return 'Paket adedi en az 1 olmalı.';
  if (min_qty !== undefined && (isNaN(Number(min_qty)) || Number(min_qty) < 1))
    return 'Min. sipariş adedi en az 1 olmalı.';
  return null;
}

// ════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════
const ALLOWED_SETTINGS = [
  'catalog_name','catalog_logo','whatsapp_phone','whatsapp_message',
  'foreign_currency','exchange_rate','default_vat_rate',
  'require_approval','show_vat_prices',
  'mail_host','mail_port','mail_user','mail_pass','mail_from','mail_to_admin',
];

app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  rows.forEach(r => {
    // Don't expose mail password to non-admins
    if (r.key === 'mail_pass') return;
    s[r.key] = r.value;
  });
  res.json(s);
});

app.get('/api/settings/all', adminMiddleware, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  rows.forEach(r => s[r.key] = r.value);
  res.json(s);
});

app.put('/api/settings', adminMiddleware, (req, res) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(req.body).forEach(([k, v]) => { if (ALLOWED_SETTINGS.includes(k)) stmt.run(k, String(v)); });
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  rows.forEach(r => s[r.key] = r.value);
  res.json(s);
});

app.post('/api/settings/logo', adminMiddleware, uploadLogo.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yüklenemedi.' });
  const logoPath = '/uploads/' + req.file.filename;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('catalog_logo', logoPath);
  res.json({ logo: logoPath });
});

// TCMB Döviz Kuru
app.get('/api/settings/exchange-rate', adminMiddleware, async (req, res) => {
  const currency = req.query.currency || 'USD';
  try {
    // Try TCMB XML
    const data = await new Promise((resolve, reject) => {
      const reqUrl = 'https://www.tcmb.gov.tr/kurlar/today.xml';
      https.get(reqUrl, { timeout: 8000 }, (r) => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => resolve(body));
      }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
    });
    // Parse XML with regex
    const re = new RegExp(`CurrencyCode="${currency}"[\\s\\S]*?<ForexSelling>([\\d.]+)<\\/ForexSelling>`, 'i');
    const match = data.match(re);
    if (match) {
      const rate = parseFloat(match[1]);
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('exchange_rate', String(rate));
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('foreign_currency', currency);
      return res.json({ rate, currency, source: 'TCMB' });
    }
    throw new Error('Kur bulunamadı');
  } catch {
    // Fallback: open.er-api.com
    try {
      const data = await new Promise((resolve, reject) => {
        https.get(`https://open.er-api.com/v6/latest/TRY`, { timeout: 8000 }, (r) => {
          let body = '';
          r.on('data', chunk => body += chunk);
          r.on('end', () => resolve(JSON.parse(body)));
        }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
      });
      if (data.rates && data.rates[currency]) {
        // rates[USD] = how many USD per 1 TRY → rate (TRY per 1 USD) = 1/rates[USD]
        const rate = Math.round((1 / data.rates[currency]) * 100) / 100;
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('exchange_rate', String(rate));
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('foreign_currency', currency);
        return res.json({ rate, currency, source: 'er-api' });
      }
      throw new Error('Kur bulunamadı');
    } catch (e2) {
      res.status(502).json({ error: 'Döviz kuru alınamadı: ' + e2.message });
    }
  }
});

// ════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════
app.post('/api/auth/register', authLimiter, (req, res) => {
  const { name, email, password, phone, company, tax_no, customer_type } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Tüm alanları doldurun.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin.' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı.' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email))
    return res.status(400).json({ error: 'Bu e-posta zaten kayıtlı.' });

  const requireApproval = db.prepare("SELECT value FROM settings WHERE key='require_approval'").get()?.value === '1';
  const status = requireApproval ? 'pending' : 'active';
  const ctype = ['retail','wholesale'].includes(customer_type) ? customer_type : 'retail';

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (name,email,password,phone,company,tax_no,customer_type,status) VALUES (?,?,?,?,?,?,?,?)'
  ).run(
    String(name).trim(), email.toLowerCase(), hash,
    phone || '', company || '', tax_no || '', ctype, status
  );

  // E-posta bildirimi (admin)
  const adminMail = db.prepare("SELECT value FROM settings WHERE key='mail_to_admin'").get()?.value;
  if (adminMail) {
    const catalogName = db.prepare("SELECT value FROM settings WHERE key='catalog_name'").get()?.value || 'TeknoKatalog';
    sendMail({
      to: adminMail,
      subject: `${catalogName} — Yeni Kayıt: ${name}`,
      html: `<h3>Yeni müşteri kaydı</h3><p><b>Ad:</b> ${name}<br><b>E-posta:</b> ${email}<br><b>Firma:</b> ${company||'—'}<br><b>Tür:</b> ${ctype}<br><b>Durum:</b> ${status}</p>`,
    });
  }

  if (requireApproval) {
    return res.json({ pending: true, message: 'Kaydınız alındı. Admin onayından sonra giriş yapabileceksiniz.' });
  }

  const user = db.prepare('SELECT id,name,email,phone,company,tax_no,role,customer_type,status,discount_pct FROM users WHERE id=?').get(result.lastInsertRowid);
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, customer_type: user.customer_type }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-posta ve şifre gerekli.' });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(email).toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
  if (user.status === 'pending')
    return res.status(403).json({ error: 'Hesabınız henüz onaylanmadı. Admin onayını bekleyin.' });
  if (user.status === 'rejected')
    return res.status(403).json({ error: 'Hesabınız reddedildi. Lütfen işletmeyle iletişime geçin.' });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, customer_type: user.customer_type }, JWT_SECRET, { expiresIn: '30d' });
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id,name,email,phone,company,tax_no,role,customer_type,status,discount_pct FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  res.json(user);
});

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-posta adresi gerekli.' });
  const user = db.prepare('SELECT id, email, name FROM users WHERE email=?').get(String(email).toLowerCase());
  // Always return ok to prevent email enumeration
  if (!user) return res.json({ ok: true });
  db.prepare('DELETE FROM password_resets WHERE user_id=? OR expires_at < CURRENT_TIMESTAMP').run(user.id);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);
  const ms = getMailSettings();
  if (ms.mail_host && ms.mail_user && ms.mail_pass) {
    const catalogName = db.prepare("SELECT value FROM settings WHERE key='catalog_name'").get()?.value || 'TeknoKatalog';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    await sendMail({
      to: user.email,
      subject: `${catalogName} — Şifre Sıfırlama`,
      html: `<h3>${catalogName} — Şifre Sıfırlama</h3>
             <p>Merhaba ${user.name},</p>
             <p>Şifrenizi sıfırlamak için aşağıdaki bağlantıya tıklayın:</p>
             <p><a href="${baseUrl}/?reset=${token}" style="background:#4f46e5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">Şifremi Sıfırla →</a></p>
             <p style="font-size:12px;color:#666">Bu bağlantı 1 saat geçerlidir. Bu isteği siz yapmadıysanız dikkate almayın.</p>`,
    });
  }
  res.json({ ok: true });
});

app.get('/api/auth/verify-reset-token', (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ valid: false });
  const reset = db.prepare('SELECT id FROM password_resets WHERE token=? AND used=0 AND expires_at > CURRENT_TIMESTAMP').get(token);
  res.json({ valid: !!reset });
});

app.post('/api/auth/reset-password', authLimiter, (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token ve şifre gerekli.' });
  if (password.length < 8) return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı.' });
  const reset = db.prepare(
    'SELECT pr.*, u.email FROM password_resets pr JOIN users u ON u.id=pr.user_id WHERE pr.token=? AND pr.used=0 AND pr.expires_at > CURRENT_TIMESTAMP'
  ).get(token);
  if (!reset) return res.status(400).json({ error: 'Geçersiz veya süresi dolmuş bağlantı.' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, reset.user_id);
  db.prepare('UPDATE password_resets SET used=1 WHERE id=?').run(reset.id);
  res.json({ ok: true });
});

app.put('/api/auth/profile', authMiddleware, (req, res) => {
  const { name, phone, company, tax_no } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Ad Soyad zorunlu.' });
  db.prepare('UPDATE users SET name=?, phone=?, company=?, tax_no=? WHERE id=?')
    .run(String(name).trim(), phone || '', company || '', tax_no || '', req.user.id);
  res.json(db.prepare('SELECT id,name,email,phone,company,tax_no,role,customer_type,status,discount_pct FROM users WHERE id=?').get(req.user.id));
});

// ════════════════════════════════════════════════════════
// PRODUCTS
// ════════════════════════════════════════════════════════
function parseProduct(p) {
  return {
    ...p,
    specs: JSON.parse(p.specs || '[]'),
    images: JSON.parse(p.images || '[]'),
  };
}

app.get('/api/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE active=1 ORDER BY id DESC').all();
  res.json(products.map(parseProduct));
});

function buildProductFields(body) {
  const { name, category, description, price, price_retail, price_wholesale, cost_price, vat_rate,
          icon, image, images, specs, badge, sku, brand, barcode, pack_qty, min_qty, stock_qty } = body;
  return {
    sku: sku || '',
    barcode: barcode || '',
    brand: brand || '',
    name: String(name).trim(),
    category: category || 'Genel',
    description: description || '',
    price: Number(price),
    price_retail: Number(price_retail) || 0,
    price_wholesale: Number(price_wholesale) || 0,
    cost_price: Number(cost_price) || 0,
    vat_rate: Number(vat_rate) || 0,
    icon: icon || '📦',
    image: image || '',
    images: JSON.stringify(Array.isArray(images) ? images : []),
    specs: JSON.stringify(specs || []),
    badge: badge || '',
    pack_qty: Math.max(1, parseInt(pack_qty) || 1),
    min_qty: Math.max(1, parseInt(min_qty) || 1),
    stock_qty: (stock_qty !== undefined && stock_qty !== null && stock_qty !== '') ? parseInt(stock_qty) : -1,
  };
}

app.post('/api/products', adminMiddleware, (req, res) => {
  const err = validateProduct(req.body);
  if (err) return res.status(400).json({ error: err });
  const f = buildProductFields(req.body);
  const result = db.prepare(
    `INSERT INTO products (sku,barcode,brand,name,category,description,price,price_retail,price_wholesale,
      cost_price,vat_rate,icon,image,images,specs,badge,pack_qty,min_qty,stock_qty)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    f.sku, f.barcode, f.brand, f.name, f.category, f.description,
    f.price, f.price_retail, f.price_wholesale, f.cost_price, f.vat_rate,
    f.icon, f.image, f.images, f.specs, f.badge, f.pack_qty, f.min_qty, f.stock_qty
  );
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(result.lastInsertRowid);
  res.json(parseProduct(p));
});

app.put('/api/products/:id', adminMiddleware, (req, res) => {
  const err = validateProduct(req.body);
  if (err) return res.status(400).json({ error: err });
  const f = buildProductFields(req.body);
  db.prepare(
    `UPDATE products SET sku=?,barcode=?,brand=?,name=?,category=?,description=?,
      price=?,price_retail=?,price_wholesale=?,cost_price=?,vat_rate=?,
      icon=?,image=?,images=?,specs=?,badge=?,pack_qty=?,min_qty=?,stock_qty=?
     WHERE id=?`
  ).run(
    f.sku, f.barcode, f.brand, f.name, f.category, f.description,
    f.price, f.price_retail, f.price_wholesale, f.cost_price, f.vat_rate,
    f.icon, f.image, f.images, f.specs, f.badge, f.pack_qty, f.min_qty, f.stock_qty,
    req.params.id
  );
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  res.json(parseProduct(p));
});

app.delete('/api/products/:id', adminMiddleware, (req, res) => {
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(req.params.id);
  logAudit(req.user.id, 'product_delete', 'product', req.params.id, {});
  res.json({ success: true });
});

app.patch('/api/products/:id/toggle', adminMiddleware, (req, res) => {
  const p = db.prepare('SELECT id, active, name FROM products WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Ürün bulunamadı.' });
  const newActive = p.active ? 0 : 1;
  db.prepare('UPDATE products SET active=? WHERE id=?').run(newActive, req.params.id);
  logAudit(req.user.id, newActive ? 'product_activate' : 'product_deactivate', 'product', req.params.id, { name: p.name });
  res.json({ id: p.id, active: newActive });
});

app.post('/api/products/bulk-action', adminMiddleware, (req, res) => {
  const { ids, action, category } = req.body;
  if (!ids || !Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Ürün seçilmedi.' });
  let affected = 0;
  const doAction = db.transaction(() => {
    for (const id of ids) {
      if (action === 'activate')   { db.prepare('UPDATE products SET active=1 WHERE id=?').run(id); affected++; }
      else if (action === 'deactivate') { db.prepare('UPDATE products SET active=0 WHERE id=?').run(id); affected++; }
      else if (action === 'category' && category) { db.prepare('UPDATE products SET category=? WHERE id=?').run(category, id); affected++; }
    }
  });
  doAction();
  logAudit(req.user.id, `bulk_${action}`, 'product', null, { ids, category, affected });
  res.json({ affected });
});

app.post('/api/products/upload-image', adminMiddleware, uploadProduct.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yüklenemedi.' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// ════════════════════════════════════════════════════════
// LISTS
// ════════════════════════════════════════════════════════
// Returns role-specific price for a product given user
function getEffectivePrice(product, user) {
  if (!user) return product.price;
  if (user.role === 'admin') return product.price;
  let rolePrice = product.price;
  if (user.customer_type === 'wholesale' && product.price_wholesale > 0)
    rolePrice = product.price_wholesale;
  else if (user.customer_type === 'retail' && product.price_retail > 0)
    rolePrice = product.price_retail;
  const discount = parseFloat(user.discount_pct) || 0;
  if (discount > 0) rolePrice = rolePrice * (1 - discount / 100);
  return Math.round(rolePrice * 100) / 100;
}

app.get('/api/lists/my', authMiddleware, (req, res) => {
  const lists = db.prepare('SELECT * FROM lists WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json(lists.map(l => ({ ...l, items: JSON.parse(l.items) })));
});

app.get('/api/lists', adminMiddleware, (req, res) => {
  const lists = db.prepare(`
    SELECT l.*, u.name as user_name, u.phone as user_phone, u.email as user_email,
           u.company as user_company, u.customer_type as user_customer_type
    FROM lists l JOIN users u ON l.user_id=u.id
    ORDER BY CASE WHEN l.status='pending' THEN 0 ELSE 1 END, l.created_at DESC
  `).all();
  res.json(lists.map(l => ({ ...l, items: JSON.parse(l.items) })));
});

app.post('/api/lists', authMiddleware, (req, res) => {
  const { items, note } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'Liste boş olamaz.' });

  const userRecord = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);

  let total = 0;
  const verifiedItems = items.map(item => {
    const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(item.id);
    const qty = Math.max(1, parseInt(item.qty) || 1);
    if (product) {
      const effPrice = getEffectivePrice(product, userRecord);
      total += effPrice * qty;
      return { ...item, price: effPrice, cost_price: product.cost_price || 0, qty };
    }
    total += (Number(item.price) || 0) * qty;
    return { ...item, qty };
  });

  const list_code = 'LST-' + Date.now();
  const result = db.prepare('INSERT INTO lists (list_code,user_id,items,total,note) VALUES (?,?,?,?,?)')
    .run(list_code, req.user.id, JSON.stringify(verifiedItems), total, note || '');
  const list = db.prepare('SELECT * FROM lists WHERE id=?').get(result.lastInsertRowid);

  // E-posta bildirimleri
  const ms = getMailSettings();
  const catalogName = db.prepare("SELECT value FROM settings WHERE key='catalog_name'").get()?.value || 'TeknoKatalog';
  if (ms.mail_to_admin) {
    sendMail({
      to: ms.mail_to_admin,
      subject: `${catalogName} — Yeni Liste: ${list_code}`,
      html: `<h3>Yeni sipariş listesi gönderildi</h3>
             <p><b>Müşteri:</b> ${userRecord.name} (${userRecord.email})<br>
             <b>Firma:</b> ${userRecord.company || '—'}<br>
             <b>Liste No:</b> ${list_code}<br>
             <b>Tutar:</b> ₺${total.toLocaleString('tr-TR')}<br>
             <b>Ürün Sayısı:</b> ${verifiedItems.length}</p>`,
    });
  }

  res.json({ ...list, items: JSON.parse(list.items) });
});

app.put('/api/lists/:id', authMiddleware, (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id=?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'Liste bulunamadı.' });
  if (list.user_id !== req.user.id) return res.status(403).json({ error: 'Bu liste size ait değil.' });
  if (list.status !== 'pending') return res.status(400).json({ error: 'Onaylanmış listeler düzenlenemez.' });

  const { items, note } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'Liste boş olamaz.' });

  const userRecord = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);

  let total = 0;
  const verifiedItems = items.map(item => {
    const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(item.id);
    const qty = Math.max(1, parseInt(item.qty) || 1);
    if (product) {
      const effPrice = getEffectivePrice(product, userRecord);
      total += effPrice * qty;
      return { ...item, price: effPrice, cost_price: product.cost_price || 0, qty };
    }
    total += (Number(item.price) || 0) * qty;
    return { ...item, qty };
  });

  db.prepare('UPDATE lists SET items=?,total=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(JSON.stringify(verifiedItems), total, note || '', req.params.id);
  const updated = db.prepare('SELECT * FROM lists WHERE id=?').get(req.params.id);
  res.json({ ...updated, items: JSON.parse(updated.items) });
});

app.put('/api/lists/:id/approve', adminMiddleware, (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id=?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'Liste bulunamadı.' });

  const { admin_note, delivery_date } = req.body;
  db.prepare('UPDATE lists SET status=?,admin_note=?,delivery_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run('approved', admin_note || '', delivery_date || '', req.params.id);

  // E-posta bildirimi müşteriye
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(list.user_id);
  const catalogName = db.prepare("SELECT value FROM settings WHERE key='catalog_name'").get()?.value || 'TeknoKatalog';
  if (user && user.email) {
    sendMail({
      to: user.email,
      subject: `${catalogName} — Listeniz Onaylandı: ${list.list_code}`,
      html: `<h3>Listeniz onaylandı! ✅</h3>
             <p><b>Liste No:</b> ${list.list_code}<br>
             <b>Tutar:</b> ₺${Number(list.total).toLocaleString('tr-TR')}<br>
             ${delivery_date ? `<b>Tahmini Teslimat:</b> ${delivery_date}<br>` : ''}
             ${admin_note ? `<b>Not:</b> ${admin_note}` : ''}</p>`,
    });
  }

  const updated = db.prepare('SELECT * FROM lists WHERE id=?').get(req.params.id);
  res.json({ ...updated, items: JSON.parse(updated.items) });
});

app.put('/api/lists/:id/reject', adminMiddleware, (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id=?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'Liste bulunamadı.' });

  db.prepare('UPDATE lists SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run('rejected', req.body.admin_note || '', req.params.id);

  // E-posta bildirimi müşteriye
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(list.user_id);
  const catalogName = db.prepare("SELECT value FROM settings WHERE key='catalog_name'").get()?.value || 'TeknoKatalog';
  if (user && user.email) {
    sendMail({
      to: user.email,
      subject: `${catalogName} — Liste Güncellendi: ${list.list_code}`,
      html: `<h3>Listeniz reddedildi ❌</h3>
             <p><b>Liste No:</b> ${list.list_code}<br>
             ${req.body.admin_note ? `<b>Neden:</b> ${req.body.admin_note}` : ''}</p>`,
    });
  }

  const updated = db.prepare('SELECT * FROM lists WHERE id=?').get(req.params.id);
  res.json({ ...updated, items: JSON.parse(updated.items) });
});

// ════════════════════════════════════════════════════════
// USERS (Admin)
// ════════════════════════════════════════════════════════
app.get('/api/users', adminMiddleware, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.company, u.tax_no, u.role,
           u.customer_type, u.status, u.discount_pct, u.created_at,
           COUNT(l.id) as list_count
    FROM users u
    LEFT JOIN lists l ON l.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
  res.json(users);
});

app.post('/api/users', adminMiddleware, (req, res) => {
  const { name, email, password, phone, company, tax_no, customer_type, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Ad, e-posta ve şifre zorunlu.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin.' });
  if (password.length < 8) return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı.' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase())) return res.status(400).json({ error: 'Bu e-posta zaten kayıtlı.' });
  const hash = bcrypt.hashSync(password, 10);
  const ctype = ['retail','wholesale'].includes(customer_type) ? customer_type : 'retail';
  const userRole = role === 'admin' ? 'admin' : 'user';
  const result = db.prepare('INSERT INTO users (name,email,password,phone,company,tax_no,customer_type,role,status) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(String(name).trim(), email.toLowerCase(), hash, phone||'', company||'', tax_no||'', ctype, userRole, 'active');
  logAudit(req.user.id, 'user_create', 'user', result.lastInsertRowid, { name, email, ctype, role: userRole });
  res.json(db.prepare('SELECT id,name,email,phone,company,tax_no,role,customer_type,status,discount_pct,created_at FROM users WHERE id=?').get(result.lastInsertRowid));
});

app.put('/api/users/:id', adminMiddleware, (req, res) => {
  const { customer_type, status, discount_pct, role } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

  const updates = {};
  if (customer_type && ['retail','wholesale'].includes(customer_type)) updates.customer_type = customer_type;
  if (status && ['active','pending','rejected'].includes(status)) updates.status = status;
  if (discount_pct !== undefined) updates.discount_pct = Math.min(100, Math.max(0, parseFloat(discount_pct) || 0));
  if (role && ['user','admin'].includes(role)) updates.role = role;

  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Güncellenecek alan yok.' });

  const sets = Object.keys(updates).map(k => `${k}=?`).join(', ');
  db.prepare(`UPDATE users SET ${sets} WHERE id=?`).run(...Object.values(updates), req.params.id);

  // If user is being approved, send email
  if (updates.status === 'active') {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    const catalogName = db.prepare("SELECT value FROM settings WHERE key='catalog_name'").get()?.value || 'TeknoKatalog';
    if (u && u.email) {
      sendMail({
        to: u.email,
        subject: `${catalogName} — Hesabınız Onaylandı`,
        html: `<h3>Hesabınız onaylandı! ✅</h3><p>Artık ${catalogName} sistemine giriş yapabilirsiniz.</p>`,
      });
    }
  }

  res.json(db.prepare('SELECT id,name,email,phone,company,tax_no,role,customer_type,status,discount_pct,created_at FROM users WHERE id=?').get(req.params.id));
});

// ════════════════════════════════════════════════════════
// ANNOUNCEMENTS
// ════════════════════════════════════════════════════════
app.get('/api/announcements', (req, res) => {
  const now = new Date().toISOString();
  const anns = db.prepare(`
    SELECT * FROM announcements
    WHERE active=1
      AND (starts_at IS NULL OR starts_at <= ?)
      AND (ends_at IS NULL OR ends_at >= ?)
    ORDER BY sort_order ASC, id DESC
  `).all(now, now);
  res.json(anns);
});

app.get('/api/announcements/all', adminMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM announcements ORDER BY sort_order ASC, id DESC').all());
});

app.post('/api/announcements', adminMiddleware, (req, res) => {
  const { title, body, url, type, active, sort_order, starts_at, ends_at } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Başlık zorunlu.' });
  const result = db.prepare(
    'INSERT INTO announcements (title, body, url, type, active, sort_order, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    String(title).trim(), body || '', url || '',
    ['info','warning','success','danger'].includes(type) ? type : 'info',
    active ? 1 : 0,
    parseInt(sort_order) || 0,
    starts_at || null,
    ends_at || null
  );
  res.json(db.prepare('SELECT * FROM announcements WHERE id=?').get(result.lastInsertRowid));
});

app.put('/api/announcements/:id', adminMiddleware, (req, res) => {
  const { title, body, url, type, active, sort_order, starts_at, ends_at } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Başlık zorunlu.' });
  db.prepare(
    'UPDATE announcements SET title=?, body=?, url=?, type=?, active=?, sort_order=?, starts_at=?, ends_at=? WHERE id=?'
  ).run(
    String(title).trim(), body || '', url || '',
    ['info','warning','success','danger'].includes(type) ? type : 'info',
    active ? 1 : 0,
    parseInt(sort_order) || 0,
    starts_at || null,
    ends_at || null,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id));
});

app.delete('/api/announcements/:id', adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Test mail endpoint
app.post('/api/settings/test-mail', adminMiddleware, async (req, res) => {
  const ms = getMailSettings();
  if (!ms.mail_host || !ms.mail_user || !ms.mail_pass) {
    return res.status(400).json({ error: 'E-posta ayarları eksik.' });
  }
  const to = ms.mail_to_admin || ms.mail_user;
  const catalogName = db.prepare("SELECT value FROM settings WHERE key='catalog_name'").get()?.value || 'TeknoKatalog';
  try {
    await sendMail({
      to,
      subject: `${catalogName} — Test E-postası`,
      html: `<h3>${catalogName} e-posta sistemi çalışıyor ✅</h3><p>Bu bir test e-postasıdır.</p>`,
    });
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Bulk import ───────────────────────────────────────
app.post('/api/products/bulk-import', adminMiddleware, (req, res) => {
  const { products } = req.body;
  if (!products || !Array.isArray(products)) return res.status(400).json({ error: 'Geçersiz veri.' });

  const stmt = db.prepare(
    `INSERT INTO products (sku,barcode,brand,name,category,description,price,price_retail,price_wholesale,
      cost_price,vat_rate,icon,image,images,specs,badge,pack_qty,min_qty,stock_qty)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  let ok = 0, fail = 0;
  const insertMany = db.transaction((rows) => {
    for (const p of rows) {
      try {
        if (!p.name || !p.price || parseFloat(p.price) <= 0) { fail++; continue; }
        stmt.run(
          p.sku || '', p.barcode || '', p.brand || '', String(p.name).trim(), p.category || 'Genel',
          p.description || '', parseFloat(p.price), parseFloat(p.price_retail) || 0,
          parseFloat(p.price_wholesale) || 0, parseFloat(p.cost_price) || 0,
          parseFloat(p.vat_rate) || 0,
          p.icon || '📦', '', '[]',
          JSON.stringify([]), p.badge || '',
          Math.max(1, parseInt(p.pack_qty) || 1),
          Math.max(1, parseInt(p.min_qty) || 1),
          parseInt(p.stock_qty) || -1
        );
        ok++;
      } catch { fail++; }
    }
  });
  insertMany(products);
  res.json({ ok, fail });
});

// ── Audit log endpoint ─────────────────────────────────
app.get('/api/admin/audit-log', adminMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const logs = db.prepare(`
    SELECT al.*, u.name as admin_name
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.admin_id
    ORDER BY al.created_at DESC
    LIMIT ?
  `).all(limit);
  res.json(logs);
});

// ── SPA fallback ───────────────────────────────────────
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 TeknoKatalog çalışıyor: http://localhost:${PORT}`);
  if (!process.env.JWT_SECRET) {
    console.warn('⚠️  GÜVENLİK: JWT_SECRET tanımlı değil! .env dosyasına güçlü bir değer ekleyin.');
  }
});
