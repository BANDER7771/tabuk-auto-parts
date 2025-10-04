const router = require('express').Router();
const Order = require('../models/Order');
const { sendWhatsAppNotification } = require('../config/whatsapp');
const upload = require('../middleware/upload');
// تم إزالة استيراد البريد الإلكتروني - نستخدم الواتساب فقط

// فحص صحة الخدمة
router.get('/health', (req, res) => res.json({ ok: true, route: 'orders' }));

// إنشاء طلب جديد مع معالجة أخطاء multer
router.post('/', (req, res, next) => {
    upload.single('partImage')(req, res, (err) => {
        if (err) {
            console.error('❌ Multer error:', err);
            console.error('Error details:', {
                message: err.message,
                code: err.code,
                field: err.field,
                stack: err.stack
            });
            
            if (err.message && err.message.includes('Unexpected end of form')) {
                return res.status(400).json({
                    message: 'خطأ في إرسال النموذج. الرجاء التأكد من ملء جميع الحقول والمحاولة مرة أخرى.',
                    error: 'Form submission error'
                });
            }
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    message: 'حجم الملف كبير جداً. الحد الأقصى 10MB.',
                    error: 'File too large'
                });
            }
            if (err.message && err.message.includes('Only image files are allowed')) {
                return res.status(400).json({
                    message: 'يُسمح فقط برفع ملفات الصور (JPG, PNG, GIF)',
                    error: 'Invalid file type'
                });
            }
            
            // خطأ عام
            return res.status(400).json({
                message: 'خطأ في رفع الصورة. الرجاء التأكد من أن الملف صورة صحيحة وحجمها أقل من 10MB.',
                error: err.message || err.code || 'Upload error',
                details: process.env.NODE_ENV === 'development' ? err.stack : undefined
            });
        }
        next();
    });
}, async (req, res) => {
    try {
        // فحص وجود البيانات مع تشخيص مفصل
        console.log('🔍 Order Request debugging:');
        console.log('- Content-Type:', req.headers['content-type']);
        console.log('- Body exists:', !!req.body);
        console.log('- Body keys:', req.body ? Object.keys(req.body) : 'No body');
        console.log('- File (single):', !!req.file);
        console.log('- Raw body:', req.body);

        // التحقق من وجود البيانات الأساسية بدلاً من فحص req.body فارغ
        const hasRequiredData = req.body && (
            req.body.fullName || 
            req.body.phone || 
            req.body.carNameCategory || 
            req.body.carYear || 
            req.body.partDetails
        );

        if (!hasRequiredData) {
            console.log('❌ لا توجد بيانات مطلوبة في الطلب');
            return res.status(400).json({ 
                message: 'لم يتم استلام البيانات بشكل صحيح. الرجاء التأكد من ملء جميع الحقول المطلوبة.',
                error: 'Required fields missing',
                debug: {
                    contentType: req.headers['content-type'],
                    bodyExists: !!req.body,
                    bodyKeys: req.body ? Object.keys(req.body) : [],
                    hasFile: !!req.file
                }
            });
        }

        const {
            fullName,
            phone,
            carNameCategory,
            carYear,
            partDetails,
            urgency,
            delivery,
            notes,
            email,
            city
        } = req.body;

        // فحص البيانات المطلوبة (البيانات المبسطة الجديدة)
        if (!fullName || !phone || !carNameCategory || !carYear || !partDetails) {
            return res.status(400).json({ 
                message: 'البيانات المطلوبة مفقودة',
                required: ['fullName', 'phone', 'carNameCategory', 'carYear', 'partDetails']
            });
        }

        // إنشاء رقم طلب فريد
        const orderNumber = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();

        // حساب رسوم التوصيل
        let deliveryFee = 0;
        const deliveryOption = delivery || 'free';
        
        switch (deliveryOption) {
            case 'express':
                deliveryFee = 50;
                break;
            case 'standard':
                deliveryFee = 25;
                break;
            case 'free':
            default:
                deliveryFee = 0;
                break;
        }

        // تحليل اسم السيارة وفئتها
        const carParts = carNameCategory.split(' ');
        const carMake = carParts[0] || carNameCategory;
        const carModel = carParts.slice(1).join(' ') || 'غير محدد';

        // إنشاء طلب جديد
        const order = new Order({
            orderNumber: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            customerName: fullName,
            customerPhone: phone,
            customerEmail: '',
            items: [{
                partName: partDetails,
                quantity: 1,
                // حفظ الصورة بشكل صحيح - Cloudinary أو Local
                partImage: req.file ? (req.file.path || `/uploads/${req.file.filename}`) : null,
                imageUrl: req.file ? (req.file.path || `/uploads/${req.file.filename}`) : null
            }],            carInfo: {
                make: carMake,
                model: carModel,
                year: parseInt(carYear),
                fullName: carNameCategory // حفظ الاسم الكامل كما أدخله المستخدم
            },
            urgency: urgency || 'normal',
            deliveryOption: deliveryOption,
            deliveryFee: deliveryFee,
            notes: notes,
            shippingAddress: {
                name: fullName,
                phone: phone,
                city: city || 'تبوك',
                district: '',
                street: '',
                details: notes
            },
            totalAmount: deliveryFee, // رسوم التوصيل + سعر القطعة (سيتم تحديده لاحقاً)
            status: 'pending'
        });

        try {
            await order.save();
            console.log('✅ تم حفظ الطلب في قاعدة البيانات:', order.orderNumber);
        } catch (dbError) {
            console.error('❌ خطأ في حفظ الطلب في قاعدة البيانات:', dbError.message);
            
            // حفظ الطلب في ملف محلي كبديل
            const fs = require('fs');
            const path = require('path');
            
            try {
                const ordersFile = path.join(__dirname, '../backup_orders.json');
                let backupOrders = [];
                
                if (fs.existsSync(ordersFile)) {
                    const data = fs.readFileSync(ordersFile, 'utf8');
                    backupOrders = JSON.parse(data);
                }
                
                backupOrders.push({
                    ...order.toObject(),
                    savedAt: new Date(),
                    source: 'backup_due_to_db_error'
                });
                
                fs.writeFileSync(ordersFile, JSON.stringify(backupOrders, null, 2));
                console.log('✅ تم حفظ الطلب في الملف الاحتياطي');
            } catch (fileError) {
                console.error('❌ خطأ في حفظ الطلب في الملف الاحتياطي:', fileError.message);
            }
        }

        // إرسال إشعار واتساب فقط
        const deliveryText = deliveryOption === 'express' ? 'مستعجل (1-2 ساعة) - 50 ريال' : 
                           deliveryOption === 'standard' ? 'سريع (3-5 ساعات) - 25 ريال' : 
                           'عادي (12-24 ساعة) - مجاني';
        
        const notificationData = {
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            orderType: 'طلب قطع غيار',
            carMake: order.carInfo.make,
            carModel: order.carInfo.model,
            carYear: order.carInfo.year,
            carFullName: order.carInfo.fullName,
            description: `${order.items[0].partName}\nالتوصيل: ${deliveryText}${req.file ? '\n📷 يحتوي على صورة' : ''}`,
            createdAt: order.createdAt,
            hasImage: !!req.file
        };

        // إرسال إشعار واتساب
        try {
            await sendWhatsAppNotification(notificationData);
        } catch (whatsappError) {
            console.error('خطأ في إرسال إشعار الواتساب:', whatsappError);
        }

        res.status(201).json({
            message: 'تم استلام طلبك بنجاح',
            orderNumber: order.orderNumber,
            id: order.orderNumber,
            order: {
                orderNumber: order.orderNumber,
                customerName: order.customerName,
                status: order.status,
                createdAt: order.createdAt
            }
        });
    } catch (error) {
        console.error('❌ خطأ في إنشاء الطلب:', error);
        
        // معالجة أخطاء multer المحددة
        if (error.message && error.message.includes('Unexpected end of form')) {
            return res.status(400).json({ 
                message: 'خطأ في إرسال النموذج. الرجاء التأكد من ملء جميع الحقول والمحاولة مرة أخرى.',
                error: 'Form submission error'
            });
        }
        
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
                message: 'حجم الملف كبير جداً. الحد الأقصى 10MB.',
                error: 'File too large'
            });
        }
        
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ 
                message: 'نوع الملف غير مدعوم. يُسمح فقط بملفات الصور.',
                error: 'Invalid file type'
            });
        }
        
        res.status(500).json({ 
            message: 'خطأ في إنشاء الطلب. الرجاء المحاولة مرة أخرى.', 
            error: error.message 
        });
    }
});

