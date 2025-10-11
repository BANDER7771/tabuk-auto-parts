const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { v2: cloudinary } = require('cloudinary');

// تحميل المتغيرات البيئية
dotenv.config();

const app = express();

// Cloudinary configuration for branding
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  console.log('✅ Cloudinary configured for brand uploads');
} else {
  console.warn('⚠️ Cloudinary not configured - brand uploads will be stored locally');
}

// ===== Brand upload (minimal, no new files) =====
let multer;
try { multer = require('multer'); } catch (_) {
  console.log('Multer not installed, brand upload disabled');
}

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) { 
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {} 
}

function findBrandLogoPath() {
  const exts = ['png','jpg','jpeg','svg','webp'];
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    const hit = files.find(f => /^brand-logo\.(png|jpg|jpeg|svg|webp)$/i.test(f));
    return hit ? path.join(UPLOAD_DIR, hit) : null;
  } catch { return null; }
}

// ===== Email (SMTP via SendGrid) - minimal =====
const nodemailer = require('nodemailer');
let mailer = null;
try {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const secure = String(process.env.SMTP_SECURE || 'false') === 'true';
    const port = parseInt(process.env.SMTP_PORT || (secure ? 465 : 587), 10);
    mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port, secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool: true, maxConnections: 3, maxMessages: 50
    });
    console.log('✅ Email (SMTP) enabled');
  } else {
    console.warn('⚠️ Email disabled: missing SMTP env');
  }
} catch (e) {
  console.error('❌ Email transport error:', e?.message);
}

async function sendEmail(to, subject, text, html) {
  if (!mailer) return { ok: false, reason: 'mail_disabled' };
  try {
    const from = process.env.MAIL_FROM || 'no-reply@tshleh-tabuk.com';
    const headers = {};
    if (process.env.REPLY_TO) headers['Reply-To'] = process.env.REPLY_TO;
    const info = await mailer.sendMail({ from, to, subject, text, html, headers });
    return { ok: true, id: info.messageId };
  } catch (e) {
    console.error('email send failed:', e?.message);
    return { ok: false, reason: 'mailer_error', error: e?.message };
  }
}
app.locals.sendEmail = sendEmail;

// ===== WhatsApp (Twilio) bootstrap - minimal =====
const twilio = require('twilio');

const TW_SID   = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TW_FROM  = process.env.TWILIO_FROM_WHATSAPP; // يجب أن تبدأ بـ whatsapp:+

const waEnabled = Boolean(
  TW_SID && TW_TOKEN && /^whatsapp:\+\d{8,15}$/.test(String(TW_FROM || ''))
);

const waClient = waEnabled ? twilio(TW_SID, TW_TOKEN) : null;

function normalizeMsisdn(input) {
  let d = String(input || '').replace(/\D/g, '');
  // أزل 00 الدولية إن وجدت
  if (d.startsWith('00')) d = d.slice(2);
  // صيغة السعودية المحلية 05XXXXXXXX -> 9665XXXXXXXX
  if (d.startsWith('0') && d.length === 10) d = '966' + d.slice(1);
  // لو صار 9660 بالغلط (بعض الإدخالات) صححه
  if (d.startsWith('9660')) d = '966' + d.slice(4);
  return d;
}

async function sendWhatsApp(toE164, body, opts = {}) {
  if (!waClient) return { ok: false, reason: 'wa_disabled' };
  const msisdn = normalizeMsisdn(toE164);
  if (!msisdn) return { ok: false, reason: 'invalid_msisdn' };

  const to = `whatsapp:+${msisdn}`;
  try {
    const payload = opts.contentSid
      ? { from: TW_FROM, to, contentSid: opts.contentSid, contentVariables: JSON.stringify(opts.vars || {}) }
      : { from: TW_FROM, to, body };
    
    // أضف statusCallback لتتبّع الحالة النهائية
    if (process.env.APP_PUBLIC_URL) {
      payload.statusCallback = `${process.env.APP_PUBLIC_URL}/webhooks/wa-status`;
    }
    
    const msg = await waClient.messages.create(payload);
    return { ok: true, sid: msg.sid };
  } catch (e) {
    console.error('WA send failed:', e?.message);
    return { ok: false, reason: 'twilio_error', error: e?.message };
  }
}

// إتاحة الدالة للراوترات
app.locals.sendWhatsApp = sendWhatsApp;

