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
    
    // تخزين الرسالة الصادرة في messages collection
    try {
      const messagesCol = mongoose.connection.collection('messages');
      await messagesCol.insertOne({
        messageSid: msg.sid,
        to: msisdn,
        from: TW_FROM.replace('whatsapp:+', ''),
        direction: 'outbound',
        body: body || '[Template Message]',
        contentSid: opts.contentSid || null,
        status: 'queued',
        errorCode: null,
        timestamp: new Date(),
        orderNumber: opts.orderNumber || null
      });
    } catch (dbErr) {
      console.error('Failed to store outbound message:', dbErr?.message);
    }
    
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
app.post('/webhooks/wa-status', express.urlencoded({ extended: false }), async (req, res) => {
    try {
        const { MessageSid, MessageStatus, ErrorCode, To, From } = req.body || {};
        console.log('WA STATUS:', { MessageSid, MessageStatus, ErrorCode, To, From });
        
        // تحديث حالة الرسالة في قاعدة البيانات
        if (MessageSid && MessageStatus) {
            const messagesCol = mongoose.connection.collection('messages');
            await messagesCol.updateOne(
                { messageSid: MessageSid },
                { 
                    $set: { 
                        status: MessageStatus,
                        errorCode: ErrorCode || null,
                        updatedAt: new Date()
                    }
                }
            );
        }
    } catch (err) {
        console.error('Error updating message status:', err?.message);
    }
    res.sendStatus(204);
});

// ويبهوك استقبال رسائل واتساب الواردة
app.post('/webhooks/wa-incoming', express.urlencoded({ extended: false }), async (req, res) => {
    try {
        const { From, To, Body, MessageSid, ProfileName } = req.body || {};
        console.log('WA INCOMING:', { From, To, Body, MessageSid });
        
        if (From && Body) {
            const messagesCol = mongoose.connection.collection('messages');
            await messagesCol.insertOne({
                messageSid: MessageSid || null,
                from: From.replace('whatsapp:+', ''),
                to: To?.replace('whatsapp:+', ''),
                direction: 'inbound',
                body: Body,
                profileName: ProfileName || null,
                status: 'received',
                timestamp: new Date(),
                read: false
            });
        }
    } catch (err) {
        console.error('Error saving incoming message:', err?.message);
    }
    res.sendStatus(204);
});

console.log('✅ Webhooks registered');

// ============================================
// Middleware للحماية البسيطة
// ============================================
function simpleAuth(req, res, next) {
    if (!process.env.ADMIN_BASIC_TOKEN) {
        return next(); // لا حماية إن لم يوجد توكن
    }
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send(`
            <html dir="rtl">
            <body style="font-family: system-ui; text-align: center; padding: 50px;">
                <h3>غير مصرح</h3>
                <p>هذه الصفحة محمية. يرجى تسجيل الدخول.</p>
                <form onsubmit="login(event)">
                    <input type="password" id="token" placeholder="كلمة المرور" style="padding: 10px; margin: 10px;">
                    <button type="submit" style="padding: 10px 20px;">دخول</button>
                </form>
                <script>
                    function login(e) {
                        e.preventDefault();
                        const token = document.getElementById('token').value;
                        localStorage.setItem('adminToken', token);
                        window.location.reload();
                    }
                    // محاولة استخدام التوكن المحفوظ
                    const savedToken = localStorage.getItem('adminToken');
                    if (savedToken) {
                        fetch(window.location.href, {
                            headers: { 'Authorization': 'Bearer ' + savedToken }
                        }).then(r => {
                            if (r.ok) {
                                r.text().then(html => {
                                    document.open();
                                    document.write(html);
                                    document.close();
                                });
                            }
                        });
                    }
                </script>
            </body>
            </html>
        `);
    }
    
    const token = authHeader.slice(7);
    if (token !== process.env.ADMIN_BASIC_TOKEN) {
        return res.status(401).json({ message: 'Invalid token' });
    }
    next();
}

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
// 10. Inbox & Broadcast Routes
// ============================================

