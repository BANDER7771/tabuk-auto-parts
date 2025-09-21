const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { body, validationResult } = require('express-validator');

// فحص صحة الخدمة
router.get('/health', (req, res) => res.json({ ok: true, route: 'auth' }));

// تسجيل مستخدم جديد
router.post('/register', [
    body('name').notEmpty().withMessage('الاسم مطلوب'),
    body('email').isEmail().withMessage('البريد الإلكتروني غير صحيح'),
    body('phone').isMobilePhone('ar-SA').withMessage('رقم الجوال غير صحيح'),
    body('password').isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
], async (req, res) => {
    try {
        // التحقق من الأخطاء
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name, email, phone, password } = req.body;

        // التحقق من وجود المستخدم
        const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
        if (existingUser) {
            return res.status(400).json({ message: 'المستخدم موجود مسبقاً' });
        }

        // إنشاء مستخدم جديد
        const user = new User({ name, email, phone, password });
        await user.save();

        // إنشاء JWT token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'تم التسجيل بنجاح',
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'خطأ في السيرفر', error: error.message });
    }
});

// تسجيل الدخول
router.post('/login', [
    body('emailOrPhone').notEmpty().withMessage('البريد الإلكتروني أو رقم الجوال مطلوب'),
    body('password').notEmpty().withMessage('كلمة المرور مطلوبة')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { emailOrPhone, password } = req.body;

        // البحث عن المستخدم
        const user = await User.findOne({
            $or: [{ email: emailOrPhone }, { phone: emailOrPhone }]
        });

        if (!user) {
            return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
        }

        // التحقق من كلمة المرور
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
        }

        // إنشاء JWT token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );

        res.json({
            message: 'تم تسجيل الدخول بنجاح',
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'خطأ في السيرفر', error: error.message });
    }
});

module.exports = router;