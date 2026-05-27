// ============================================================
// Parking Daddy — Post-payment booking confirmation
// This runs on Vercel's servers (NOT in the browser).
// After a customer pays via Stripe Checkout, Stripe redirects them
// to success.html with a session_id. That page calls this function
// to: (1) verify the payment actually succeeded, (2) save the
// booking to Supabase with payment_status='paid', and (3) fire off
// confirmation emails to the customer and operator (non-blocking).
// ============================================================
const Stripe = require('stripe');
const sgMail = require('@sendgrid/mail');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { session_id } = req.body;
    if (!session_id) {
      return res.status(400).json({ error: 'Missing session_id' });
    }

    // Ask Stripe: did this checkout session actually result in a payment?
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        error: 'Payment not completed',
        status: session.payment_status
      });
    }

    // Payment confirmed! Now save the booking to Supabase.
    const bookingData = {
      car_info: JSON.parse(session.metadata.car_info),
      phone: session.metadata.phone || '',
      current_location: session.metadata.current_location,
      sweeping_time: session.metadata.sweeping_time,
      key_pickup_notes: session.metadata.key_pickup_notes,
      key_return_notes: session.metadata.key_return_notes,
      calculated_price: parseInt(session.metadata.calculated_price, 10),
      payment_status: 'paid'
    };

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const supabaseResponse = await fetch(
      `${supabaseUrl}/rest/v1/bookings`,
      {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(bookingData)
      }
    );

    if (!supabaseResponse.ok) {
      const errorText = await supabaseResponse.text();
      console.error('Supabase save failed:', errorText);
      return res.status(200).json({
        success: true,
        warning: 'Payment received but booking save failed — contact support',
        amount: session.amount_total / 100
      });
    }

    const [savedBooking] = await supabaseResponse.json();

    // Customer email (Stripe Checkout collects this automatically)
    const customerEmail = session.customer_details?.email || null;

    // Fire-and-forget emails — never block the response.
    // If SendGrid is down or errors, the booking still confirms.
    try {
  await sendEmails({
    bookingData,
    savedBooking,
    customerEmail,
    stripeSessionId: session_id
  });
} catch (err) {
  console.error('Email send error:', err);
}

    return res.status(200).json({
      success: true,
      booking_id: savedBooking.id,
      amount: session.amount_total / 100,
      car_info: bookingData.car_info,
      sweeping_time: bookingData.sweeping_time,
      current_location: bookingData.current_location
    });
  } catch (err) {
    console.error('Confirm booking error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ---------- EMAIL HELPERS ----------

async function sendEmails({ bookingData, savedBooking, customerEmail, stripeSessionId }) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY not set — skipping emails');
    return;
  }

  const FROM = process.env.SENDGRID_FROM_EMAIL || 'hello@parking-daddy.com';
  const OPERATOR = process.env.OPERATOR_EMAIL;

  // Booking ID for display — slice of Supabase row id, matches success page convention
  const shortId = String(savedBooking.id).slice(0, 8).toUpperCase();

  // Build a readable vehicle string from the car_info JSON
  const car = bookingData.car_info || {};
  const vehicleStr = [car.color, car.make, car.model].filter(Boolean).join(' ') || 'Vehicle';
  const plate = car.license_plate || car.plate || '';

  const tasks = [];

  // 1. Customer confirmation email
  if (customerEmail) {
    tasks.push(
      sgMail.send({
        to: customerEmail,
        from: { email: FROM, name: 'Parking Daddy' },
        replyTo: FROM,
        subject: `You're all set — Parking Daddy booking #${shortId}`,
        html: customerEmailHtml({ bookingData, shortId, vehicleStr, plate })
      })
    );
  }

  // 2. Operator alert email
  if (OPERATOR) {
    tasks.push(
      sgMail.send({
        to: OPERATOR,
        from: { email: FROM, name: 'Parking Daddy Bookings' },
        replyTo: FROM,
        subject: `🚗 New booking #${shortId} — ${bookingData.current_location} @ ${bookingData.sweeping_time}`,
        html: operatorEmailHtml({ bookingData, shortId, vehicleStr, plate, customerEmail, stripeSessionId })
      })
    );
  }

  await Promise.allSettled(tasks);
}