// API: جلب قائمة المحادثات
app.get('/api/inbox/threads', simpleAuth, async (req, res) => {
    try {
        const messagesCol = mongoose.connection.collection('messages');
        const threads = await messagesCol.aggregate([
            {
                $group: {
                    _id: {
                        $cond: [
                            { $eq: ['$direction', 'inbound'] },
                            '$from',
                            '$to'
                        ]
                    },
                    lastMessage: { $last: '$$ROOT' },
                    unreadCount: {
                        $sum: {
                            $cond: [
                                { $and: [
                                    { $eq: ['$direction', 'inbound'] },
                                    { $eq: ['$read', false] }
                                ]},
                                1,
                                0
                            ]
                        }
                    }
                }
            },
            {
                $project: {
                    phone: '$_id',
                    lastMessageAt: '$lastMessage.timestamp',
                    lastBody: '$lastMessage.body',
                    unreadCount: 1
                }
            },
            { $sort: { lastMessageAt: -1 } },
            { $limit: 100 }
        ]).toArray();
        
        res.json(threads);
    } catch (err) {
        console.error('Error fetching threads:', err);
        res.status(500).json({ error: 'Failed to fetch threads' });
    }
});

// API: جلب محادثة محددة
app.get('/api/inbox/thread', simpleAuth, async (req, res) => {
    try {
        const phone = req.query.phone;
        if (!phone) return res.status(400).json({ error: 'Phone required' });
        
        const messagesCol = mongoose.connection.collection('messages');
        
        // وضع علامة قراءة على الرسائل الواردة
        await messagesCol.updateMany(
            { from: phone, direction: 'inbound', read: false },
            { $set: { read: true } }
        );
        
        // جلب المحادثة
        const messages = await messagesCol.find({
            $or: [
                { from: phone },
                { to: phone }
            ]
        })
        .sort({ timestamp: 1 })
        .limit(200)
        .toArray();
        
        res.json(messages);
    } catch (err) {
        console.error('Error fetching thread:', err);
        res.status(500).json({ error: 'Failed to fetch thread' });
    }
});

