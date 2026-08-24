import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, brevoConfigured } from '../config.js';

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

const parseMailFrom = (fromStr) => {
  const match = fromStr.match(/^(.*?)\s*<(.*?)>$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return { name: 'SeatWise', email: fromStr.trim() };
};

/**
 * Sends one message, falling back to an .eml file in server/outbox when Brevo is
 * not configured. Never throws: a mail problem must not fail a paid booking.
 */
export const sendMail = async ({ to, subject, html, text, attachments }) => {
  try {
    if (brevoConfigured) {
      const sender = parseMailFrom(config.mail.from);
      const payload = {
        sender,
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      };

      if (attachments && attachments.length > 0) {
        payload.attachment = attachments.map((att) => ({
          name: att.filename,
          content: Buffer.isBuffer(att.content) ? att.content.toString('base64') : att.content,
        }));
      }

      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': config.mail.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Brevo API responded with status ${res.status}: ${errorText}`);
      }

      console.log(`mail sent to ${to} via Brevo API: ${subject}`);
      return { delivered: true };
    }

    const emlContent = [
      `From: ${config.mail.from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Content-Type: text/html; charset=utf-8`,
      `MIME-Version: 1.0`,
      ``,
      html || text,
    ].join('\r\n');

    mkdirSync(config.mail.outbox, { recursive: true });
    const rand = Math.random().toString(36).slice(2, 8);
    const file = join(config.mail.outbox, `${Date.now()}-${rand}-${slug(subject)}.eml`);
    writeFileSync(file, emlContent);
    console.log(`mail written to ${file} (set BREVO_API_KEY in .env to send for real)`);
    return { delivered: true, file };
  } catch (err) {
    console.error(`mail to ${to} failed:`, err.message);
    return { delivered: false, error: err.message };
  }
};

const money = (amount) => `INR ${Number(amount).toFixed(2)}`;

const shell = (heading, body) => `
<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2933">
  <h2 style="margin:0 0 4px">SeatWise</h2>
  <h3 style="margin:0 0 16px;font-weight:600">${heading}</h3>
  ${body}
</div>`;

export const sendTicketEmail = async ({ booking, seats, show, qrBuffer }) => {
  const seatList = seats.map((s) => `${s.row_label}${s.seat_number} (${s.category})`).join(', ');
  const when = new Date(show.starts_at).toUTCString();

  const rows = [
    ['Booking reference', booking.reference],
    [show.kind === 'movie' ? 'Movie' : 'Event', show.title],
    ['Venue', `${show.venue_name}, ${show.venue_city}`],
    ['Starts', when],
    ['Seats', seatList],
    ['Amount paid', money(booking.amount)],
  ]
    .map(([k, v]) => `<tr><td style="padding:5px 14px 5px 0;color:#66707a">${k}</td><td style="padding:5px 0"><strong>${v}</strong></td></tr>`)
    .join('');

  return sendMail({
    to: booking.email,
    subject: `SeatWise ticket ${booking.reference} - ${show.title}`,
    text: `Booking confirmed.\nReference: ${booking.reference}\n${show.title}\n${show.venue_name}, ${show.venue_city}\n${when}\nSeats: ${seatList}\nAmount: ${money(booking.amount)}\n\nShow the QR code in the attachment at the entrance.`,
    html: shell(
      'Your booking is confirmed',
      `<table style="border-collapse:collapse;font-size:14px">${rows}</table>
       <p style="font-size:14px">Show this QR code at the entrance.</p>
       <img src="cid:ticket-qr" alt="Ticket QR code for ${booking.reference}" width="220" height="220" />`
    ),
    attachments: [{ filename: `${booking.reference}.png`, content: qrBuffer, cid: 'ticket-qr' }],
  });
};

export const sendWaitlistOfferEmail = async ({ to, show, seat, claimUrl, expiresAt }) => {
  const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60000));

  return sendMail({
    to,
    subject: `A ${seat.category} seat opened up for ${show.title}`,
    text: `A seat came free for ${show.title} at ${show.venue_name}.\nSeat ${seat.row_label}${seat.seat_number} (${seat.category}) is held for you for the next ${minutes} minutes.\nClaim it here: ${claimUrl}\nIf you do not claim it in time the seat goes to the next person in the queue.`,
    html: shell(
      'A seat came free',
      `<p style="font-size:14px">Seat <strong>${seat.row_label}${seat.seat_number}</strong> (${seat.category}) for
        <strong>${show.title}</strong> at ${show.venue_name} is held for you.</p>
       <p style="font-size:14px">You have <strong>${minutes} minutes</strong> to claim it. After that it passes to the next person in the queue.</p>
       <p><a href="${claimUrl}" style="display:inline-block;background:#1f6feb;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-size:14px">Claim this seat</a></p>
       <p style="font-size:12px;color:#66707a">Link: ${claimUrl}</p>`
    ),
  });
};
