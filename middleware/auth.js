const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    try {
        // استخراج التوكن من الهيدر
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            throw new Error();
        }

        // التحقق من صحة التوكن
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        req.userId = decoded.userId;
        req.userEmail = decoded.email;
        next();
    } catch (error) {
        res.status(401).json({ message: 'الرجاء تسجيل الدخول أولاً' });
    }
};

// للتحقق من صلاحيات المشرف
const adminMiddleware = async (req, res, next) => {
    try {
        const User = require('../models/User');
        const user = await User.findById(req.userId);
        
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'غير مصرح لك بالوصول لهذه الصفحة' });
        }
        
        next();
    } catch (error) {
        res.status(500).json({ message: 'خطأ في التحقق من الصلاحيات' });
    }
};

module.exports = { authMiddleware, adminMiddleware };