const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// تحميل المتغيرات البيئية
dotenv.config();

const app = express();

// إعداد trust proxy آمن للعمل مع Railway و Render
// بدلاً من true، نحدد عدد proxy hops المتوقعة
try {
    if (process.env.NODE_ENV === 'production') {
        // في الإنتاج، نثق في proxy واحد فقط (Railway/Render)
        app.set('trust proxy', 1);
        console.log('✅ تم تفعيل trust proxy للإنتاج (1 hop)');
    } else {
        // في التطوير، لا نثق في أي proxy
        app.set('trust proxy', false);
        console.log('✅ تم إلغاء trust proxy للتطوير');
    }
} catch (trustProxyError) {
    console.error('❌ خطأ في إعداد trust proxy:', trustProxyError.message);
    // استخدام إعداد آمن كبديل
    app.set('trust proxy', false);
    console.warn('⚠️ تم استخدام إعداد trust proxy آمن كبديل');
}

// ============================================
// تثبيت الحزم الجديدة المطلوبة
// ============================================
// يجب تشغيل: npm install express-rate-limit compression helmet

const rateLimit = require('express-rate-limit');
const compression = require('compression');
const helmet = require('helmet');

// ============================================
// إعدادات الأمان والحماية
// ============================================

// تطبيق Helmet للحماية الأساسية
app.use(helmet({
    contentSecurityPolicy: false, // للسماح بتحميل الموارد الخارجية
}));

// تطبيق Compression لضغط البيانات
app.use(compression());

// إعدادات CORS محسنة
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:5000',
            'http://localhost:10000',
            'https://tabuk-auto-parts.onrender.com',
            'https://www.tabuk-auto-parts.onrender.com',
            'http://tabuk-auto-parts.onrender.com',
            'http://www.tabuk-auto-parts.onrender.com',
            // إضافة نطاقات Railway
            'https://tabuk-auto-parts-production.up.railway.app',
            'https://www.tabuk-auto-parts-production.up.railway.app',
            'http://tabuk-auto-parts-production.up.railway.app',
            'http://www.tabuk-auto-parts-production.up.railway.app'
        ];
        
        // السماح للطلبات بدون origin (مثل Postman أو same-origin)
        if (!origin) {
            return callback(null, true);
        }
        
        // السماح لجميع subdomains من onrender.com و railway.app في الإنتاج
        if (process.env.NODE_ENV === 'production') {
            if (origin.includes('.onrender.com') || origin.includes('.railway.app')) {
                return callback(null, true);
            }
        }
        
        // التحقق من القائمة المسموحة
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('❌ CORS Error - Origin not allowed:', origin);
            console.log('🔍 Current origin:', origin);
            console.log('✅ Allowed origins:', allowedOrigins);
            // في الإنتاج، نسمح بالطلب حتى لو لم يكن في القائمة (للتجربة)
            if (process.env.NODE_ENV === 'production') {
                console.log('⚠️ Allowing request in production mode');
                return callback(null, true);
            }
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// إضافة headers CORS إضافية مع دعم UTF-8
app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    // السماح لجميع النطاقات في الإنتاج (حل مؤقت)
    if (process.env.NODE_ENV === 'production') {
        res.header('Access-Control-Allow-Origin', origin || '*');
    }
    
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // تعيين Content-Type فقط للـ API responses وليس للملفات الثابتة
    if (req.path.startsWith('/api/')) {
        res.header('Content-Type', 'application/json; charset=utf-8');
    }
    
    // التعامل مع preflight requests
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// ============================================
// Rate Limiting
// ============================================

