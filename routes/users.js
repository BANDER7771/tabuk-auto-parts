const express = require('express');
const router = express.Router();
const User = require('../models/User');

// فحص صحة الخدمة
router.get('/health', (req, res) => res.json({ ok: true, route: 'users' }));

// الحصول على جميع المستخدمين (للإدارة فقط)
router.get('/', async (req, res) => {
    try {
        const { role, page = 1, limit = 10 } = req.query;
        
        const filter = {};
        if (role) filter.role = role;

        const users = await User.find(filter)
            .select('-password')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .exec();

        const total = await User.countDocuments(filter);

        res.json({
            users,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({ message: 'خطأ في جلب المستخدمين', error: error.message });
    }
});

// الحصول على مستخدم محدد
router.get('/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        
        if (!user) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'خطأ في جلب المستخدم', error: error.message });
    }
});

module.exports = router;
