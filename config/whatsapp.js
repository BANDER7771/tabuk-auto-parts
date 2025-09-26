// إعدادات إشعارات الواتساب
const axios = require('axios');

// أرقام الواتساب للإدارة
const ADMIN_WHATSAPP_NUMBERS = [
    process.env.ADMIN_WHATSAPP_1, // الرقم الأول
    process.env.ADMIN_WHATSAPP_2  // الرقم الثاني
].filter(number => number);

// إرسال رسالة واتساب باستخدام WhatsApp Business API أو خدمة خارجية
const sendWhatsAppNotification = async (orderData) => {
    console.log('🔍 WhatsApp Debug - بدء إرسال الإشعار');
    console.log('📱 أرقام الإدارة:', ADMIN_WHATSAPP_NUMBERS);
    console.log('🔑 API Key متوفر:', !!process.env.CALLMEBOT_API_KEY);
    
    if (ADMIN_WHATSAPP_NUMBERS.length === 0) {
        console.log('⚠️ لا توجد أرقام واتساب مُعرفة للإدارة');
        console.log('🔧 تحقق من متغير ADMIN_WHATSAPP_1 في Railway');
        return;
    }

    let message;
    
    if (orderData.orderType === 'تحديث حالة الطلب') {
        message = `
🔄 *تحديث حالة طلب - تشاليح تبوك*

📋 *رقم الطلب:* ${orderData.orderNumber}
👤 *العميل:* ${orderData.customerName}
📱 *الجوال:* ${orderData.customerPhone}

📊 *التحديث:* ${orderData.description}

📅 *وقت التحديث:* ${new Date(orderData.createdAt).toLocaleString('ar-SA')}
        `.trim();
    } else {
        message = `
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
    }

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
    try {
        // الطريقة 1: استخدام CallMeBot (مجاني ومباشر)
        if (process.env.CALLMEBOT_API_KEY) {
            const apiKey = process.env.CALLMEBOT_API_KEY;
            const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
            
            const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
            
            console.log(`📞 محاولة إرسال واتساب إلى: ${phoneNumber}`);
            console.log(`🔗 URL: ${url.substring(0, 80)}...`);
            
            const response = await axios.get(url, { timeout: 10000 });
            console.log(`✅ تم إرسال واتساب تلقائي إلى: ${phoneNumber}`);
            console.log(`📊 استجابة CallMeBot:`, response.status, response.statusText);
            return response.data;
        }
        
        // الطريقة 2: استخدام Twilio (الأفضل والأسرع)
        if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
            const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            
            console.log(`📞 إرسال Twilio واتساب إلى: ${phoneNumber}`);
            
            const result = await twilio.messages.create({
                from: 'whatsapp:+14155238886',
                to: `whatsapp:+${phoneNumber}`,
                body: message
            });
            
            console.log(`✅ تم إرسال واتساب Twilio بنجاح!`);
            console.log(`📊 Message SID: ${result.sid}`);
            return result;
        }
        
        // الطريقة 3: استخدام WhatsApp Web API (مجاني)
        if (process.env.WHATSAPP_WEB_API_URL) {
            const response = await axios.post(process.env.WHATSAPP_WEB_API_URL, {
                phone: phoneNumber,
                message: message
            });
            console.log(`✅ تم إرسال واتساب Web API إلى: ${phoneNumber}`);
            return response.data;
        }
        
        // الطريقة 4: رابط مباشر (احتياطي)
        console.log(`📱 رسالة واتساب لـ ${phoneNumber}:`);
        console.log(message);
        console.log(`🔗 رابط الإرسال: https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`);
        
        // محاولة إرسال تلقائي باستخدام webhook بسيط
        try {
            const webhookUrl = `https://api.whatsapp.com/send?phone=${phoneNumber}&text=${encodeURIComponent(message)}`;
            console.log(`🔗 Webhook URL: ${webhookUrl}`);
        } catch (webhookError) {
            console.log('⚠️ Webhook غير متاح');
        }
        
    } catch (error) {
        console.error(`❌ خطأ في إرسال واتساب إلى ${phoneNumber}:`, error.message);
        throw error;
    }
};

module.exports = {
    sendWhatsAppNotification
};
