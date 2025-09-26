# استخدام Node.js 20 كصورة أساسية
FROM node:20-alpine

# تعيين مجلد العمل
WORKDIR /app

# نسخ ملفات package
COPY package*.json ./

# تثبيت التبعيات
RUN npm ci --only=production

# نسخ باقي الملفات
COPY . .

# إنشاء مجلد uploads
RUN mkdir -p uploads

# تعيين المتغيرات البيئية
ENV NODE_ENV=production
ENV PORT=3000

# فتح البورت
EXPOSE 3000

# تشغيل التطبيق
CMD ["npm", "start"]
