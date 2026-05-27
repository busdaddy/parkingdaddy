// ============================================================
// Parking Daddy — Stripe Checkout session creator
// This runs on Vercel's servers (NOT in the browser).
// It takes a booking and returns a URL where the customer
// can pay via Stripe's hosted Checkout page.
// ============================================================

// Import the Stripe library and initialize it with our SECRET key.
// process.env.STRIPE_SECRET_KEY reads from the Vercel environment
// variable we set up — it's never exposed to the browser.
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // Only accept POST requests (the browser will POST booking data here)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Extract the booking data the browser sent us
    const { booking } = req.body;

    if (!booking || !booking.calculated_price) {
      return res.status(400).json({ error: 'Missing booking data' });
    }

    // Build a friendly description for the customer's payment page
    const car = booking.car_info;
    const carDesc = `${car.color} ${car.make} ${car.model} (${car.plate})`;
    const sweepDate = new Date(booking.sweeping_time).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });

    // Create the Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Parking Daddy — Street Cleaning Move',
              description: `${carDesc} • Sweep at ${sweepDate}`
            },
            // Stripe expects amounts in cents, not dollars
            unit_amount: booking.calculated_price * 100
          },
          quantity: 1
        }
      ],
      // After payment, redirect back to our success page
      success_url: `${process.env.SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      // If they cancel, send them back to the booking form
      cancel_url: `${process.env.SITE_URL}/book.html`,
      // Pass the booking data along with the session so we can save it
      // after payment succeeds (in the success page)
      metadata: {
        car_info: JSON.stringify(booking.car_info),
        phone: booking.phone || '',
        current_location: booking.current_location,
        sweeping_time: booking.sweeping_time,
        key_pickup_notes: booking.key_pickup_notes || '',
        key_return_notes: booking.key_return_notes || '',
        calculated_price: String(booking.calculated_price)
      }
    });

    // Send the Checkout URL back to the browser
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: err.message });
  }
};