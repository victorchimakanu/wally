// CORS is permissive for local dev. In production, set ALLOWED_ORIGIN env var.
export function corsHeaders(): Record<string, string> {
  const origin = process.env["ALLOWED_ORIGIN"] ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
