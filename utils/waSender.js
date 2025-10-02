'use strict';

function normalizeToE164(inputPhone) {
    const stringInput = String(inputPhone || '').trim();
    const digitsWithOptionalPlus = stringInput.replace(/[^0-9+]/g, '');
    if (!digitsWithOptionalPlus) {
        throw new Error('Invalid WhatsApp recipient number');
    }
    const hasLeadingPlus = digitsWithOptionalPlus.startsWith('+');
    const withPlus = hasLeadingPlus ? digitsWithOptionalPlus : `+${digitsWithOptionalPlus}`;
    return withPlus.replace(/^\++/, '+');
}

async function sendViaTwilio(client, toPhone, body) {
    const fromEnv = process.env.TWILIO_FROM_WHATSAPP || '';
    const from = fromEnv.startsWith('whatsapp:') ? fromEnv : `whatsapp:${fromEnv}`;
    const normalizedTo = normalizeToE164(toPhone);
    return await client.messages.create({
        from,
        to: `whatsapp:${normalizedTo}`,
        body
    });
}

module.exports = {
    sendViaTwilio
};


