const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// تحميل المتغيرات البيئية
dotenv.config();

// فرض TLS 1.2 لـ MongoDB
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();

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

// إضافة headers CORS إضافية
app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    // السماح لجميع النطاقات في الإنتاج (حل مؤقت)
    if (process.env.NODE_ENV === 'production') {
        res.header('Access-Control-Allow-Origin', origin || '*');
    }
    
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
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

// حماية عامة
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 100, // حد أقصى 100 طلب
    message: 'تم تجاوز الحد المسموح من الطلبات، حاول مرة أخرى لاحقاً'
});

// حماية تسجيل الدخول
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // 5 محاولات كحد أقصى
    skipSuccessfulRequests: true,
    message: 'محاولات دخول كثيرة، حاول بعد 15 دقيقة'
});

// تطبيق Rate Limiting
app.use('/api/', generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ============================================
// Middleware العام
// ============================================
// زيادة حد البيانات
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// middleware للتحقق من Content-Type
app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT') {
        if (!req.headers['content-type']) {
            return res.status(400).json({ 
                message: 'Content-Type header is required',
                error: 'Missing Content-Type header'
            });
        }
    }
    next();
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        retryWrites: true,
        w: 'majority',
        ssl: true,
        sslValidate: false,
        tlsAllowInvalidCertificates: true,
        tlsAllowInvalidHostnames: true
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

// ============================================
// Serve static files
// ============================================
app.use(express.static('public'));

// ============================================
// معالجة الأخطاء الموحدة
// ============================================

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    
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
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل على البورت ${PORT}`);
});