// نقطة فحص للتطوير فقط
if (process.env.NODE_ENV !== 'production') {
  app.get('/dev/wa-ping', async (req, res) => {
    const to = req.query.to || '';
    const r = await sendWhatsApp(to, 'Test: WhatsApp is working ✅');
    res.json({ enabled: waEnabled, ...r });
  });
}

// ============================================
// 1. Health Check - أول شيء (قبل أي middleware)
// ============================================
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'production',
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        port: process.env.PORT || 3000,
        whatsapp: /^whatsapp:\+/.test(String(process.env.TWILIO_FROM_WHATSAPP || '')) ? 'enabled' : 'disabled',
        email: !!mailer ? 'enabled' : 'disabled'
    });
});

app.get('/api/test-cors', (req, res) => {
    res.json({
        status: 'OK',
        message: 'CORS is working!',
        timestamp: new Date().toISOString()
    });
});

// dev-only: اختبار سريع للإرسال (لن يعمل في production)
if (process.env.NODE_ENV !== 'production') {
  app.get('/dev/email-ping', async (req, res) => {
    const to = req.query.to || process.env.NOTIFY_EMAIL;
    const sub = req.query.sub || 'Ping from server';
    const msg = req.query.msg || 'Email path is working ✅';
    const r = await (app.locals.sendEmail?.(to, sub, msg, `<p>${msg}</p>`));
    res.json(r || { ok:false });
  });
}

console.log('✅ Health endpoints registered');

// ============================================
// 2. Trust Proxy - مرة واحدة فقط
// ============================================
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
    console.log('✅ Trust proxy enabled');
} else {
    app.set('trust proxy', false);
}

// ============================================
// 3. Security & Compression
// ============================================
try {
    const rateLimit = require('express-rate-limit');
    const compression = require('compression');
    const helmet = require('helmet');

    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(compression());
    
    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100,
        skip: (req) => req.path === '/health' || req.path === '/api/test-cors'
    });
    
    app.use('/api/', limiter);
    console.log('✅ Security middleware loaded');
} catch (err) {
    console.warn('⚠️ Some security packages not available:', err.message);
}

// ============================================
// 4. CORS
// ============================================
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || 
            origin.includes('.railway.app') || 
            origin.includes('.onrender.com') ||
            origin.includes('localhost')) {
            callback(null, true);
        } else {
            callback(null, true); // في الإنتاج، نسمح بكل شيء مؤقتاً
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
console.log('✅ CORS configured');

// ============================================
// 5. Body Parsers
// ============================================
app.use('/webhooks/twilio', express.raw({ type: '*/*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
console.log('✅ Body parsers configured');

// ============================================
// 6. Static Files
// ============================================
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✅ Uploads directory created');
}

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));
console.log('✅ Static files configured');

// ============================================
// 7. Database Connection (Non-blocking)
// ============================================
const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL;

if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 10000
    })
    .then(() => {
        console.log('✅ MongoDB connected');
    })
    .catch(err => {
        console.error('❌ MongoDB connection failed:', err.message);
        console.warn('⚠️ Server will continue without database');
    });
} else {
    console.warn('⚠️ No MONGODB_URI found - running without database');
}

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
    console.log('✅ MongoDB reconnected');
});

// ============================================
// 8. Webhooks (before other routes)
// ============================================
app.post('/webhooks/twilio/whatsapp', (req, res) => {
    console.log('📥 Twilio webhook received');
    res.sendStatus(200);
});

app.post('/webhooks/twilio/whatsapp-fallback', (req, res) => {
    res.sendStatus(200);
});

app.post('/webhooks/twilio/status', (req, res) => {
    res.sendStatus(200);
});

// ويبهوك حالة رسائل واتساب (Twilio يرسل x-www-form-urlencoded)
app.post('/webhooks/wa-status', express.urlencoded({ extended: false }), (req, res) => {
    try {
        const { MessageSid, MessageStatus, ErrorCode, To, From } = req.body || {};
        console.log('WA STATUS:', { MessageSid, MessageStatus, ErrorCode, To, From });
    } catch (_) {}
    res.sendStatus(204);
});

console.log('✅ Webhooks registered');

// ============================================
// 9. API Routes (with error handling)
// ============================================
try {
    app.use('/api/auth', require('./routes/auth'));
    console.log('✅ Auth routes loaded');
} catch (err) {
    console.error('❌ Auth routes failed:', err.message);
}

try {
    app.use('/api/parts', require('./routes/parts'));
    console.log('✅ Parts routes loaded');
} catch (err) {
    console.error('❌ Parts routes failed:', err.message);
}

