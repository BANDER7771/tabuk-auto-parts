const router = require('express').Router();
const Order = require('../models/Order');
const { sendWhatsAppNotification } = require('../config/whatsapp');
const upload = require('../middleware/upload');

// فحص صحة الخدمة
router.get('/health', (req, res) => res.json({ ok: true, route: 'orders' }));

// إنشاء طلب جديد
router.post('/', async (req, res) => {
    try {
        // فحص وجود البيانات مع تشخيص مفصل
        console.log('🔍 Order Request debugging:');
        console.log('- Content-Type:', req.headers['content-type']);
        console.log('- Body exists:', !!req.body);
        console.log('- Body keys:', req.body ? Object.keys(req.body) : 'No body');
        console.log('- Raw body:', req.body);

        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({ 
                message: 'لم يتم استلام البيانات بشكل صحيح',
                error: 'Request body is undefined or empty',
                debug: {
                    contentType: req.headers['content-type'],
                    bodyExists: !!req.body,
                    bodyKeys: req.body ? Object.keys(req.body) : []
                }
            });
        }

        const {
            fullName,
            phone,
            carMake,
            carModel,
            carYear,
            vin,
            partDetails,
            urgency,
            notes,
            email,
            city
        } = req.body;

        // فحص البيانات المطلوبة
        if (!fullName || !phone || !carMake || !carModel || !partDetails) {
            return res.status(400).json({ 
                message: 'البيانات المطلوبة مفقودة',
                required: ['fullName', 'phone', 'carMake', 'carModel', 'partDetails']
            });
        }

        // إنشاء رقم طلب فريد
        const orderNumber = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();

        // إنشاء طلب جديد
        const order = new Order({
            orderNumber: orderNumber,
            customerName: fullName,
            customerPhone: phone,
            customerEmail: email,
            items: [{
                partName: partDetails,
                quantity: 1
            }],
            carInfo: {
                make: carMake,
                model: carModel,
                year: carYear,
                vin: vin
            },
            urgency: urgency || 'normal',
            notes: notes,
            shippingAddress: {
                name: fullName,
                phone: phone,
                city: city || 'تبوك',
                district: '',
                street: '',
                details: notes
            },
            totalAmount: 0, // سيتم تحديده لاحقاً
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
        const notificationData = {
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            orderType: 'طلب قطع غيار',
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
            message: 'تم استلام طلبك بنجاح',
            id: order.orderNumber,
            order: {
                orderNumber: order.orderNumber,
                customerName: order.customerName,
                status: order.status,
                createdAt: order.createdAt
            }
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'خطأ في إنشاء الطلب', 
            error: error.message 
        });
    }
});

// الحصول على جميع الطلبات (للوحة الإدارة)
router.get('/admin', async (req, res) => {
    try {
        let orders = [];
        let backupOrders = [];
        
        // محاولة جلب الطلبات من قاعدة البيانات
        try {
            orders = await Order.find()
                .sort({ createdAt: -1 })
                .populate('items.partId');
        } catch (dbError) {
            console.error('خطأ في جلب الطلبات من قاعدة البيانات:', dbError.message);
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
                console.error('خطأ في قراءة الطلبات الاحتياطية:', fileError.message);
            }
        }
        
        res.json({
            orders: orders,
            backupOrders: backupOrders,
            totalOrders: orders.length + backupOrders.length,
            dbStatus: orders.length > 0 ? 'connected' : 'disconnected'
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'خطأ في جلب الطلبات', 
            error: error.message 
        });
    }
});

// تحديث حالة الطلب للإدارة
router.put('/admin/:id/status', async (req, res) => {
    try {
        const { status, description } = req.body;
        
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
            console.error('خطأ في إرسال إشعار واتساب لتحديث الحالة:', whatsappError);
        }

        res.json({
            message: 'تم تحديث حالة الطلب',
            order
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'خطأ في تحديث الطلب', 
            error: error.message 
        });
    }
});

// تتبع الطلبات بالجوال
router.get('/track/:phone', async (req, res) => {
    try {
        const orders = await Order.find({ 
            customerPhone: req.params.phone 
        }).sort({ createdAt: -1 });
        
        res.json(orders);
    } catch (error) {
        res.status(500).json({ 
            message: 'خطأ في تتبع الطلبات', 
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

        res.json({
            message: 'تم تحديث حالة الطلب',
            order
        });
    } catch (error) {
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

        res.json({ 
            message: 'تم إلغاء الطلب بنجاح' 
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'خطأ في إلغاء الطلب', 
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
        console.log('- Files:', req.files ? req.files.length : 0);

        if (!req.body || Object.keys(req.body).length === 0) {
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

        // معالجة الصور المرفوعة
        const images = req.files ? req.files.map(file => {
            // إذا كان يستخدم Cloudinary، استخدم الرابط الكامل
            if (file.path && file.path.includes('cloudinary')) {
                return file.path;
            }
            // إذا كان تخزين محلي، استخدم اسم الملف
            return file.filename || file.originalname;
        }) : [];

        // فحص البيانات المطلوبة
        if (!fullName || !phone || !carMake || !carModel || !carYear) {
            return res.status(400).json({ 
                message: 'البيانات المطلوبة مفقودة',
                required: ['fullName', 'phone', 'carMake', 'carModel', 'carYear']
            });
        }

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
        res.status(500).json({ 
            message: 'خطأ في إنشاء طلب بيع السيارة', 
            error: error.message 
        });
    }
});

module.exports = router;