// ============================================================
// Parking Daddy — Waitlist signup endpoint
// Called by the modal form on index.html (and "we're not live yet" page).
// Saves the signup to Supabase, sends a confirmation email to the user
// and a notification email to the operator.
// ============================================================
const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, zip } = req.body || {};

    // Basic validation
    if (!name || !email || !zip) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!/^\d{5}$/.test(zip)) {
      return res.status(400).json({ error: 'ZIP must be 5 digits' });
    }

    const cleanName = String(name).trim().slice(0, 100);
    const cleanEmail = String(email).trim().toLowerCase().slice(0, 200);
    const cleanZip = String(zip).trim();

    // Save to Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const supabaseResponse = await fetch(
      `${supabaseUrl}/rest/v1/waitlist`,
      {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          name: cleanName,
          email: cleanEmail,
          zip: cleanZip
        })
      }
    );

    // Handle duplicate email gracefully — still respond "success" so we don't
    // tell people "you already signed up" (which they might forget).
    // Postgres unique violation = status 409.
    if (!supabaseResponse.ok && supabaseResponse.status !== 409) {
      const errorText = await supabaseResponse.text();
      console.error('Waitlist save failed:', errorText);
      return res.status(500).json({ error: 'Could not save signup' });
    }

    const isDuplicate = supabaseResponse.status === 409;

    // Send emails (don't block the response if they fail).
    // Skip operator email on duplicates so you're not spammed.
    try {
      await sendWaitlistEmails({
        name: cleanName,
        email: cleanEmail,
        zip: cleanZip,
        isDuplicate
      });
    } catch (err) {
      console.error('Waitlist email error:', err);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Waitlist signup error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ---------- EMAIL HELPERS ----------

async function sendWaitlistEmails({ name, email, zip, isDuplicate }) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY not set — skipping waitlist emails');
    return;
  }

  const FROM = process.env.SENDGRID_FROM_EMAIL || 'hello@parking-daddy.com';
  const OPERATOR = process.env.OPERATOR_EMAIL;

  const tasks = [];

  // 1. Confirmation email to user (send even on duplicates — they'll just
  //    get a "you're already on the list" tone in a future tweak if needed)
  tasks.push(
    sgMail.send({
      to: email,
      from: { email: FROM, name: 'Parking Daddy' },
      replyTo: FROM,
      subject: `You're on the list — Parking Daddy`,
      html: userWaitlistEmailHtml({ name })
    })
  );

  // 2. Operator notification (skip on duplicates — you already know about them)
  if (OPERATOR && !isDuplicate) {
    tasks.push(
      sgMail.send({
        to: OPERATOR,
        from: { email: FROM, name: 'Parking Daddy Waitlist' },
        replyTo: FROM,
        subject: `📋 New waitlist signup — ${name} (${zip})`,
        html: operatorWaitlistEmailHtml({ name, email, zip })
      })
    );
  }

  await Promise.allSettled(tasks);
}

function userWaitlistEmailHtml({ name }) {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f9;color:#1E3A66;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <img src="https://www.parking-daddy.com/parking_daddy_logo.png" alt="Parking Daddy" width="64" height="64" style="display:block;margin:0 auto 10px;width:64px;height:64px;object-fit:contain;" />
      <div style="font-size:24px;font-weight:700;color:#1E3A66;">Parking Daddy</div>
      <div style="font-size:13px;color:#6b7a8f;letter-spacing:0.5px;">SAN FRANCISCO</div>
    </div>

    <div style="background:#ffffff;border-radius:12px;padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      <div style="text-align:center;margin-bottom:24px;">
        <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;"><tr><td width="56" height="56" align="center" valign="middle" style="background:#4A90D9;border-radius:50%;width:56px;height:56px;"><span style="color:#ffffff;font-size:32px;font-weight:bold;line-height:56px;font-family:Arial,sans-serif;">✓</span></td></tr></table>
        <h1 style="margin:0;font-size:28px;color:#1E3A66;">You're on the list, ${escapeHtml(name)}.</h1>
        <p style="margin:12px 0 0;color:#6b7a8f;line-height:1.5;">We're putting the finishing touches on Parking Daddy. You'll be one of the first to hear when we go live.</p>
      </div>

      <div style="background:#eef4fb;border-radius:8px;padding:16px;margin-top:16px;font-size:14px;line-height:1.5;">
        <strong>What is Parking Daddy?</strong><br>
        A street-cleaning valet for San Francisco. We move your car for you when it's parked on a sweep-day side, then bring it back. No more 7am alarms, no more $87 tickets.
      </div>

      <p style="text-align:center;color:#6b7a8f;font-size:14px;margin-top:24px;">
        Questions? Just reply to this email.
      </p>
    </div>

    <p style="text-align:center;font-size:12px;color:#9aa5b8;margin-top:24px;">
      Parking Daddy · San Francisco · <a href="https://www.parking-daddy.com" style="color:#4A90D9;">parking-daddy.com</a>
    </p>
  </div>
</body>
</html>`;
}

function operatorWaitlistEmailHtml({ name, email, zip }) {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#ffffff;color:#1E3A66;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#4A90D9;color:#ffffff;padding:16px 20px;border-radius:8px 8px 0 0;">
      <div style="font-size:13px;opacity:0.9;letter-spacing:0.5px;">NEW WAITLIST SIGNUP</div>
      <div style="font-size:22px;font-weight:700;">${escapeHtml(name)}</div>
    </div>

    <div style="background:#ffffff;border:1px solid #e5eaf2;border-top:0;border-radius:0 0 8px 8px;padding:20px;">
      <table width="100%" cellpadding="8" cellspacing="0" style="font-size:15px;">
        <tr><td style="color:#6b7a8f;width:120px;">Name</td><td style="font-weight:600;">${escapeHtml(name)}</td></tr>
        <tr><td style="color:#6b7a8f;">Email</td><td><a href="mailto:${escapeHtml(email)}" style="color:#4A90D9;font-weight:600;">${escapeHtml(email)}</a></td></tr>
        <tr><td style="color:#6b7a8f;">ZIP</td><td style="font-weight:600;font-family:monospace;">${escapeHtml(zip)}</td></tr>
      </table>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
