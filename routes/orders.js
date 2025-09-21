const router = require('express').Router();
const Order = require('../models/Order');

// فحص صحة الخدمة
router.get('/health', (req, res) => res.json({ ok: true, route: 'orders' }));

// إنشاء طلب جديد
router.post('/', async (req, res) => {
    try {
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

        await order.save();

        res.status(201).json({
            message: 'تم استلام طلبك بنجاح',
            id: order.orderNumber,
            order
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
        const orders = await Order.find()
            .sort({ createdAt: -1 })
            .populate('items.partId');
        
        res.json(orders);
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
router.post('/sell-car', async (req, res) => {
    try {
        const {
            fullName,
            phone,
            carMake,
            carModel,
            carYear,
            condition,
            sellReason,
            violations,
            notes
        } = req.body;

        // إنشاء طلب بيع سيارة
        const order = new Order({
            customerName: fullName,
            customerPhone: phone,
            items: [{
                partName: `سيارة ${carMake} ${carModel} ${carYear}`,
                quantity: 1
            }],
            carInfo: {
                make: carMake,
                model: carModel,
                year: carYear,
                condition: condition
            },
            notes: `حالة السيارة: ${condition}${sellReason ? `\nسبب البيع: ${sellReason}` : ''}${violations ? `\nالمخالفات: ${violations}` : ''}${notes ? `\nملاحظات: ${notes}` : ''}`,
            shippingAddress: {
                name: fullName,
                phone: phone,
                city: 'تبوك',
                details: 'طلب بيع سيارة'
            },
            totalAmount: 0, // سيتم تحديده بعد التقييم
            status: 'pending'
        });

        await order.save();

        res.status(201).json({
            message: 'تم استلام طلب بيع السيارة بنجاح',
            orderNumber: order.orderNumber,
            order
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'خطأ في إنشاء طلب بيع السيارة', 
            error: error.message 
        });
    }
});

module.exports = router;