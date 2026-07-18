import app from '../server/dist/index.js';

// IMPORTANT: This disables Vercel's default body parser.
// This is strictly required so that `express.raw()` inside the Stripe webhook 
// can access the raw request body to validate cryptographic signatures.
export const config = {
  api: {
    bodyParser: false,
  },
};

export default app;
