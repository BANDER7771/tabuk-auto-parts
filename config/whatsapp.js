// إعدادات إشعارات الواتساب
const axios = require('axios');

// أرقام الواتساب للإدارة
const ADMIN_WHATSAPP_NUMBERS = [
    process.env.ADMIN_WHATSAPP_1, // الرقم الأول
    process.env.ADMIN_WHATSAPP_2  // الرقم الثاني
].filter(number => number);

// إرسال رسالة واتساب باستخدام WhatsApp Business API أو خدمة خارجية
const sendWhatsAppNotification = async (orderData) => {
    if (ADMIN_WHATSAPP_NUMBERS.length === 0) {
        console.log('⚠️ لا توجد أرقام واتساب مُعرفة للإدارة');
        return;
    }

    const message = `
🚨 *طلب جديد - تشاليح تبوك*

📋 *رقم الطلب:* ${orderData.orderNumber}
👤 *اسم العميل:* ${orderData.customerName}
📱 *رقم الجوال:* ${orderData.customerPhone}
🚗 *نوع الطلب:* ${orderData.orderType}

🔧 *تفاصيل الطلب:*
${orderData.description}

📅 *تاريخ الطلب:* ${new Date(orderData.createdAt).toLocaleString('ar-SA')}

⚡ *يرجى المتابعة مع العميل في أقرب وقت*
    `.trim();

    // إرسال لكل رقم إدارة
    for (const phoneNumber of ADMIN_WHATSAPP_NUMBERS) {
        try {
            await sendToWhatsApp(phoneNumber, message);
            console.log(`✅ تم إرسال إشعار واتساب إلى: ${phoneNumber.substring(0, 4)}****`);
        } catch (error) {
            console.error(`❌ خطأ في إرسال واتساب إلى ${phoneNumber.substring(0, 4)}****:`, error.message);
        }
    }
};

// دالة إرسال الرسالة (يمكن استخدام خدمات مختلفة)
const sendToWhatsApp = async (phoneNumber, message) => {
    // الطريقة 1: استخدام WhatsApp Business API (يحتاج إعداد)
    if (process.env.WHATSAPP_API_URL && process.env.WHATSAPP_API_TOKEN) {
        const response = await axios.post(process.env.WHATSAPP_API_URL, {
            phone: phoneNumber,
            message: message
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    }
    
    // الطريقة 2: استخدام خدمة خارجية مثل Twilio
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        
        const result = await twilio.messages.create({
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
            to: `whatsapp:${phoneNumber}`,
            body: message
        });
        return result;
    }
    
    // الطريقة 3: استخدام خدمة مجانية (للاختبار فقط)
    // يمكن استخدام خدمات مثل CallMeBot أو WA.me
    console.log(`📱 رسالة واتساب لـ ${phoneNumber}:`);
    console.log(message);
    console.log(`🔗 رابط الإرسال: https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`);
};

module.exports = {
    sendWhatsAppNotification
};
