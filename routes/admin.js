const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// إعداد multer لرفع الصور
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // حفظ الصورة باسم ثابت للبراند
        const ext = path.extname(file.originalname);
        cb(null, 'brand-logo' + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    },
    fileFilter: function (req, file, cb) {
        // التحقق من نوع الملف
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('يرجى رفع ملف صورة صحيح'));
        }
    }
});

// رفع صورة البراند
router.post('/brand-image', upload.single('brandImage'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'لم يتم رفع أي ملف' });
        }

        const imageUrl = `/uploads/${req.file.filename}`;
        
        res.json({
            message: 'تم رفع صورة البراند بنجاح',
            imageUrl: imageUrl,
            filename: req.file.filename
        });
    } catch (error) {
        console.error('Error uploading brand image:', error);
        res.status(500).json({ message: 'خطأ في رفع الصورة', error: error.message });
    }
});

// الحصول على صورة البراند الحالية
router.get('/brand-image', (req, res) => {
    try {
        const uploadsDir = path.join(__dirname, '../uploads');
        const possibleExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        
        let brandImagePath = null;
        let brandImageUrl = null;
        
        for (const ext of possibleExtensions) {
            const filePath = path.join(uploadsDir, 'brand-logo' + ext);
            if (fs.existsSync(filePath)) {
                brandImagePath = filePath;
                brandImageUrl = `/uploads/brand-logo${ext}`;
                break;
            }
        }
        
        if (brandImagePath) {
            res.json({
                exists: true,
                imageUrl: brandImageUrl,
                filename: path.basename(brandImagePath)
            });
        } else {
            res.json({
                exists: false,
                message: 'لا توجد صورة براند محفوظة'
            });
        }
    } catch (error) {
        console.error('Error getting brand image:', error);
        res.status(500).json({ message: 'خطأ في جلب صورة البراند', error: error.message });
    }
});

// حذف صورة البراند
router.delete('/brand-image', (req, res) => {
    try {
        const uploadsDir = path.join(__dirname, '../uploads');
        const possibleExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        
        let deleted = false;
        
        for (const ext of possibleExtensions) {
            const filePath = path.join(uploadsDir, 'brand-logo' + ext);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                deleted = true;
            }
        }
        
        if (deleted) {
            res.json({ message: 'تم حذف صورة البراند بنجاح' });
        } else {
            res.status(404).json({ message: 'لا توجد صورة براند لحذفها' });
        }
    } catch (error) {
        console.error('Error deleting brand image:', error);
        res.status(500).json({ message: 'خطأ في حذف صورة البراند', error: error.message });
    }
});

module.exports = router;