function customerEmailHtml({ bookingData, shortId, vehicleStr, plate }) {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f9;color:#1E3A66;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:24px;font-weight:700;color:#1E3A66;">Parking Daddy</div>
      <div style="font-size:13px;color:#6b7a8f;letter-spacing:0.5px;">SF STREET CLEANING VALET</div>
    </div>

    <div style="background:#fff;border-radius:12px;padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="width:56px;height:56px;background:#22c55e;border-radius:50%;margin:0 auto 16px;line-height:56px;color:#fff;font-size:28px;">&check;</div>
        <h1 style="margin:0;font-size:28px;color:#1E3A66;">You're all set.</h1>
        <p style="margin:8px 0 0;color:#6b7a8f;">Payment received. We've got your car covered.</p>
      </div>

      <table width="100%" cellpadding="10" cellspacing="0" style="border-top:1px solid #e5eaf2;margin-top:8px;">
        <tr><td style="color:#6b7a8f;">Booking ID</td><td align="right" style="font-weight:600;">#${shortId}</td></tr>
        <tr><td style="color:#6b7a8f;border-top:1px solid #e5eaf2;">Amount paid</td><td align="right" style="font-weight:600;border-top:1px solid #e5eaf2;">$${bookingData.calculated_price}</td></tr>
        <tr><td style="color:#6b7a8f;border-top:1px solid #e5eaf2;">Vehicle</td><td align="right" style="font-weight:600;border-top:1px solid #e5eaf2;">${vehicleStr}${plate ? ` (${plate})` : ''}</td></tr>
        <tr><td style="color:#6b7a8f;border-top:1px solid #e5eaf2;">Sweep starts</td><td align="right" style="font-weight:600;border-top:1px solid #e5eaf2;">${bookingData.sweeping_time}</td></tr>
        <tr><td style="color:#6b7a8f;border-top:1px solid #e5eaf2;">Location</td><td align="right" style="font-weight:600;border-top:1px solid #e5eaf2;">${bookingData.current_location}</td></tr>
      </table>

      <div style="background:#eef4fb;border-radius:8px;padding:16px;margin-top:24px;font-size:14px;line-height:1.5;">
        <strong>What happens next:</strong> We'll text you within a few hours of your scheduled sweep time to confirm pickup details, our driver's contact info, and where to expect your car returned. For anything urgent, just reply to this email.
      </div>
    </div>

    <p style="text-align:center;font-size:12px;color:#9aa5b8;margin-top:24px;">
      Parking Daddy · San Francisco · <a href="https://www.parking-daddy.com" style="color:#4A90D9;">parking-daddy.com</a>
    </p>
  </div>
</body>
</html>`;
}

function operatorEmailHtml({ bookingData, shortId, vehicleStr, plate, customerEmail, stripeSessionId }) {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1E3A66;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#FF7A1A;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
      <div style="font-size:13px;opacity:0.9;letter-spacing:0.5px;">NEW BOOKING</div>
      <div style="font-size:22px;font-weight:700;">#${shortId}</div>
    </div>

    <div style="background:#fff;border:1px solid #e5eaf2;border-top:0;border-radius:0 0 8px 8px;padding:20px;">
      <table width="100%" cellpadding="8" cellspacing="0" style="font-size:15px;">
        <tr><td style="color:#6b7a8f;width:140px;">Sweep starts</td><td style="font-weight:700;color:#FF7A1A;">${bookingData.sweeping_time}</td></tr>
        <tr><td style="color:#6b7a8f;">Location</td><td style="font-weight:600;">${bookingData.current_location}</td></tr>
        <tr><td style="color:#6b7a8f;">Vehicle</td><td style="font-weight:600;">${vehicleStr}</td></tr>
        <tr><td style="color:#6b7a8f;">Plate</td><td style="font-weight:600;font-family:monospace;">${plate || '—'}</td></tr>
        <tr><td style="color:#6b7a8f;">Customer phone</td><td>${bookingData.phone ? `<a href="tel:${bookingData.phone}" style="color:#4A90D9;font-weight:600;">${bookingData.phone}</a>` : '—'}</td></tr>
        <tr><td style="color:#6b7a8f;">Customer email</td><td>${customerEmail ? `<a href="mailto:${customerEmail}" style="color:#4A90D9;">${customerEmail}</a>` : '—'}</td></tr>
        <tr><td style="color:#6b7a8f;">Amount paid</td><td style="font-weight:600;">$${bookingData.calculated_price}</td></tr>
        ${bookingData.key_pickup_notes ? `<tr><td style="color:#6b7a8f;vertical-align:top;">Key pickup</td><td style="font-style:italic;background:#fff8eb;padding:10px;border-radius:6px;">${bookingData.key_pickup_notes}</td></tr>` : ''}
        ${bookingData.key_return_notes ? `<tr><td style="color:#6b7a8f;vertical-align:top;">Key return</td><td style="font-style:italic;background:#fff8eb;padding:10px;border-radius:6px;">${bookingData.key_return_notes}</td></tr>` : ''}
      </table>

      <div style="margin-top:16px;padding-top:16px;border-top:1px solid #e5eaf2;font-size:12px;color:#9aa5b8;">
        Stripe session: <code style="font-size:11px;">${stripeSessionId}</code>
      </div>
    </div>
  </div>
</body>
</html>`;
}
