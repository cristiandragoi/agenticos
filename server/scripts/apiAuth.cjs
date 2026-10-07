/**
 * Shared helper for CLI scripts calling the AgenticOS backend (CommonJS).
 * Reads AGENTOS_API_TOKEN from process.env and fails closed with a clear message if unset.
 */
function getApiToken() {
  const token = process.env.AGENTOS_API_TOKEN;
  if (!token) {
    console.error('Error: AGENTOS_API_TOKEN environment variable is required to run this script.');
    process.exit(1);
  }
  return token;
}

function authHeaders(extraHeaders = {}) {
  const token = getApiToken();
  return {
    ...extraHeaders,
    'Authorization': `Bearer ${token}`
  };
}

module.exports = {
  getApiToken,
  authHeaders
};
