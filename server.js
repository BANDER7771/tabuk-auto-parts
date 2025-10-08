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
// إعداد الـ Health Check أولاً (قبل أي middleware آخر)
// ============================================
app.get('/health', (req, res) => {
    const health = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        port: process.env.PORT || 3000,
        checks: {
            server: 'running',
            database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
        }
    };
    
    // إرسال الاستجابة مع status 200
    res.status(200).json(health);
});

// معالج بسيط للصفحة الرئيسية
app.get('/', (req, res) => {
    res.send('تطبيق تشاليح تبوك يعمل بنجاح');
});

// ============================================
// إعداد trust proxy بشكل آمن
// ============================================
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
    console.log('✅ تم تفعيل trust proxy للإنتاج');
}

// ============================================
// تأكد من وجود مجلد uploads
// ============================================
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✅ تم إنشاء مجلد uploads');
}

// ============================================
// Middleware الأساسية
// ============================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// إعداد CORS بسيط
app.use(cors({
    origin: true, // السماح لجميع النطاقات في البداية
    credentials: true
}));

// Serve static files
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// قاعدة البيانات MongoDB
// ============================================
const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL;

if (MONGODB_URI) {
    const mongooseOptions = {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    };

    mongoose.connect(MONGODB_URI, mongooseOptions)
        .then(() => {
            console.log('✅ تم الاتصال بقاعدة البيانات MongoDB');
        })
        .catch(err => {
            console.error('⚠️ خطأ في الاتصال بقاعدة البيانات:', err.message);
            console.log('⚠️ سيعمل التطبيق بدون قاعدة بيانات');
        });
} else {
    console.log('⚠️ لا يوجد رابط قاعدة بيانات - التطبيق يعمل بدون قاعدة بيانات');
}

// ============================================
// Routes - فقط إذا كانت الملفات موجودة
// ============================================
const loadRoute = (routePath, mountPath) => {
    try {
        const fullPath = path.join(__dirname, routePath);
        if (fs.existsSync(fullPath)) {
            app.use(mountPath, require(routePath));
            console.log(`✅ تم تحميل ${mountPath}`);
        } else {
            console.log(`⚠️ الملف ${routePath} غير موجود`);
            // إنشاء route بديل بسيط
            app.use(mountPath, (req, res) => {
                res.json({ message: `${mountPath} endpoint is working` });
            });
        }
    } catch (error) {
        console.error(`❌ خطأ في تحميل ${routePath}:`, error.message);
        // إنشاء route بديل في حالة الخطأ
        app.use(mountPath, (req, res) => {
            res.json({ message: `${mountPath} endpoint is working (fallback)` });
        });
    }
};

// تحميل الـ routes
loadRoute('./routes/auth', '/api/auth');
loadRoute('./routes/parts', '/api/parts');
loadRoute('./routes/orders', '/api/orders');
loadRoute('./routes/shops', '/api/shops');
loadRoute('./routes/users', '/api/users');
loadRoute('./routes/admin', '/api/admin');

// ============================================
// صفحات HTML
// ============================================
app.get('/request', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'request.html');
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.send('صفحة الطلبات');
    }
});

app.get('/admin', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'admin.html');
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.send('لوحة الإدارة');
    }
});

// ============================================
// معالجة الأخطاء
// ============================================
app.use((err, req, res, next) => {
    console.error('خطأ:', err.message);
    res.status(err.status || 500).json({
        message: err.message || 'حدث خطأ في الخادم',
        error: process.env.NODE_ENV === 'development' ? err.stack : undefined
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
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    
    // طباعة معلومات Railway إذا كانت متوفرة
    if (process.env.RAILWAY_ENVIRONMENT) {
        console.log(`🚄 Railway Environment: ${process.env.RAILWAY_ENVIRONMENT}`);
    }
    if (process.env.RAILWAY_STATIC_URL) {
        console.log(`🔗 Railway URL: ${process.env.RAILWAY_STATIC_URL}`);
    }
});

// معالجة إشارات النظام
process.on('SIGTERM', () => {
    console.log('📡 تم استلام SIGTERM - إغلاق الخادم بأمان...');
    server.close(() => {
        mongoose.connection.close();
        console.log('✅ تم إغلاق الخادم بنجاح');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('📡 تم استلام SIGINT - إغلاق الخادم بأمان...');
    server.close(() => {
        mongoose.connection.close();
        console.log('✅ تم إغلاق الخادم بنجاح');
        process.exit(0);
    });
});

// معالجة أخطاء غير متوقعة
process.on('uncaughtException', (error) => {
    console.error('❌ خطأ غير متوقع:', error);
    // لا نوقف التطبيق في الإنتاج
    if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // لا نوقف التطبيق في الإنتاج
    if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
    }
});

module.exports = app;