// Cloudflare Pages Function to proxy API requests to GCP Cloud Run

interface Env {
  API_URL: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;

  // Build the target URL
  const apiUrl = env.API_URL || 'https://threadsponder-api-807653282580.us-south1.run.app';
  const path = Array.isArray(params.path) ? params.path.join('/') : params.path || '';
  const url = new URL(request.url);
  const targetUrl = `${apiUrl}/api/${path}${url.search}`;

  // Clone the request with the new URL
  const modifiedRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    redirect: 'follow',
  });

  // Forward the request to the API
  const response = await fetch(modifiedRequest);

  // Return the response with CORS headers
  const modifiedResponse = new Response(response.body, response);
  modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');

  return modifiedResponse;
};
