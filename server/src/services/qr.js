import QRCode from 'qrcode';

// The ticket QR carries the booking reference; scanning it at the gate is what
// looks the booking up, so nothing sensitive needs to live in the image.
const options = { errorCorrectionLevel: 'M', margin: 1, width: 320 };

export const qrPng = (reference) => QRCode.toBuffer(reference, { ...options, type: 'png' });
export const qrDataUrl = (reference) => QRCode.toDataURL(reference, options);