// الحصول على جميع الطلبات (للوحة الإدارة)
router.get('/admin', async (req, res) => {
    try {
        let orders = [];
        let backupOrders = [];
        
        // محاولة جلب الطلبات من قاعدة البيانات (استثناء المؤرشفة)
        try {
            orders = await Order.find({ archived: { $ne: true } })
                .sort({ createdAt: -1 })
                .populate('items.partId');
        } catch (dbError) {
            console.error('❌ Database error in /admin:', dbError.message);
        }
        
        // جلب الطلبات الاحتياطية من الملف
        const fs = require('fs');
        const path = require('path');
        const backupFile = path.join(__dirname, '../backup_orders.json');
        
        if (fs.existsSync(backupFile)) {
            try {
                const data = fs.readFileSync(backupFile, 'utf8');
                backupOrders = JSON.parse(data);
            } catch (fileError) {
                console.error('❌ Backup file read error:', fileError.message);
            }
        }
        
        res.json({
            orders: orders,
            backupOrders: backupOrders,
            totalOrders: orders.length + backupOrders.length,
            dbStatus: orders.length > 0 ? 'connected' : 'disconnected'
        });
    } catch (error) {
        console.error('❌ Error in GET /admin:', error);
        res.status(500).json({ 
            message: 'خطأ في جلب الطلبات', 
            error: error.message 
        });
    }
});