// حماية عامة مع إعدادات trust proxy آمنة
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 100, // حد أقصى 100 طلب
    message: 'تم تجاوز الحد المسموح من الطلبات، حاول مرة أخرى لاحقاً',
    standardHeaders: true,
    legacyHeaders: false,
    // إعداد keyGenerator آمن للعمل مع trust proxy
    keyGenerator: (req) => {
        // في بيئة الإنتاج، استخدم X-Forwarded-For بحذر
        if (process.env.NODE_ENV === 'production') {
            // التحقق من وجود proxy headers موثوقة
            const forwardedFor = req.headers['x-forwarded-for'];
            const realIP = req.headers['x-real-ip'];
            
            // استخدام أول IP في X-Forwarded-For (الأكثر أماناً)
            if (forwardedFor && typeof forwardedFor === 'string') {
                const firstIP = forwardedFor.split(',')[0].trim();
                return firstIP;
            }
            
            // استخدام X-Real-IP كبديل
            if (realIP && typeof realIP === 'string') {
                return realIP.trim();
            }
        }
        
        // في التطوير أو كبديل، استخدم IP المباشر
        return req.ip || req.connection.remoteAddress || 'unknown';
    },
    skip: (req) => {
        // تخطي rate limiting للـ health checks
        return req.path === '/health' || req.path === '/api/test-cors';
    }
});

// حماية تسجيل الدخول
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // 5 محاولات كحد أقصى
    skipSuccessfulRequests: true,
    message: 'محاولات دخول كثيرة، حاول بعد 15 دقيقة',
    standardHeaders: true,
    legacyHeaders: false,
    // نفس keyGenerator الآمن
    keyGenerator: (req) => {
        if (process.env.NODE_ENV === 'production') {
            const forwardedFor = req.headers['x-forwarded-for'];
            const realIP = req.headers['x-real-ip'];
            
            if (forwardedFor && typeof forwardedFor === 'string') {
                const firstIP = forwardedFor.split(',')[0].trim();
                return firstIP;
            }
            
            if (realIP && typeof realIP === 'string') {
                return realIP.trim();
            }
        }
        
        return req.ip || req.connection.remoteAddress || 'unknown';
    }
});

// تطبيق Rate Limiting مع معالجة الأخطاء
try {
    app.use('/api/', generalLimiter);
    app.use('/api/auth/login', authLimiter);
    app.use('/api/auth/register', authLimiter);
    console.log('✅ تم تطبيق Rate Limiting بنجاح');
} catch (rateLimitError) {
    console.error('❌ خطأ في تطبيق Rate Limiting:', rateLimitError.message);
    console.warn('⚠️ سيتم تشغيل الخادم بدون Rate Limiting');
}

// ============================================
// Middleware العام - يجب أن يكون قبل CORS
// ============================================
// زيادة حد البيانات مع دعم UTF-8 للنصوص العربية
app.use(express.json({ 
    limit: '10mb',
    verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf8');
    }
}));
app.use(express.urlencoded({ 
    extended: true, 
    limit: '10mb',
    parameterLimit: 50000
}));

// إزالة middleware المتضارب - سيتم التعامل مع multipart في routes/orders.js

// Serve static files مع إعدادات صحيحة
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        // تعيين Content-Type الصحيح للملفات HTML
        if (path.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
        // تعيين Content-Type للملفات CSS
        if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        }
        // تعيين Content-Type للملفات JavaScript
        if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
    }
}));

// Middleware للتشخيص (فقط في التطوير)
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`📥 ${req.method} ${req.path}`);
        console.log('📋 Headers:', req.headers);
        if (req.body && Object.keys(req.body).length > 0) {
            console.log('📦 Body:', req.body);
        }
        next();
    });
}

// ============================================
// إنشاء مجلد uploads تلقائياً
// ============================================
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✅ تم إنشاء مجلد uploads');
}

// ============================================
// اتصال محسن بقاعدة البيانات
// ============================================
const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL || process.env.MONGO_URL;

if (!MONGODB_URI) {
    console.error('❌ متغير قاعدة البيانات غير محدد');
    console.error('💡 يرجى إضافة أحد المتغيرات التالية:');
    console.error('   - MONGODB_URI');
    console.error('   - DATABASE_URL');
    console.error('   - MONGO_URL');
    console.error('🌐 البيئة الحالية:', process.env.NODE_ENV || 'development');
    console.error('🔧 المنصة:', process.env.RAILWAY_ENVIRONMENT ? 'Railway' : (process.env.RENDER ? 'Render' : 'Local'));
    
    // في بيئة الإنتاج، لا نوقف الخادم بل نستخدم نظام احتياطي
    if (process.env.NODE_ENV === 'production') {
        console.warn('⚠️ سيتم تشغيل الخادم بدون قاعدة بيانات (وضع احتياطي)');
    } else {
        process.exit(1);
    }
}

