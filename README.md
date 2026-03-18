# TeknoKatalog — VPS Kurulum Kılavuzu

## Gereksinimler
- Ubuntu 20.04+ VPS
- Domain (örn: katalog.sirketiniz.com)
- Node.js 18+, Nginx, PM2

---

## 1. Sunucuya Bağlan

```bash
ssh root@SUNUCU_IP
```

---

## 2. Node.js Kur (henüz kurulu değilse)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v20.x görünmeli
```

---

## 3. PM2 Kur

```bash
npm install -g pm2
```

---

## 4. Nginx Kur (henüz kurulu değilse)

```bash
sudo apt install -y nginx
```

---

## 5. Projeyi Sunucuya Yükle

**Seçenek A — Dosyaları kopyala (scp):**
```bash
# Kendi bilgisayarından çalıştır:
scp -r teknokatalog/ root@SUNUCU_IP:/var/www/teknokatalog
```

**Seçenek B — Git ile:**
```bash
cd /var/www
git clone https://github.com/KULLANICI/teknokatalog.git
cd teknokatalog
```

---

## 6. Bağımlılıkları Yükle

```bash
cd /var/www/teknokatalog
npm install --production
```

---

## 7. .env Dosyasını Oluştur

```bash
cp .env.example .env
nano .env
```

`.env` içeriği:
```
PORT=3000
JWT_SECRET=buraya-cok-guclu-rastgele-bir-sifre-yaz
ADMIN_EMAIL=admin@sirketiniz.com
ADMIN_PASSWORD=guclu-admin-sifresi
ADMIN_NAME=Admin
```

> ⚠️ JWT_SECRET için en az 32 karakter kullanın.
> Şu komutla güvenli bir değer üretebilirsiniz:
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 8. db/ Klasörünü Oluştur

```bash
mkdir -p /var/www/teknokatalog/db
```

---

## 9. PM2 ile Başlat

```bash
cd /var/www/teknokatalog
pm2 start server.js --name teknokatalog
pm2 save
pm2 startup   # Sunucu yeniden başlayınca otomatik başlasın
```

Durumu kontrol et:
```bash
pm2 status
pm2 logs teknokatalog
```

---

## 10. Nginx Yapılandırması

```bash
nano /etc/nginx/sites-available/teknokatalog
```

Aşağıdaki içeriği yapıştır (domain adını değiştir):

```nginx
server {
    listen 80;
    server_name katalog.sirketiniz.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Etkinleştir:
```bash
ln -s /etc/nginx/sites-available/teknokatalog /etc/nginx/sites-enabled/
nginx -t   # Konfigürasyon testi
systemctl reload nginx
```

---

## 11. SSL Sertifikası (Let's Encrypt — Ücretsiz HTTPS)

```bash
sudo apt install -y certbot python3-certbot-nginx
certbot --nginx -d katalog.sirketiniz.com
```

Sertifika otomatik yenilenir. Test:
```bash
certbot renew --dry-run
```

---

## 12. DNS Ayarı

Domain sağlayıcında:
```
A kaydı:  katalog  →  SUNUCU_IP
```
DNS yayılması 1-24 saat sürebilir.

---

## Sonuç

Site adresi: `https://katalog.sirketiniz.com`

**Admin girişi:**
- E-posta: `.env`'deki `ADMIN_EMAIL`
- Şifre: `.env`'deki `ADMIN_PASSWORD`

---

## Güncelleme (sonraki sürümler)

```bash
cd /var/www/teknokatalog
git pull           # veya scp ile yeni dosyaları kopyala
npm install --production
pm2 restart teknokatalog
```

---

## Faydalı PM2 Komutları

```bash
pm2 status                  # Durum
pm2 logs teknokatalog       # Canlı loglar
pm2 restart teknokatalog    # Yeniden başlat
pm2 stop teknokatalog       # Durdur
```

---

## Sorun Giderme

**Port 3000 çalışmıyor:**
```bash
pm2 logs teknokatalog --lines 50
```

**Nginx 502 hatası:**
```bash
systemctl status nginx
pm2 status
```

**Veritabanı izin hatası:**
```bash
chmod 755 /var/www/teknokatalog/db
```