// الحصول على الطلبات المؤرشفة (للوحة الإدارة)
router.get('/admin/archived', async (req, res) => {
    try {
        let archivedOrders = [];
        
        // محاولة جلب الطلبات المؤرشفة من قاعدة البيانات
        try {
            archivedOrders = await Order.find({ archived: true })
                .sort({ archivedAt: -1 })
                .populate('items.partId');
        } catch (dbError) {
            console.error('❌ Database error in /admin/archived:', dbError.message);
        }
        
        res.json({
            archivedOrders: archivedOrders,
            totalArchived: archivedOrders.length,
            dbStatus: archivedOrders.length > 0 ? 'connected' : 'disconnected'
        });
    } catch (error) {
        console.error('❌ Error in GET /admin/archived:', error);
        res.status(500).json({ 
            message: 'خطأ في جلب الطلبات المؤرشفة', 
            error: error.message 
        });
    }
});

// تحديث حالة الطلب للإدارة
router.put('/admin/:id/status', async (req, res) => {
    try {
        const { status, description } = req.body;
        
        if (!status) {
            return res.status(400).json({ 
                message: 'الحالة مطلوبة',
                error: 'Status is required'
            });
        }

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        // تحديث الحالة
        order.status = status;
        
        // إضافة إلى Timeline
        order.timeline.push({
            status: status,
            date: new Date(),
            description: description || `تم تحديث الحالة إلى ${status}`
        });

        await order.save();
        console.log('✅ Order status updated:', order.orderNumber, 'to', status);

        // إرسال إشعار واتساب للإدارة عن تحديث الحالة
        try {
            await sendWhatsAppNotification({
                orderNumber: order.orderNumber,
                customerName: order.customerName,
                customerPhone: order.customerPhone,
                orderType: 'تحديث حالة الطلب',
                description: `تم تحديث حالة الطلب إلى: ${status}`,
                createdAt: new Date()
            });
        } catch (whatsappError) {
            console.error('❌ WhatsApp notification error:', whatsappError);
        }

        res.json({
            message: 'تم تحديث حالة الطلب',
            order
        });
    } catch (error) {
        console.error('❌ Error in PUT /admin/:id/status:', error);
        res.status(500).json({ 
            message: 'خطأ في تحديث الطلب', 
            error: error.message 
        });
    }
});

