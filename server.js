const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Bander997:!1Qqaallpp@cluster0.vmeeqir.mongodb.net/tabuk_auto_parts?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGODB_URI)
.then(() => {
    console.log('✅ تم الاتصال بقاعدة البيانات MongoDB Atlas');
    console.log('🌐 قاعدة البيانات جاهزة ودائمة');
})
.catch(err => console.error('❌ خطأ في الاتصال:', err));

// Routes - بدون المصادقة
// app.use('/api/auth', require('./routes/auth')); // تم إزالة هذا السطر
app.use('/api/parts', require('./routes/parts'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/shops', require('./routes/shops'));
app.use('/api/users', require('./routes/users'));

// Serve static files
app.use(express.static('public'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل على البورت ${PORT}`);
});