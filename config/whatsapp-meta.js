// config/whatsapp-meta.js
// Shim خفيف لسد النقص في 'whatsapp-meta' باستخدام Twilio أو no-op

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_WHATSAPP,
  ADMIN_WHATSAPP_1,
  DELIVERY_WHATSAPP,
} = process.env;

let client = null;
try {
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    // محاولة تحميل Twilio SDK
    client = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    console.log('✅ Twilio WhatsApp client initialized');
  } else {
    console.warn('[whatsapp-meta] Twilio credentials not configured, notifications will be skipped');
  }
} catch (e) {
  // لا تفشل التشغيل بسبب غياب المكتبة في بيئات محدودة
  console.warn('[whatsapp-meta shim] Twilio SDK not available, falling back to no-op.');
}

const normalizeWhatsApp = (num) => {
  if (!num) return null;
  const n = String(num).replace(/[^\d]/g, '');
  return n.startsWith('whatsapp:') ? n : `whatsapp:+${n}`;
};

async function sendWhatsApp(to, body) {
  // alias عام للاستخدامات الأكثر شيوعًا
  if (!client || !TWILIO_FROM_WHATSAPP) {
    console.warn('[whatsapp-meta] Skipping send (not configured).', { to, body: body?.substring(0, 50) });
    return { skipped: true };
  }
  const from = normalizeWhatsApp(TWILIO_FROM_WHATSAPP);
  const dest = normalizeWhatsApp(to);
  if (!from || !dest) {
    console.warn('[whatsapp-meta] Invalid numbers:', { from, dest });
    return { skipped: true, reason: 'invalid numbers' };
  }
  
  try {
    const result = await client.messages.create({ from, to: dest, body });
    console.log('✅ WhatsApp message sent:', result.sid);
    return result;
  } catch (error) {
    console.error('❌ WhatsApp send failed:', error.message);
    return { skipped: true, error: error.message };
  }
}

// دالة إرسال إشعار الطلب (المستخدمة في orders.js)
async function sendOrderNotification(data) {
  const {
    orderNumber,
    customerName,
    customerPhone,
    orderType = 'طلب قطع غيار',
    carMake,
    carModel,
    carYear,
    carFullName,
    description,
    createdAt,
    hasImage
  } = data;

  // تنسيق الرسالة
  let message = `🔔 *إشعار ${orderType} جديد*\n\n`;
  message += `📋 *رقم الطلب:* ${orderNumber}\n`;
  message += `👤 *العميل:* ${customerName}\n`;
  message += `📱 *الجوال:* ${customerPhone}\n`;
  
  if (carFullName || (carMake && carModel)) {
    message += `🚗 *السيارة:* ${carFullName || `${carMake} ${carModel}`} ${carYear || ''}\n`;
  }
  
  if (description) {
    message += `📝 *التفاصيل:*\n${description}\n`;
  }
  
  if (hasImage) {
    message += `📷 *الطلب يحتوي على صورة*\n`;
  }
  
  message += `\n📅 *التاريخ:* ${new Date(createdAt).toLocaleString('ar-SA')}\n`;
  message += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `✅ *يرجى متابعة الطلب*`;

  // إرسال للإدارة
  const adminNumber = ADMIN_WHATSAPP_1;
  if (adminNumber) {
    await sendWhatsApp(adminNumber, message);
  } else {
    console.warn('[whatsapp-meta] Admin WhatsApp number not configured');
  }

  return { success: true, message: 'Notification sent or skipped' };
}

// aliases لتغطية أي أسماء دوال محتملة في orders.js بدون تعديل الراوت
const sendMessage = sendWhatsApp;
const sendTemplateMessage = sendWhatsApp;
const sendWhatsAppNotification = sendOrderNotification; // alias للأسماء المختلفة المستخدمة في الكود

module.exports = {
  sendWhatsApp,
  sendMessage,
  sendTemplateMessage,
  sendOrderNotification,
  sendWhatsAppNotification,
  numbers: {
    admin: ADMIN_WHATSAPP_1 ? `+${String(ADMIN_WHATSAPP_1).replace(/[^\d]/g, '')}` : undefined,
    delivery: DELIVERY_WHATSAPP ? `+${String(DELIVERY_WHATSAPP).replace(/[^\d]/g, '')}` : undefined,
  },
};