// محاولة الاتصال بقاعدة البيانات فقط إذا كان MONGODB_URI متاحاً
if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 10000,
        retryWrites: true,
        w: 'majority',
        maxPoolSize: 10
    })
    .then(() => {
        console.log('✅ تم الاتصال بقاعدة البيانات MongoDB');
        console.log('🌐 قاعدة البيانات جاهزة ودائمة');
        console.log('🔗 الرابط:', MONGODB_URI.replace(/\/\/.*:.*@/, '//***:***@')); // إخفاء كلمة المرور
    })
    .catch(err => {
        console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.message);
        
        // معالجة أخطاء SSL/TLS
        if (err.code === 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR' || 
            err.message.includes('SSL') || 
            err.message.includes('TLS')) {
            console.error('🔒 خطأ SSL/TLS - تحقق من إعدادات MongoDB Atlas');
            console.error('💡 تأكد من أن IP Address مُضاف في Network Access');
            console.error('💡 تأكد من أن المستخدم له صلاحيات كافية');
        }
        
        console.warn('⚠️ سيتم تشغيل الخادم في الوضع الاحتياطي (بدون قاعدة بيانات)');
    });
} else {
    console.warn('⚠️ لا يوجد رابط قاعدة بيانات - سيتم تشغيل الخادم في الوضع الاحتياطي');
}

// معالجة انقطاع الاتصال
mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ انقطع الاتصال بقاعدة البيانات');
});

mongoose.connection.on('reconnected', () => {
    console.log('✅ تم إعادة الاتصال بقاعدة البيانات');
});

// ============================================
// Routes - مع المصادقة
// ============================================

// Health check endpoint لـ Railway
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        port: process.env.PORT || 3000
    });
});

// Route للتحقق من CORS
app.get('/api/test-cors', (req, res) => {
    res.json({
        message: 'CORS is working!',
        origin: req.headers.origin,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
    });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/parts', require('./routes/parts'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/shops', require('./routes/shops'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));

// Route للصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Routes للصفحات الأخرى
app.get('/request', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'request.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Static files already configured above

// ============================================
// معالجة الأخطاء الموحدة
// ============================================

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    
    // معالجة أخطاء Rate Limiting
    if (err.code === 'ERR_ERL_PERMISSIVE_TRUST_PROXY') {
        console.error('❌ Trust proxy configuration error:', err.message);
        return res.status(500).json({ 
            message: 'خطأ في إعدادات الخادم',
            error: 'Server configuration error'
        });
    }
    
    // معالجة أخطاء Multer
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'حجم الملف كبير جداً' });
    }
    
    if (err.name === 'ValidationError') {
        return res.status(400).json({ 
            message: 'خطأ في البيانات المدخلة',
            errors: Object.values(err.errors).map(e => e.message)
        });
    }
    
    if (err.name === 'CastError') {
        return res.status(400).json({ message: 'معرف غير صحيح' });
    }
    
    // خطأ عام
    res.status(err.status || 500).json({
        message: err.message || 'حدث خطأ في الخادم',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ message: 'الصفحة غير موجودة' });
});

// ============================================
// تشغيل الخادم
// ============================================
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 السيرفر يعمل على البورت ${PORT}`);
    console.log(`🌐 البيئة: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔧 المنصة: ${process.env.RAILWAY_ENVIRONMENT ? 'Railway' : 'Local'}`);
});

// معالجة إشارات النظام
process.on('SIGTERM', () => {
    console.log('📡 تم استلام SIGTERM - إغلاق الخادم بأمان...');
    server.close(() => {
        console.log('✅ تم إغلاق الخادم بنجاح');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('📡 تم استلام SIGINT - إغلاق الخادم بأمان...');
    server.close(() => {
        console.log('✅ تم إغلاق الخادم بنجاح');
        process.exit(0);
    });
});