router.get('/', async (req, res) => {
    try {
        const { status, phone } = req.query;
        
        let query = {};
        if (status) query.status = status;
        if (phone) query.customerPhone = phone;

        const orders = await Order.find(query)
            .sort({ createdAt: -1 })
            .limit(50);

        res.json(orders);
    } catch (error) {
        console.error('❌ Error in GET /:', error);
        res.status(500).json({ 
            message: 'خطأ في جلب الطلبات', 
            error: error.message 
        });
    }
});

// الحصول على طلب واحد
router.get('/:orderNumber', async (req, res) => {
    try {
        const order = await Order.findOne({ 
            orderNumber: req.params.orderNumber 
        });

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        res.json(order);
    } catch (error) {
        console.error('❌ Error in GET /:orderNumber:', error);
        res.status(500).json({ 
            message: 'خطأ في جلب الطلب', 
            error: error.message 
        });
    }
});

// تحديث حالة الطلب
router.put('/:orderNumber/status', async (req, res) => {
    try {
        const { status, description } = req.body;
        
        if (!status) {
            return res.status(400).json({ 
                message: 'الحالة مطلوبة',
                error: 'Status is required'
            });
        }

        const order = await Order.findOne({ 
            orderNumber: req.params.orderNumber 
        });

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        // تحديث الحالة
        order.status = status;
        
        // إضافة إلى Timeline
        order.timeline.push({
            status: status,
            date: new Date(),
            description: description || `تم تحديث الحالة إلى ${status}`
        });

        await order.save();
        console.log('✅ Order status updated:', order.orderNumber, 'to', status);

        res.json({
            message: 'تم تحديث حالة الطلب',
            order
        });
    } catch (error) {
        console.error('❌ Error in PUT /:orderNumber/status:', error);
        res.status(500).json({ 
            message: 'خطأ في تحديث الطلب', 
            error: error.message 
        });
    }
});

// إلغاء طلب
router.delete('/:orderNumber', async (req, res) => {
    try {
        const order = await Order.findOne({ 
            orderNumber: req.params.orderNumber 
        });

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        order.status = 'cancelled';
        order.timeline.push({
            status: 'cancelled',
            date: new Date(),
            description: 'تم إلغاء الطلب'
        });

        await order.save();
        console.log('✅ Order cancelled:', order.orderNumber);

        res.json({ 
            message: 'تم إلغاء الطلب بنجاح' 
        });
    } catch (error) {
        console.error('❌ Error in DELETE /:orderNumber:', error);
        res.status(500).json({ 
            message: 'خطأ في إلغاء الطلب', 
            error: error.message 
        });
    }
});

// حذف طلب نهائياً (للإدارة فقط)
router.delete('/admin/:id', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        await Order.findByIdAndDelete(req.params.id);
        console.log('✅ Order permanently deleted:', order.orderNumber);

        res.json({ 
            message: 'تم حذف الطلب نهائياً' 
        });
    } catch (error) {
        console.error('❌ Error in DELETE /admin/:id:', error);
        res.status(500).json({ 
            message: 'خطأ في حذف الطلب', 
            error: error.message 
        });
    }
});

// أرشفة طلب (للإدارة فقط)
router.put('/admin/:id/archive', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        // إضافة حقل archived إلى الطلب
        order.archived = true;
        order.archivedAt = new Date();
        order.timeline.push({
            status: 'archived',
            date: new Date(),
            description: 'تم أرشفة الطلب'
        });

        await order.save();
        console.log('✅ Order archived:', order.orderNumber);

        res.json({ 
            message: 'تم أرشفة الطلب بنجاح',
            order
        });
    } catch (error) {
        console.error('❌ Error in PUT /admin/:id/archive:', error);
        res.status(500).json({ 
            message: 'خطأ في أرشفة الطلب', 
            error: error.message 
        });
    }
});

// استرجاع طلب مؤرشف (للإدارة فقط)
router.put('/admin/:id/restore', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ 
                message: 'الطلب غير موجود' 
            });
        }

        // إزالة حقل archived
        order.archived = false;
        order.archivedAt = undefined;
        order.timeline.push({
            status: 'restored',
            date: new Date(),
            description: 'تم استرجاع الطلب من الأرشيف'
        });

        await order.save();
        console.log('✅ Order restored:', order.orderNumber);

        res.json({ 
            message: 'تم استرجاع الطلب بنجاح',
            order
        });
    } catch (error) {
        console.error('❌ Error in PUT /admin/:id/restore:', error);
        res.status(500).json({ 
            message: 'خطأ في استرجاع الطلب', 
            error: error.message 
        });
    }
});

