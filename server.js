const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// تحميل المتغيرات البيئية
dotenv.config();

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
            'https://your-domain.com'
        ];
        
        // السماح للطلبات بدون origin (مثل Postman)
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI غير محدد في ملف .env');
    console.error('💡 يرجى إنشاء ملف .env وإضافة MONGODB_URI');
    process.exit(1);
}

mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    ssl: true,
    sslValidate: true,
    tlsAllowInvalidCertificates: false,
    tlsAllowInvalidHostnames: false,
    retryWrites: true,
    w: 'majority'
})
.then(() => {
    console.log('✅ تم الاتصال بقاعدة البيانات MongoDB Atlas');
    console.log('🌐 قاعدة البيانات جاهزة ودائمة');
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
    
    // إعادة محاولة الاتصال بعد 5 ثواني
    setTimeout(() => {
        console.log('🔄 إعادة محاولة الاتصال...');
        mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            ssl: true,
            sslValidate: true,
            tlsAllowInvalidCertificates: false,
            tlsAllowInvalidHostnames: false,
            retryWrites: true,
            w: 'majority'
        });
    }, 5000);
});

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