// API: إرسال رسالة
app.post('/api/inbox/send', simpleAuth, async (req, res) => {
    try {
        const { to, body } = req.body;
        if (!to || !body) return res.status(400).json({ error: 'Missing to or body' });
        
        const result = await app.locals.sendWhatsApp(to, body);
        res.json(result);
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// صفحة صندوق الوارد
app.get('/admin/inbox', simpleAuth, (req, res) => {
    const token = process.env.ADMIN_BASIC_TOKEN || '';
    res.send(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>صندوق الوارد - WhatsApp</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #f0f2f5;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            background: #075E54;
            color: white;
            padding: 15px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .header h1 { font-size: 20px; }
        .container {
            flex: 1;
            display: flex;
            overflow: hidden;
            max-width: 1400px;
            width: 100%;
            margin: 0 auto;
            background: white;
        }
        .sidebar {
            width: 350px;
            border-right: 1px solid #e1e4e8;
            overflow-y: auto;
            background: white;
        }
        .thread-item {
            padding: 15px;
            border-bottom: 1px solid #f0f0f0;
            cursor: pointer;
            transition: background 0.2s;
        }
        .thread-item:hover { background: #f5f5f5; }
        .thread-item.active { background: #e8f5e9; }
        .thread-phone {
            font-weight: 600;
            color: #111;
            margin-bottom: 5px;
        }
        .thread-preview {
            color: #667781;
            font-size: 14px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .thread-time {
            font-size: 12px;
            color: #8696a0;
            float: left;
        }
        .unread-badge {
            background: #25D366;
            color: white;
            border-radius: 10px;
            padding: 2px 6px;
            font-size: 11px;
            float: left;
            margin-left: 10px;
        }
        .chat-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: #e5ddd5;
        }
        .chat-header {
            background: white;
            padding: 15px 20px;
            border-bottom: 1px solid #e1e4e8;
            font-weight: 600;
        }
        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
        }
        .message {
            max-width: 65%;
            margin-bottom: 12px;
            clear: both;
        }
        .message-bubble {
            padding: 8px 12px;
            border-radius: 7px;
            position: relative;
            word-wrap: break-word;
        }
        .message.sent {
            float: right;
        }
        .message.sent .message-bubble {
            background: #dcf8c6;
        }
        .message.received {
            float: left;
        }
        .message.received .message-bubble {
            background: white;
        }
        .message-time {
            font-size: 11px;
            color: #667781;
            margin-top: 4px;
        }
        .message-status {
            font-size: 10px;
            color: #999;
            margin-left: 5px;
        }
        .input-area {
            background: white;
            padding: 10px;
            display: flex;
            gap: 10px;
            border-top: 1px solid #e1e4e8;
        }
        .input-area textarea {
            flex: 1;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 20px;
            resize: none;
            font-family: inherit;
            outline: none;
        }
        .input-area button {
            padding: 10px 20px;
            background: #25D366;
            color: white;
            border: none;
            border-radius: 20px;
            cursor: pointer;
            font-weight: 600;
        }
        .input-area button:hover { background: #128C7E; }
        .empty-state {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #8696a0;
            font-size: 16px;
        }
        .loading {
            text-align: center;
            padding: 20px;
            color: #8696a0;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📱 صندوق وارد WhatsApp</h1>
        <div>
            <a href="/admin/broadcast" style="color: white; margin-left: 20px;">📢 البث الجماعي</a>
            <a href="/admin" style="color: white; margin-left: 20px;">🏠 الرئيسية</a>
        </div>
    </div>
    
    <div class="container">
        <div class="sidebar" id="sidebar">
            <div class="loading">جاري التحميل...</div>
        </div>
        
        <div class="chat-area" id="chatArea">
            <div class="empty-state">اختر محادثة للبدء</div>
        </div>
    </div>
    
    <script>
        const authToken = '${token}' || localStorage.getItem('adminToken');
        let currentPhone = null;
        let threads = [];
        
        async function fetchThreads() {
            try {
                const res = await fetch('/api/inbox/threads', {
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                if (!res.ok) throw new Error('Failed to fetch');
                threads = await res.json();
                renderThreads();
            } catch (err) {
                document.getElementById('sidebar').innerHTML = '<div class="loading">خطأ في التحميل</div>';
            }
        }
        
        function renderThreads() {
            const sidebar = document.getElementById('sidebar');
            if (!threads.length) {
                sidebar.innerHTML = '<div class="loading">لا توجد محادثات</div>';
                return;
            }
            
            sidebar.innerHTML = threads.map(thread => \`
                <div class="thread-item" onclick="selectThread('\${thread.phone}')">
                    <div class="thread-phone">+\${thread.phone}</div>
                    <div class="thread-preview">
                        \${thread.lastBody || '...'}
                        <span class="thread-time">\${formatTime(thread.lastMessageAt)}</span>
                        \${thread.unreadCount ? \`<span class="unread-badge">\${thread.unreadCount}</span>\` : ''}
                    </div>
                </div>
            \`).join('');
        }
        
        async function selectThread(phone) {
            currentPhone = phone;
            document.querySelectorAll('.thread-item').forEach(el => el.classList.remove('active'));
            event.currentTarget.classList.add('active');
            
            const chatArea = document.getElementById('chatArea');
            chatArea.innerHTML = \`
                <div class="chat-header">+\${phone}</div>
                <div class="messages-container" id="messages">
                    <div class="loading">جاري التحميل...</div>
                </div>
                <div class="input-area">
                    <textarea id="messageInput" placeholder="اكتب رسالة..." rows="1"></textarea>
                    <button onclick="sendMessage()">إرسال</button>
                </div>
            \`;
            
            try {
                const res = await fetch('/api/inbox/thread?phone=' + phone, {
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                if (!res.ok) throw new Error('Failed to fetch');
                const messages = await res.json();
                renderMessages(messages);
            } catch (err) {
                document.getElementById('messages').innerHTML = '<div class="loading">خطأ في التحميل</div>';
            }
        }
        
        function renderMessages(messages) {
            const container = document.getElementById('messages');
            container.innerHTML = messages.map(msg => \`
                <div class="message \${msg.direction === 'outbound' ? 'sent' : 'received'}">
                    <div class="message-bubble">
                        \${escapeHtml(msg.body)}
                        <div class="message-time">
                            \${formatTime(msg.timestamp)}
                            \${msg.direction === 'outbound' ? \`<span class="message-status">\${getStatusIcon(msg.status)}</span>\` : ''}
                        </div>
                    </div>
                </div>
            \`).join('');
            
            container.scrollTop = container.scrollHeight;
        }
        
        async function sendMessage() {
            const input = document.getElementById('messageInput');
            const body = input.value.trim();
            if (!body || !currentPhone) return;
            
            input.value = '';
            input.disabled = true;
            
            try {
                const res = await fetch('/api/inbox/send', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + authToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ to: currentPhone, body })
                });
                
                const result = await res.json();
                if (result.ok) {
                    // إعادة تحميل المحادثة
                    selectThread(currentPhone);
                } else {
                    alert('فشل الإرسال: ' + (result.reason || 'خطأ غير معروف'));
                }
            } catch (err) {
                alert('خطأ في الإرسال');
            } finally {
                input.disabled = false;
            }
        }
        
        function formatTime(timestamp) {
            const date = new Date(timestamp);
            const now = new Date();
            const diff = now - date;
            
            if (diff < 60000) return 'الآن';
            if (diff < 3600000) return Math.floor(diff / 60000) + ' د';
            if (diff < 86400000) return Math.floor(diff / 3600000) + ' س';
            
            return date.toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });
        }
        
        function getStatusIcon(status) {
            switch(status) {
                case 'delivered': return '✓✓';
                case 'sent': return '✓';
                case 'read': return '✓✓';
                case 'failed': return '✗';
                default: return '🕐';
            }
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // تحميل المحادثات عند فتح الصفحة
        fetchThreads();
        
        // تحديث المحادثات كل 10 ثواني
        setInterval(fetchThreads, 10000);
    </script>
</body>
</html>`);
});

// صفحة البث الجماعي
app.get('/admin/broadcast', simpleAuth, (req, res) => {
    const token = process.env.ADMIN_BASIC_TOKEN || '';
    res.send(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>البث الجماعي - WhatsApp</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #f0f2f5;
            min-height: 100vh;
        }
        .header {
            background: #075E54;
            color: white;
            padding: 15px 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .container {
            max-width: 800px;
            margin: 30px auto;
            padding: 0 20px;
        }
        .card {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            margin-bottom: 20px;
        }
        h2 {
            color: #1f2937;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .info-box {
            background: #fef3c7;
            border: 1px solid #fbbf24;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 20px;
        }
        .info-box h4 {
            color: #92400e;
            margin-bottom: 8px;
        }
        .info-box ul {
            color: #78350f;
            margin-right: 20px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #374151;
        }
        textarea {
            width: 100%;
            padding: 12px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            font-family: inherit;
            font-size: 14px;
            resize: vertical;
        }
        textarea:focus {
            outline: none;
            border-color: #25D366;
        }
        .template-info {
            background: #e0f2fe;
            border: 1px solid #0284c7;
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 20px;
        }
        .buttons {
            display: flex;
            gap: 10px;
        }
        button {
            padding: 12px 24px;
            border-radius: 8px;
            border: none;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        .btn-primary {
            background: #25D366;
            color: white;
            flex: 1;
        }
        .btn-primary:hover {
            background: #128C7E;
        }
        .btn-secondary {
            background: #6b7280;
            color: white;
        }
        .btn-secondary:hover {
            background: #4b5563;
        }
        .result {
            display: none;
            margin-top: 20px;
        }
        .result.success {
            background: #d4edda;
            border: 1px solid #28a745;
            color: #155724;
            padding: 15px;
            border-radius: 8px;
        }
        .result.error {
            background: #f8d7da;
            border: 1px solid #dc3545;
            color: #721c24;
            padding: 15px;
            border-radius: 8px;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        .stat-item {
            background: #f9fafb;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
        }
        .stat-number {
            font-size: 24px;
            font-weight: bold;
            color: #1f2937;
        }
        .stat-label {
            color: #6b7280;
            font-size: 14px;
            margin-top: 5px;
        }
        .loading {
            display: none;
            text-align: center;
            padding: 20px;
        }
        .spinner {
            border: 4px solid #f3f4f6;
            border-top: 4px solid #25D366;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📢 البث الجماعي عبر WhatsApp</h1>
    </div>
    
    <div class="container">
        <div class="card">
            <h2>📤 إرسال رسالة جماعية</h2>
            
            <div class="info-box">
                <h4>⚠️ تنبيهات مهمة:</h4>
                <ul>
                    <li>سيتم الإرسال فقط للعملاء الذين وافقوا على استقبال الرسائل (whatsappOptIn = true)</li>
                    <li>يجب استخدام قالب WhatsApp معتمد للبث الجماعي</li>
                    <li>تأكد من إعداد WA_TEMPLATE_SID_BROADCAST في متغيرات البيئة</li>
                    <li>الحد الأقصى 1000 رسالة في المرة الواحدة</li>
                </ul>
            </div>
            
            <form id="broadcastForm">
                <div class="form-group">
                    <label>متغيرات القالب (JSON):</label>
                    <textarea id="templateVars" rows="4" placeholder='{"1": "اسم العميل", "2": "رابط العرض"}'>{"1": "عميلنا العزيز"}</textarea>
                </div>
                
                <div class="template-info">
                    <strong>📋 معلومات القالب:</strong>
                    <p>سيتم استخدام القالب المعرّف في WA_TEMPLATE_SID_BROADCAST</p>
                    <p>تأكد من أن القالب معتمد من WhatsApp Business</p>
                </div>
                
                <div class="buttons">
                    <button type="submit" class="btn-primary">🚀 بدء البث</button>
                    <button type="button" class="btn-secondary" onclick="window.location.href='/admin/inbox'">📥 العودة للوارد</button>
                </div>
            </form>
            
            <div class="loading" id="loading">
                <div class="spinner"></div>
                <p>جاري الإرسال... قد يستغرق هذا بعض الوقت</p>
            </div>
            
            <div class="result" id="result"></div>
        </div>
    </div>
    
    <script>
        const authToken = '${token}' || localStorage.getItem('adminToken');
        
        document.getElementById('broadcastForm').onsubmit = async (e) => {
            e.preventDefault();
            
            const varsText = document.getElementById('templateVars').value;
            let templateVars = {};
            
            try {
                if (varsText.trim()) {
                    templateVars = JSON.parse(varsText);
                }
            } catch (err) {
                alert('خطأ في صيغة JSON للمتغيرات');
                return;
            }
            
            if (!confirm('هل أنت متأكد من إرسال البث الجماعي؟')) return;
            
            const loading = document.getElementById('loading');
            const result = document.getElementById('result');
            const form = document.getElementById('broadcastForm');
            
            loading.style.display = 'block';
            result.style.display = 'none';
            form.style.opacity = '0.5';
            form.style.pointerEvents = 'none';
            
            try {
                const res = await fetch('/admin/broadcast', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + authToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ templateVars })
                });
                
                const data = await res.json();
                
                if (data.ok) {
                    result.className = 'result success';
                    result.innerHTML = \`
                        <h3>✅ تم إكمال البث بنجاح!</h3>
                        <div class="stats">
                            <div class="stat-item">
                                <div class="stat-number">\${data.total}</div>
                                <div class="stat-label">إجمالي المستهدفين</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-number">\${data.sentOk}</div>
                                <div class="stat-label">نجح الإرسال</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-number">\${data.failed}</div>
                                <div class="stat-label">فشل الإرسال</div>
                            </div>
                        </div>
                        \${data.samples?.length ? \`
                            <p style="margin-top: 15px;"><strong>عينة من الأرقام المرسل إليها:</strong></p>
                            <p>\${data.samples.join(', ')}</p>
                        \` : ''}
                    \`;
                } else {
                    result.className = 'result error';
                    result.innerHTML = \`
                        <h3>❌ فشل البث</h3>
                        <p>\${data.reason || 'خطأ غير معروف'}</p>
                        \${data.message ? \`<p>\${data.message}</p>\` : ''}
                    \`;
                }
                
                result.style.display = 'block';
            } catch (err) {
                result.className = 'result error';
                result.innerHTML = \`
                    <h3>❌ خطأ في الاتصال</h3>
                    <p>\${err.message}</p>
                \`;
                result.style.display = 'block';
            } finally {
                loading.style.display = 'none';
                form.style.opacity = '1';
                form.style.pointerEvents = 'auto';
            }
        };
    </script>
</body>
</html>`);
});

// معالج البث الجماعي
app.post('/admin/broadcast', simpleAuth, async (req, res) => {
    try {
        const { templateVars = {} } = req.body;
        
        // التحقق من وجود قالب البث
        const templateSid = process.env.WA_TEMPLATE_SID_BROADCAST;
        if (!templateSid) {
            return res.json({
                ok: false,
                reason: 'no_template',
                message: 'لم يتم تكوين قالب البث. يرجى إضافة WA_TEMPLATE_SID_BROADCAST في متغيرات البيئة'
            });
        }
        
        // جلب قائمة العملاء المؤهلين
        let customers = [];
        
        // محاولة 1: من مجموعة users
        try {
            const usersCol = mongoose.connection.collection('users');
            const users = await usersCol.find({
                whatsappOptIn: true,
                phone: { $exists: true, $ne: null, $ne: '' }
            }, { projection: { phone: 1 } }).toArray();
            
            customers = users.map(u => u.phone);
        } catch (err) {
            console.log('Users collection not found or error:', err.message);
        }
        
        // محاولة 2: من مجموعة customers إن لم نجد users
        if (!customers.length) {
            try {
                const customersCol = mongoose.connection.collection('customers');
                const custs = await customersCol.find({
                    whatsappOptIn: true,
                    phone: { $exists: true, $ne: null, $ne: '' }
                }, { projection: { phone: 1 } }).toArray();
                
                customers = custs.map(c => c.phone);
            } catch (err) {
                console.log('Customers collection not found or error:', err.message);
            }
        }
        
        // محاولة 3: من الطلبات
        if (!customers.length) {
            try {
                const ordersCol = mongoose.connection.collection('orders');
                const orders = await ordersCol.aggregate([
                    {
                        $match: {
                            $or: [
                                { 'customer.whatsappOptIn': true },
                                { whatsappOptIn: true }
                            ]
                        }
                    },
                    {
                        $project: {
                            phone: {
                                $cond: [
                                    { $ne: ['$customer.phone', null] },
                                    '$customer.phone',
                                    { $cond: [
                                        { $ne: ['$customerPhone', null] },
                                        '$customerPhone',
                                        '$phone'
                                    ]}
                                ]
                            }
                        }
                    },
                    {
                        $match: {
                            phone: { $exists: true, $ne: null, $ne: '' }
                        }
                    },
                    {
                        $group: { _id: '$phone' }
                    }
                ]).toArray();
                
                customers = orders.map(o => o._id);
            } catch (err) {
                console.log('Orders collection error:', err.message);
            }
        }
        
        // التحقق من وجود عملاء
        if (!customers.length) {
            return res.json({
                ok: false,
                reason: 'no_opted_in_customers',
                message: 'لا يوجد عملاء مسجلين للحصول على رسائل WhatsApp'
            });
        }
        
        // تنظيف وإزالة المكرر
        const uniquePhones = [...new Set(customers.map(p => normalizeMsisdn(p)).filter(Boolean))];
        
        if (!uniquePhones.length) {
            return res.json({
                ok: false,
                reason: 'no_valid_phones',
                message: 'لا توجد أرقام هاتف صالحة'
            });
        }
        
        // الحد الأقصى 1000 رقم
        const targetPhones = uniquePhones.slice(0, 1000);
        
        // البث على دفعات
        const batchSize = 20;
        const results = { total: targetPhones.length, sentOk: 0, failed: 0, samples: [] };
        
        for (let i = 0; i < targetPhones.length; i += batchSize) {
            const batch = targetPhones.slice(i, i + batchSize);
            
            const promises = batch.map(async phone => {
                try {
                    const result = await app.locals.sendWhatsApp(phone, '', {
                        contentSid: templateSid,
                        vars: templateVars
                    });
                    
                    if (result.ok) {
                        results.sentOk++;
                        if (results.samples.length < 5) {
                            results.samples.push('+' + phone);
                        }
                    } else {
                        results.failed++;
                    }
                } catch (err) {
                    console.error('Broadcast send error:', err);
                    results.failed++;
                }
            });
            
            await Promise.all(promises);
            
            // انتظار قصير بين الدفعات
            if (i + batchSize < targetPhones.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        res.json({ ok: true, ...results });
        
    } catch (err) {
        console.error('Broadcast error:', err);
        res.status(500).json({
            ok: false,
            reason: 'server_error',
            message: err.message
        });
    }
});

// ============================================
// HTML Pages & Brand Logo Routes
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
      // Check if URL already has query params
      const separator = doc.logoUrl.includes('?') ? '&' : '?';
      return res.redirect(302, doc.logoUrl + separator + 'v=' + v);
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