// تتبع الطلب بالهاتف
router.get('/track/:phone', async (req, res) => {
    try {
        const orders = await Order.find({ 
            customerPhone: req.params.phone 
        })
        .sort({ createdAt: -1 })
        .limit(10);

        res.json(orders);
    } catch (error) {
        console.error('❌ Error in GET /track/:phone:', error);
        res.status(500).json({ 
            message: 'خطأ في تتبع الطلبات', 
            error: error.message 
        });
    }
});

// إنشاء طلب بيع سيارة
router.post('/sell-car', upload.array('images', 10), async (req, res) => {
    try {
        // فحص وجود البيانات مع تشخيص مفصل
        console.log('🔍 Sell Car Request debugging:');
        console.log('- Content-Type:', req.headers['content-type']);
        console.log('- Body exists:', !!req.body);
        console.log('- Body keys:', req.body ? Object.keys(req.body) : 'No body');
        console.log('- Files (array):', req.files ? req.files.length : 0);

        if (!req.body || Object.keys(req.body).length === 0) {
            console.log('❌ Empty request body received');
            return res.status(400).json({ 
                message: 'لم يتم استلام البيانات بشكل صحيح',
                error: 'Request body is undefined or empty',
                debug: {
                    contentType: req.headers['content-type'],
                    bodyExists: !!req.body,
                    bodyKeys: req.body ? Object.keys(req.body) : [],
                    filesCount: req.files ? req.files.length : 0
                }
            });
        }

        const {
            fullName,
            phone,
            carMake,
            carModel,
            carYear,
            condition,
            mileage,
            transmission,
            description,
            city,
            sellReason,
            violations,
            expectedPrice
        } = req.body;

        // فحص البيانات المطلوبة
        if (!fullName || !phone || !carMake || !carModel || !carYear) {
            console.log('❌ Required fields missing for sell-car');
            return res.status(400).json({ 
                message: 'البيانات المطلوبة مفقودة',
                required: ['fullName', 'phone', 'carMake', 'carModel', 'carYear']
            });
        }

        // معالجة الصور المرفوعة
        const images = req.files ? req.files.map(file => {
            // إذا كان يستخدم Cloudinary، استخدم الرابط الكامل
            if (file.path && file.path.includes('cloudinary')) {
                return file.path;
            }
            // إذا كان تخزين محلي، استخدم اسم الملف
            return `/uploads/${file.filename || file.originalname}`;
        }) : [];

        // إنشاء طلب بيع سيارة
        const order = new Order({
            customerName: fullName,
            customerPhone: phone,
            items: [{
                partName: `سيارة ${carMake} ${carModel} ${carYear}`,
                quantity: 1,
                images: images
            }],
            carInfo: {
                make: carMake,
                model: carModel,
                year: parseInt(carYear),
                condition: condition,
                mileage: mileage ? parseInt(mileage) : null,
                transmission: transmission
            },
            notes: `حالة السيارة: ${condition}${mileage ? `\nالكيلومترات: ${mileage}` : ''}${transmission ? `\nنوع الجير: ${transmission}` : ''}${sellReason ? `\nسبب البيع: ${sellReason}` : ''}${violations ? `\nالمخالفات: ${violations}` : ''}${description ? `\nوصف إضافي: ${description}` : ''}${expectedPrice ? `\nالسعر المتوقع: ${expectedPrice} ريال` : ''}`,
            shippingAddress: {
                name: fullName,
                phone: phone,
                city: city || 'تبوك',
                details: 'طلب بيع سيارة'
            },
            totalAmount: expectedPrice ? parseInt(expectedPrice) : 0,
            status: 'pending',
            images: images
        });

        try {
            await order.save();
            console.log('✅ تم حفظ طلب بيع السيارة في قاعدة البيانات:', order.orderNumber);
        } catch (dbError) {
            console.error('❌ خطأ في حفظ طلب بيع السيارة في قاعدة البيانات:', dbError.message);
            
            // حفظ الطلب في ملف محلي كبديل
            const fs = require('fs');
            const path = require('path');
            
            try {
                const ordersFile = path.join(__dirname, '../backup_orders.json');
                let backupOrders = [];
                
                if (fs.existsSync(ordersFile)) {
                    const data = fs.readFileSync(ordersFile, 'utf8');
                    backupOrders = JSON.parse(data);
                }
                
                backupOrders.push({
                    ...order.toObject(),
                    savedAt: new Date(),
                    source: 'backup_due_to_db_error',
                    type: 'sell-car'
                });
                
                fs.writeFileSync(ordersFile, JSON.stringify(backupOrders, null, 2));
                console.log('✅ تم حفظ طلب بيع السيارة في الملف الاحتياطي');
            } catch (fileError) {
                console.error('❌ خطأ في حفظ طلب بيع السيارة في الملف الاحتياطي:', fileError.message);
            }
        }

        // إرسال إشعار واتساب فقط
        const notificationData = {
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            orderType: 'طلب بيع سيارة',
            carMake: order.carInfo.make,
            carModel: order.carInfo.model,
            carYear: order.carInfo.year,
            description: order.items[0].partName,
            createdAt: order.createdAt
        };

        // إرسال إشعار واتساب
        try {
            await sendWhatsAppNotification(notificationData);
        } catch (whatsappError) {
            console.error('خطأ في إرسال إشعار الواتساب:', whatsappError);
        }

        res.status(201).json({
            message: 'تم استلام طلب بيع السيارة بنجاح',
            orderNumber: order.orderNumber,
            order: {
                orderNumber: order.orderNumber,
                customerName: order.customerName,
                status: order.status,
                createdAt: order.createdAt
            }
        });
    } catch (error) {
        console.error('❌ Error in POST /sell-car:', error);
        res.status(500).json({ 
            message: 'خطأ في إنشاء طلب بيع السيارة', 
            error: error.message 
        });
    }
});
// WhatsApp Features CSS (moved to a comment to avoid JS syntax errors)
// If you want to use this CSS, place it in your public CSS file, not in this JS file.
/*
.whatsapp-actions {
    padding: 1rem 2rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 1rem;
    align-items: center;
    background: #f8f9fa;
}

.btn-whatsapp {
    background: #25D366;
    color: white;
}

.btn-whatsapp:hover {
    background: #128C7E;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(37, 211, 102, 0.3);
}

.btn-whatsapp:disabled {
    background: #ccc;
    cursor: not-allowed;
}

.phone-link {
    color: #25D366;
    text-decoration: none;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    transition: all 0.2s;
}

.phone-link:hover {
    color: #128C7E;
    text-decoration: underline;
}

.order-checkbox {
    width: 18px;
    height: 18px;
    cursor: pointer;
}

.select-all-checkbox {
    width: 18px;
    height: 18px;
    cursor: pointer;
}

.selected-count {
    background: var(--primary);
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 20px;
    font-size: 0.9rem;
    font-weight: 600;
}
*/
router.post('/admin/send-to-delivery', async (req, res) => {
    try {
        const { orderIds, deliveryPhone } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({ 
                message: 'يرجى تحديد طلبات للإرسال' 
            });
        }

        // استخدام رقم المندوب من الطلب، أو رقم افتراضي
        const deliveryNumber = deliveryPhone || process.env.DELIVERY_WHATSAPP || '966545376792';

        // جلب الطلبات من قاعدة البيانات
        const orders = await Order.find({ _id: { $in: orderIds } });

        if (orders.length === 0) {
            return res.status(404).json({ 
                message: 'لم يتم العثور على الطلبات المحددة' 
            });
        }

        // تجميع كل الطلبات في رسالة واحدة
        let message = `🚚 *طلبات جديدة للتوصيل* 🚚\n\n`;
        message += `📦 *عدد الطلبات:* ${orders.length}\n`;
        message += `📅 *التاريخ:* ${new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n`;
        message += `⏰ *الوقت:* ${new Date().toLocaleTimeString('ar-SA')}\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        orders.forEach((order, index) => {
            const deliveryText = order.deliveryOption === 'express' ? '🔥 مستعجل (1-2 ساعة)' : 
                               order.deliveryOption === 'standard' ? '⚡ سريع (3-5 ساعات)' : 
                               '📋 عادي (12-24 ساعة)';

            const hasImage = !!(order.items?.[0]?.imageUrl || order.items?.[0]?.partImage);

            message += `*${index + 1}. طلب رقم:* ${order.orderNumber}\n`;
            message += `👤 *العميل:* ${order.customerName}\n`;
            message += `📱 *الجوال:* ${order.customerPhone}\n`;
            message += `🚗 *السيارة:* ${order.carInfo?.fullName || (order.carInfo?.make + ' ' + order.carInfo?.model)} ${order.carInfo?.year || ''}\n`;
            message += `🔧 *القطعة:* ${order.items?.[0]?.partName || 'غير محدد'}\n`;
            message += `🚚 *التوصيل:* ${deliveryText}\n`;
            
            if (order.shippingAddress?.city) {
                message += `📍 *المدينة:* ${order.shippingAddress.city}\n`;
            }
            
            if (order.notes) {
                message += `📝 *ملاحظات:* ${order.notes}\n`;
            }
            
            if (hasImage) {
                const imageUrl = order.items[0].imageUrl || order.items[0].partImage;
                message += `📷 *صورة القطعة:* ${imageUrl}\n`;
            }
            
            message += `\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        });

        message += `\n✅ *يرجى البدء بالتوصيل*\n`;
        message += `📞 *للاستفسار:* تواصل مع الإدارة`;

        try {
            // إرسال الرسالة للمندوب
            await sendWhatsAppNotification({
                orderNumber: `BULK-${Date.now()}`,
                customerName: 'المندوب',
                customerPhone: deliveryNumber,
                orderType: 'تحويل للتوصيل',
                description: message,
                createdAt: new Date()
            });

            res.json({
                message: `تم إرسال ${orders.length} طلب للمندوب بنجاح`,
                deliveryNumber: deliveryNumber,
                orderCount: orders.length,
                success: true
            });
        } catch (error) {
            console.error('خطأ في إرسال للمندوب:', error);
            res.status(500).json({
                message: 'فشل الإرسال للمندوب',
                error: error.message,
                success: false
            });
        }
    } catch (error) {
        console.error('❌ Error in POST /admin/send-to-delivery:', error);
        res.status(500).json({ 
            message: 'خطأ في إرسال الطلبات للمندوب', 
            error: error.message 
        });
    }
});
router.post('/admin/send-to-delivery', async (req, res) => {
    try {
        const { orderIds, deliveryPhone } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({ 
                message: 'يرجى تحديد طلبات للإرسال' 
            });
        }

        const deliveryNumber = deliveryPhone || process.env.DELIVERY_WHATSAPP || '966545376792';
        const orders = await Order.find({ _id: { $in: orderIds } });

        if (orders.length === 0) {
            return res.status(404).json({ 
                message: 'لم يتم العثور على الطلبات المحددة' 
            });
        }

        let message = `🚚 *طلبات جديدة للتوصيل*\n\n`;
        message += `📦 عدد الطلبات: ${orders.length}\n`;
        message += `📅 ${new Date().toLocaleDateString('ar-SA')}\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        orders.forEach((order, index) => {
            const deliveryText = order.deliveryOption === 'express' ? '🔥 مستعجل' : 
                               order.deliveryOption === 'standard' ? '⚡ سريع' : '📋 عادي';
            const hasImage = !!(order.items?.[0]?.imageUrl || order.items?.[0]?.partImage);

            message += `*${index + 1}. ${order.orderNumber}*\n`;
            message += `👤 ${order.customerName}\n`;
            message += `📱 ${order.customerPhone}\n`;
            message += `🚗 ${order.carInfo?.fullName || (order.carInfo?.make + ' ' + order.carInfo?.model)} ${order.carInfo?.year || ''}\n`;
            message += `🔧 ${order.items?.[0]?.partName || 'غير محدد'}\n`;
            message += `🚚 ${deliveryText}\n`;
            
            if (order.shippingAddress?.city) {
                message += `📍 ${order.shippingAddress.city}\n`;
            }
            if (order.notes) {
                message += `📝 ${order.notes}\n`;
            }
            if (hasImage) {
                message += `📷 ${order.items[0].imageUrl || order.items[0].partImage}\n`;
            }
            message += `\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        });

        message += `✅ يرجى البدء بالتوصيل`;

        try {
            await sendWhatsAppNotification({
                orderNumber: `BULK-${Date.now()}`,
                customerName: 'المندوب',
                customerPhone: deliveryNumber,
                orderType: 'تحويل للتوصيل',
                description: message,
                createdAt: new Date()
            });

            res.json({
                message: `تم إرسال ${orders.length} طلب للمندوب بنجاح`,
                deliveryNumber: deliveryNumber,
                orderCount: orders.length
            });
        } catch (error) {
            console.error('خطأ في إرسال للمندوب:', error);
            res.status(500).json({
                message: 'فشل الإرسال للمندوب',
                error: error.message
            });
        }
    } catch (error) {
        console.error('❌ Error in POST /admin/send-to-delivery:', error);
        res.status(500).json({ 
            message: 'خطأ في إرسال الطلبات للمندوب', 
            error: error.message 
        });
    }
});

