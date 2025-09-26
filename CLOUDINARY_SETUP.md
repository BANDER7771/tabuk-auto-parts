# إعداد Cloudinary للتخزين السحابي

## الخطوات المطلوبة:

### 1. إنشاء حساب Cloudinary
- اذهب إلى [cloudinary.com](https://cloudinary.com)
- أنشئ حساب مجاني
- احصل على المعلومات التالية من Dashboard:
  - Cloud Name
  - API Key
  - API Secret

### 2. إضافة المتغيرات البيئية في Render
في لوحة تحكم Render، أضف المتغيرات التالية:

```
CLOUDINARY_CLOUD_NAME=your_cloud_name_here
CLOUDINARY_API_KEY=your_api_key_here
CLOUDINARY_API_SECRET=your_api_secret_here
```

### 3. إعادة نشر التطبيق
بعد إضافة المتغيرات، أعد نشر التطبيق في Render.

## المميزات:
- ✅ تخزين سحابي آمن للصور
- ✅ ضغط تلقائي للصور
- ✅ تحسين الأداء
- ✅ نسخ احتياطية تلقائية
- ✅ CDN عالمي سريع

## البديل:
إذا لم تقم بإعداد Cloudinary، سيستخدم النظام التخزين المحلي تلقائياً.

⚠️ **تنبيه**: التخزين المحلي في Render مؤقت وقد تفقد الصور عند إعادة النشر.
