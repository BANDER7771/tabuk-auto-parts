const express = require('express');
const router = express.Router();
const multer = require('multer');
const Part = require('../models/Part');

// استيراد middleware المصادقة
const { authMiddleware } = require('../middleware/auth');

// إعداد multer لتحميل الصور
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('يجب أن يكون الملف صورة'), false);
        }
    }
});

// الحصول على جميع قطع الغيار (عام - بدون مصادقة)
router.get('/', async (req, res) => {
    try {
        const parts = await Part.find().populate('shop', 'name');
        res.json(parts);
    } catch (error) {
        res.status(500).json({ message: 'خطأ في استرجاع قطع الغيار' });
    }
});

// الحصول على قطعة غيار واحدة (عام - بدون مصادقة)
router.get('/:id', async (req, res) => {
    try {
        const part = await Part.findById(req.params.id).populate('shop', 'name phone location');
        if (!part) {
            return res.status(404).json({ message: 'قطعة الغيار غير موجودة' });
        }
        res.json(part);
    } catch (error) {
        res.status(500).json({ message: 'خطأ في استرجاع قطعة الغيار' });
    }
});

// البحث في قطع الغيار (عام - بدون مصادقة)
router.get('/search/:query', async (req, res) => {
    try {
        const query = req.params.query;
        const parts = await Part.find({
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { description: { $regex: query, $options: 'i' } },
                { category: { $regex: query, $options: 'i' } }
            ]
        }).populate('shop', 'name');
        res.json(parts);
    } catch (error) {
        res.status(500).json({ message: 'خطأ في البحث' });
    }
});

// ============================================
// العمليات المحمية (تحتاج مصادقة)
// ============================================

// إضافة قطعة غيار جديدة (محمي)
router.post('/', authMiddleware, upload.array('images', 5), async (req, res) => {
    try {
        const { name, description, price, category, shopId, inStock } = req.body;
        
        const images = req.files ? req.files.map(file => file.filename) : [];
        
        const part = new Part({
            name,
            description,
            price: parseFloat(price),
            category,
            shop: shopId,
            images,
            inStock: inStock === 'true'
        });
        
        const savedPart = await part.save();
        res.status(201).json(savedPart);
    } catch (error) {
        console.error('Error creating part:', error);
        res.status(400).json({ message: 'خطأ في إنشاء قطعة الغيار', error: error.message });
    }
});

// تحديث قطعة غيار (محمي)
router.put('/:id', authMiddleware, upload.array('images', 5), async (req, res) => {
    try {
        const { name, description, price, category, inStock } = req.body;
        
        const updateData = {
            name,
            description,
            price: parseFloat(price),
            category,
            inStock: inStock === 'true'
        };
        
        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => file.filename);
        }
        
        const updatedPart = await Part.findByIdAndUpdate(
            req.params.id, 
            updateData, 
            { new: true }
        );
        
        if (!updatedPart) {
            return res.status(404).json({ message: 'قطعة الغيار غير موجودة' });
        }
        
        res.json(updatedPart);
    } catch (error) {
        console.error('Error updating part:', error);
        res.status(400).json({ message: 'خطأ في تحديث قطعة الغيار', error: error.message });
    }
});

// حذف قطعة غيار (محمي)
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const deletedPart = await Part.findByIdAndDelete(req.params.id);
        if (!deletedPart) {
            return res.status(404).json({ message: 'قطعة الغيار غير موجودة' });
        }
        res.json({ message: 'تم حذف قطعة الغيار بنجاح' });
    } catch (error) {
        res.status(500).json({ message: 'خطأ في حذف قطعة الغيار' });
    }
});

// فحص صحة النظام
router.get('/health', (req, res) => {
    res.json({ message: 'نظام قطع الغيار يعمل بنجاح' });
});

module.exports = router;