// تحديث السعر والضمان
router.put('/admin/:id/pricing', async (req, res) => {
    try {
        const { price, warranty, warrantyDuration } = req.body;
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'الطلب غير موجود' });
        }

        console.log('📝 Updating pricing:', { price, warranty, warrantyDuration });

        if (order.items && order.items[0]) {
            order.items[0].price = parseFloat(price);
            order.items[0].warranty = warranty;
            order.items[0].warrantyDuration = warrantyDuration;
            
            // حساب تاريخ انتهاء الضمان
            if (warranty && warrantyDuration) {
                const startDate = new Date();
                order.items[0].warrantyStartDate = startDate;
                
                // حساب تاريخ الانتهاء بناءً على المدة
                const endDate = new Date(startDate);
                
                // استخراج الرقم من النص (مثل "3 أشهر" -> 3)
                const durationMatch = warrantyDuration.match(/(\d+)/);
                const durationNumber = durationMatch ? parseInt(durationMatch[1]) : 0;
                
                if (warrantyDuration.includes('يوم')) {
                    endDate.setDate(endDate.getDate() + durationNumber);
                } else if (warrantyDuration.includes('أسبوع')) {
                    endDate.setDate(endDate.getDate() + (durationNumber * 7));
                } else if (warrantyDuration.includes('شهر')) {
                    endDate.setMonth(endDate.getMonth() + durationNumber);
                } else if (warrantyDuration.includes('سنة')) {
                    endDate.setFullYear(endDate.getFullYear() + durationNumber);
                }
                
                order.items[0].warrantyEndDate = endDate;
            }
        }

        order.totalAmount = (parseFloat(price) || 0) + (order.deliveryFee || 0);
        
        order.timeline.push({
            status: 'pricing_updated',
            date: new Date(),
            description: `تم تحديث السعر: ${price} ريال${warranty ? ' - مع ضمان ' + warrantyDuration : ''}`
        });

        await order.save();

        console.log('✅ Pricing updated successfully');

        res.json({
            message: 'تم تحديث السعر والضمان بنجاح',
            order
        });
    } catch (error) {
        console.error('❌ Error updating pricing:', error);
        res.status(500).json({ 
            message: 'خطأ في تحديث السعر', 
            error: error.message 
        });
    }
});

// الحصول على الطلبات الناجحة (المكتملة)
router.get('/admin/completed', async (req, res) => {
    try {
        const completedOrders = await Order.find({ 
            status: 'delivered',
            archived: { $ne: true }
        })
        .sort({ createdAt: -1 })
        .populate('items.partId');

        res.json({
            completedOrders: completedOrders,
            totalCompleted: completedOrders.length
        });
    } catch (error) {
        console.error('❌ Error in GET /admin/completed:', error);
        res.status(500).json({ 
            message: 'خطأ في جلب الطلبات المكتملة', 
            error: error.message 
        });
    }
});

module.exports = router;