try {
    app.use('/api/orders', require('./routes/orders'));
    console.log('✅ Orders routes loaded');
} catch (err) {
    console.error('❌ Orders routes failed:', err.message);
}

try {
    app.use('/api/shops', require('./routes/shops'));
    console.log('✅ Shops routes loaded');
} catch (err) {
    console.error('❌ Shops routes failed:', err.message);
}

try {
    app.use('/api/users', require('./routes/users'));
    console.log('✅ Users routes loaded');
} catch (err) {
    console.error('❌ Users routes failed:', err.message);
}

try {
    app.use('/api/admin', require('./routes/admin'));
    console.log('✅ Admin routes loaded');
} catch (err) {
    console.error('❌ Admin routes failed:', err.message);
}

// ============================================
// 10. HTML Pages & Brand Logo Routes
// ============================================

// خدمة الشعار بدون امتداد - مع دعم Cloudinary
app.get('/brand-logo', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  
  try {
    // Try to get from database (Cloudinary URL)
    const col = mongoose.connection.collection('settings');
    const doc = await col.findOne({ _id: 'branding' });
    
    if (doc?.logoUrl) {
      // Redirect to Cloudinary URL with version parameter
      const v = doc.version || Date.now();
      return res.redirect(302, doc.logoUrl + '?v=' + v);
    }
  } catch (err) {
    console.warn('Error fetching brand from DB:', err.message);
  }
  
  // Fallback to local file
  const p = findBrandLogoPath();
  if (p) return res.sendFile(p);
  res.sendStatus(404);
});

