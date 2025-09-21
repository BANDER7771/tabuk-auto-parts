const router = require('express').Router();
const Part = require('../models/Part');
const upload = require('../middleware/upload');

// فحص صحة الخدمة
router.get('/health', (req, res) => res.json({ ok: true, route: 'parts' }));

// الحصول على جميع القطع
router.get('/', async (req, res) => {
    try {
        const { category, carMake, carModel, minPrice, maxPrice, search } = req.query;
        
        let query = {};
        
        if (category) query.category = category;
        if (carMake) query.carMake = carMake;
        if (carModel) query.carModel = carModel;
        if (minPrice || maxPrice) {
            query.price = {};
            if (minPrice) query.price.$gte = Number(minPrice);
            if (maxPrice) query.price.$lte = Number(maxPrice);
        }
        if (search) {
            query.$text = { $search: search };
        }

        const parts = await Part.find(query)
            .populate('shop', 'name phone')
            .sort({ createdAt: -1 });

        res.json(parts);
    } catch (error) {
        res.status(500).json({ message: 'خطأ في جلب القطع', error: error.message });
    }
});

// إضافة قطعة جديدة - بدون مصادقة
router.post('/', upload.array('images', 5), async (req, res) => {
    try {
        const partData = req.body;
        
        // إضافة مسارات الصور
        if (req.files) {
            partData.images = req.files.map(file => `/uploads/${file.filename}`);
        }

        const part = new Part(partData);
        await part.save();

        res.status(201).json({
            message: 'تم إضافة القطعة بنجاح',
            part
        });
    } catch (error) {
        res.status(500).json({ message: 'خطأ في إضافة القطعة', error: error.message });
    }
});

// البحث عن قطعة
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        const parts = await Part.find({
            $or: [
                { name: { $regex: q, $options: 'i' } },
                { nameAr: { $regex: q, $options: 'i' } },
                { description: { $regex: q, $options: 'i' } }
            ]
        }).limit(10);

        res.json(parts);
    } catch (error) {
        res.status(500).json({ message: 'خطأ في البحث', error: error.message });
    }
});

// الحصول على تفاصيل قطعة واحدة
router.get('/:id', async (req, res) => {
    try {
        const part = await Part.findById(req.params.id)
            .populate('shop', 'name phone location');
        
        if (!part) {
            return res.status(404).json({ message: 'القطعة غير موجودة' });
        }

        // زيادة عدد المشاهدات
        part.views += 1;
        await part.save();

        res.json(part);
    } catch (error) {
        res.status(500).json({ message: 'خطأ في جلب القطعة', error: error.message });
    }
});

// تحديث قطعة
router.put('/:id', upload.array('images', 5), async (req, res) => {
    try {
        const updates = req.body;
        
        // إضافة الصور الجديدة
        if (req.files && req.files.length > 0) {
            updates.images = req.files.map(file => `/uploads/${file.filename}`);
        }

        const part = await Part.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true }
        );

        if (!part) {
            return res.status(404).json({ message: 'القطعة غير موجودة' });
        }

        res.json({
            message: 'تم تحديث القطعة بنجاح',
            part
        });
    } catch (error) {
        res.status(500).json({ message: 'خطأ في تحديث القطعة', error: error.message });
    }
});

// حذف قطعة
router.delete('/:id', async (req, res) => {
    try {
        const part = await Part.findByIdAndDelete(req.params.id);
        
        if (!part) {
            return res.status(404).json({ message: 'القطعة غير موجودة' });
        }

        res.json({ message: 'تم حذف القطعة بنجاح' });
    } catch (error) {
        res.status(500).json({ message: 'خطأ في حذف القطعة', error: error.message });
    }
});

module.exports = router;