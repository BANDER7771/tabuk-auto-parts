// إعدادات إشعارات الواتساب
const axios = require('axios');

function parseAdminNumbers() {
    const numbers = [];

    if (process.env.ADMIN_WHATSAPP_NUMBERS) {
        numbers.push(
            ...process.env.ADMIN_WHATSAPP_NUMBERS
                .split(',')
                .map(num => num && num.trim())
                .filter(Boolean)
        );
    }

    numbers.push(process.env.ADMIN_WHATSAPP_1);
    numbers.push(process.env.ADMIN_WHATSAPP_2);

    const uniqueNumbers = [...new Set(numbers.filter(Boolean))];

    if (uniqueNumbers.length === 0 && process.env.NODE_ENV !== 'production') {
        console.warn('⚠️ لم يتم تعريف أرقام واتساب في المتغيرات البيئية. سيتم استخدام رقم افتراضي للتطوير فقط.');
        return ['966545376792'];
    }

    return uniqueNumbers;
}

const ADMIN_WHATSAPP_NUMBERS = parseAdminNumbers();

const hasConfiguredProvider = () => {
    return Boolean(
        process.env.CALLMEBOT_API_KEY ||
        (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ||
        process.env.WHATSAPP_WEB_API_URL
    );
};

class WhatsAppConfigurationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'WhatsAppConfigurationError';
    }
}

// إرسال رسالة واتساب باستخدام WhatsApp Business API أو خدمة خارجية
const sendWhatsAppNotification = async (orderData) => {
    console.log('🔍 WhatsApp Debug - بدء إرسال الإشعار');
    console.log('📱 أرقام الإدارة:', ADMIN_WHATSAPP_NUMBERS);
    console.log('🔑 طرق الإرسال المتاحة:', {
        ADMIN_WHATSAPP_NUMBERS: ADMIN_WHATSAPP_NUMBERS.length,
        CALLMEBOT_API_KEY: !!process.env.CALLMEBOT_API_KEY,
        TWILIO: !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN,
        WHATSAPP_WEB_API_URL: !!process.env.WHATSAPP_WEB_API_URL
    });
    
    if (ADMIN_WHATSAPP_NUMBERS.length === 0) {
        throw new WhatsAppConfigurationError('لا توجد أرقام واتساب مُعرفة للإدارة. يرجى ضبط ADMIN_WHATSAPP_NUMBERS أو ADMIN_WHATSAPP_1.');
    }

    if (!hasConfiguredProvider()) {
        throw new WhatsAppConfigurationError('لا توجد طريقة إرسال واتساب مفعلة. يرجى تفعيل CALLMEBOT_API_KEY أو إعداد Twilio أو ضبط WHATSAPP_WEB_API_URL.');
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

    let successCount = 0;
    const errors = [];

    for (const phoneNumber of ADMIN_WHATSAPP_NUMBERS) {
        try {
            await sendToWhatsApp(phoneNumber, message);
            successCount += 1;
            console.log(`✅ تم إرسال إشعار واتساب إلى: ${phoneNumber.substring(0, 4)}****`);
        } catch (error) {
            const errorMessage = error.response?.data || error.message;
            errors.push(`${phoneNumber}: ${errorMessage}`);
            console.error(`❌ خطأ في إرسال واتساب إلى ${phoneNumber.substring(0, 4)}****:`, errorMessage);
        }
    }

    if (successCount === 0) {
        throw new Error(`فشل إرسال إشعارات الواتساب لجميع الأرقام. التفاصيل: ${errors.join(' | ')}`);
    }
};

// دالة إرسال الرسالة (يمكن استخدام خدمات مختلفة)
const sendToWhatsApp = async (phoneNumber, message) => {
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');

    try {
        if (process.env.CALLMEBOT_API_KEY) {
            const apiKey = process.env.CALLMEBOT_API_KEY;
            
            const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
            
            console.log(`📞 محاولة إرسال واتساب إلى: ${phoneNumber}`);
            console.log(`🔗 URL: ${url.substring(0, 80)}...`);
            
            const response = await axios.get(url, { timeout: 10000 });
            const responseText = typeof response.data === 'string' ? response.data.toLowerCase() : '';
            if (responseText.includes('error') || responseText.includes('not accepted')) {
                throw new Error(`CallMeBot returned an error: ${response.data}`);
            }
            console.log(`✅ تم إرسال واتساب تلقائي إلى: ${phoneNumber}`);
            console.log(`📊 استجابة CallMeBot:`, response.status, response.statusText);
            return response.data;
        }

        if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
            const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            const { sendViaTwilio } = require('../utils/waSender');

            console.log(`📞 إرسال Twilio واتساب إلى: ${phoneNumber}`);

            const result = await sendViaTwilio(twilioClient, cleanPhone, message);

            console.log(`✅ تم إرسال واتساب Twilio بنجاح!`);
            console.log(`📊 Message SID: ${result.sid}`);
            return result;
        }

        if (process.env.WHATSAPP_WEB_API_URL) {
            const response = await axios.post(process.env.WHATSAPP_WEB_API_URL, {
                phone: cleanPhone,
                message: message
            });
            console.log(`✅ تم إرسال واتساب Web API إلى: ${phoneNumber}`);
            return response.data;
        }

        throw new WhatsAppConfigurationError('لا توجد طريقة متاحة لإرسال رسائل واتساب. يرجى تفعيل CallMeBot أو Twilio أو API خارجي.');

    } catch (error) {
        console.error(`❌ خطأ في إرسال واتساب إلى ${phoneNumber}:`, error.message);
        throw error;
    }
};

// تم إزالة دالة البريد الإلكتروني - نستخدم الواتساب فقط

module.exports = {
    sendWhatsAppNotification
};