// صفحة رفع سريعة (admin)
app.get('/admin/brand', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>رفع شعار المنصة</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 560px; margin: 24px auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h2 { color: #333; margin-bottom: 20px; }
    form { display: grid; gap: 16px; }
    input[type="file"] { padding: 12px; border: 2px dashed #ddd; border-radius: 8px; }
    button { padding: 12px 20px; border-radius: 8px; border: none; background: #667eea; color: white; font-size: 16px; cursor: pointer; transition: background 0.3s; }
    button:hover { background: #5a67d8; }
    .info { color: #666; font-size: 14px; margin-top: 10px; line-height: 1.5; }
    .current-logo { margin: 20px 0; text-align: center; }
    .current-logo img { max-width: 200px; max-height: 200px; border: 1px solid #eee; border-radius: 8px; padding: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>رفع شعار المنصة</h2>
    <div class="current-logo" id="currentLogo"></div>
    <form action="/admin/brand/upload" method="post" enctype="multipart/form-data">
      <input type="file" name="brand" accept=".png,.jpg,.jpeg,.svg,.webp,image/*" required />
      <button type="submit">رفع الشعار</button>
    </form>
    <p class="info">
      • الحد الأقصى 2MB<br>
      • الصيغ المدعومة: PNG, JPG, JPEG, SVG, WEBP<br>
      • سيتم استبدال الشعار الحالي إن وجد
    </p>
  </div>
  <script>
    // Check if logo exists
    fetch('/brand-logo')
      .then(res => {
        if (res.ok) {
          document.getElementById('currentLogo').innerHTML = '<p style="color:#666;margin-bottom:10px;">الشعار الحالي:</p><img src="/brand-logo?' + Date.now() + '" alt="الشعار الحالي">';
        } else {
          document.getElementById('currentLogo').innerHTML = '<p style="color:#999;">لا يوجد شعار حالياً</p>';
        }
      })
      .catch(() => {
        document.getElementById('currentLogo').innerHTML = '<p style="color:#999;">لا يوجد شعار حالياً</p>';
      });
  </script>
</body>
</html>`);
});

// معالج رفع الشعار
if (multer) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!/\.(png|jpg|jpeg|svg|webp)$/i.test(ext)) {
        return cb(new Error('Invalid file type'));
      }
      // حذف أي شعار سابق
      const oldLogo = findBrandLogoPath();
      if (oldLogo) {
        try { fs.unlinkSync(oldLogo); } catch (_) {}
      }
      cb(null, 'brand-logo' + ext);
    }
  });

  const upload = multer({ 
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (/\.(png|jpg|jpeg|svg|webp)$/i.test(ext)) {
        cb(null, true);
      } else {
        cb(new Error('يُسمح فقط بملفات الصور (PNG, JPG, JPEG, SVG, WEBP)'));
      }
    }
  });

  app.post('/admin/brand/upload', upload.single('brand'), async (req, res) => {
    if (!req.file) {
      return res.status(400).send(`
        <html dir="rtl">
        <body style="font-family: system-ui; text-align: center; padding: 50px;">
          <h3 style="color: #d32f2f;">فشل الرفع</h3>
          <p>لم يتم رفع أي ملف</p>
          <a href="/admin/brand" style="color: #667eea;">العودة</a>
        </body>
        </html>
      `);
    }
    
    try {
      let logoUrl = null;
      let version = Date.now();
      
      // Try to upload to Cloudinary if configured
      if (process.env.CLOUDINARY_CLOUD_NAME) {
        try {
          const uploadResult = await cloudinary.uploader.upload(req.file.path, {
            folder: 'branding',
            public_id: 'brand-logo',
            overwrite: true,
            resource_type: 'image'
          });
          logoUrl = uploadResult.secure_url;
          
          // Store in database
          const col = mongoose.connection.collection('settings');
          await col.updateOne(
            { _id: 'branding' },
            { $set: { logoUrl: logoUrl, version: version } },
            { upsert: true }
          );
          
          console.log('✅ Brand logo uploaded to Cloudinary:', logoUrl);
          
          // Delete temporary file
          try { fs.unlinkSync(req.file.path); } catch (_) {}
        } catch (cloudinaryError) {
          console.error('❌ Cloudinary upload failed:', cloudinaryError.message);
          // Continue with local storage as fallback
        }
      }
      
      res.send(`
        <html dir="rtl">
        <body style="font-family: system-ui; text-align: center; padding: 50px;">
          <h3 style="color: #00c853;">تم رفع الشعار بنجاح!</h3>
          <img src="/brand-logo?v=${version}" style="max-width: 200px; margin: 20px 0; border: 1px solid #eee; border-radius: 8px; padding: 10px;">
          <br>
          <a href="/admin/brand" style="color: #667eea; margin-right: 20px;">رفع شعار آخر</a>
          <a href="/" style="color: #667eea;">الصفحة الرئيسية</a>
        </body>
        </html>
      `);
    } catch (error) {
      console.error('❌ Brand upload error:', error.message);
      res.status(500).send(`
        <html dir="rtl">
        <body style="font-family: system-ui; text-align: center; padding: 50px;">
          <h3 style="color: #d32f2f;">خطأ في رفع الشعار</h3>
          <p>${error.message}</p>
          <a href="/admin/brand" style="color: #667eea;">العودة</a>
        </body>
        </html>
      `);
    }
  });
} else {
  app.post('/admin/brand/upload', (req, res) => {
    res.status(503).send(`
      <html dir="rtl">
      <body style="font-family: system-ui; text-align: center; padding: 50px;">
        <h3 style="color: #ff6f00;">الخدمة غير متاحة</h3>
        <p>يجب تثبيت مكتبة multer لتفعيل رفع الصور</p>
        <code style="background: #f5f5f5; padding: 10px; display: block; margin: 20px;">npm install multer</code>
        <a href="/admin/brand" style="color: #667eea;">العودة</a>
      </body>
      </html>
    `);
  });
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/request', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'request.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

console.log('✅ HTML routes registered');

// ============================================
// 11. Error Handlers
// ============================================
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.message);
    res.status(err.status || 500).json({
        message: err.message || 'خطأ في الخادم',
        error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

app.use((req, res) => {
    res.status(404).json({ message: 'الصفحة غير موجودة' });
});

console.log('✅ Error handlers registered');

// ============================================
// 12. Start Server
// ============================================
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log(`🚀 السيرفر يعمل على البورت ${PORT}`);
    console.log(`🌐 البيئة: ${process.env.NODE_ENV || 'production'}`);
    console.log(`🔧 المنصة: ${process.env.RAILWAY_ENVIRONMENT ? 'Railway' : 'Local'}`);
    console.log(`📊 Database: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
    console.log('='.repeat(50));
});

// ============================================
// 13. Graceful Shutdown
// ============================================
process.on('SIGTERM', () => {
    console.log('📡 SIGTERM received - shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        mongoose.connection.close(false, () => {
            console.log('✅ MongoDB connection closed');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('📡 SIGINT received - shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        mongoose.connection.close(false, () => {
            console.log('✅ MongoDB connection closed');
            process.exit(0);
        });
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    // لا نوقف السيرفر في الإنتاج
    if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
    }
});

process.on('unhandledRejection', (err) => {
    console.error('💥 Unhandled Rejection:', err);
    // لا نوقف السيرفر في الإنتاج
    if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
    }
});

console.log('✅ Process handlers registered');
console.log('🎉 Server initialization complete!');