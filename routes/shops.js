const express = require('express');
const router = express.Router();
const Shop = require('../models/Shop');

// فحص صحة الخدمة
router.get('/health', (req, res) => res.json({ ok: true, route: 'shops' }));

// الحصول على جميع المتاجر
router.get('/', async (req, res) => {
    try {
        const { city, verified, active, page = 1, limit = 10 } = req.query;
        
        const filter = {};
        if (city) filter['location.city'] = city;
        if (verified !== undefined) filter.isVerified = verified === 'true';
        if (active !== undefined) filter.isActive = active === 'true';

        const shops = await Shop.find(filter)
            .populate('owner', 'name email phone')
            .sort({ rating: -1, createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .exec();

        const total = await Shop.countDocuments(filter);

        res.json({
            shops,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({ message: 'خطأ في جلب المتاجر', error: error.message });
    }
});

// الحصول على متجر محدد
router.get('/:id', async (req, res) => {
    try {
        const shop = await Shop.findById(req.params.id)
            .populate('owner', 'name email phone');
        
        if (!shop) {
            return res.status(404).json({ message: 'المتجر غير موجود' });
        }

        res.json(shop);
    } catch (error) {
        res.status(500).json({ message: 'خطأ في جلب المتجر', error: error.message });
    }
});

module.exports = router;
