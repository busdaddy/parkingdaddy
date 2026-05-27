// ============================================================
// Parking Daddy — Post-payment booking confirmation
// This runs on Vercel's servers (NOT in the browser).
// After a customer pays via Stripe Checkout, Stripe redirects them
// to success.html with a session_id. That page calls this function
// to: (1) verify the payment actually succeeded, and (2) save the
// booking to Supabase with payment_status='paid'.
// ============================================================

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    // We do this via Supabase's REST API directly (not the JS library)
    // because we're running in Node, not the browser.
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
      // The payment succeeded but we couldn't save — still return success
      // to the customer (they paid!), but log this so you can fix it manually.
      return res.status(200).json({
        success: true,
        warning: 'Payment received but booking save failed — contact support',
        amount: session.amount_total / 100
      });
    }

    const [savedBooking] = await supabaseResponse.json();

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