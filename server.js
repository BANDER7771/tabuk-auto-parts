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
// 1. Health Check - أول شيء (قبل أي middleware)
// ============================================
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'production',
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        port: process.env.PORT || 3000
    });
});

app.get('/api/test-cors', (req, res) => {
    res.json({
        status: 'OK',
        message: 'CORS is working!',
        timestamp: new Date().toISOString()
    });
});

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
// 10. HTML Pages
// ============================================
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