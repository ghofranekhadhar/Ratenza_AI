import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

// Allow long-running operations (Python RFM pipeline can take up to 60-90s)
export const maxDuration = 120;

async function handleProxy(req: NextRequest) {
  // Long timeout for routes that trigger background Python processing
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 115_000); // 115s safety margin

  try {
    const { pathname, search } = req.nextUrl;
    const targetUrl = `${BACKEND_URL}${pathname}${search}`;

    const headers = new Headers();
    req.headers.forEach((value, key) => {
      // Skip headers that cause issues with Node.js undici fetch:
      // - 'host': must be set by fetch itself to the target
      // - 'connection': managed by the HTTP keep-alive layer
      // - 'expect': Expect: 100-continue is not supported by undici (UND_ERR_NOT_SUPPORTED)
      // - 'content-length': will be recomputed from the body buffer
      const SKIP = new Set(['host', 'connection', 'expect', 'content-length']);
      if (!SKIP.has(key.toLowerCase())) {
        headers.set(key, value);
      }
    });

    const options: RequestInit = {
      method: req.method,
      headers,
      signal: controller.signal,
      cache: 'no-store',
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const body = await req.clone().arrayBuffer();
      options.body = body;
    }

    const response = await fetch(targetUrl, options);
    clearTimeout(timeoutId);

    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      responseHeaders.set(key, value);
    });
    responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const data = await response.arrayBuffer();

    return new NextResponse(data, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error?.name === 'AbortError') {
      console.error('Proxy Timeout: Backend took too long to respond.');
      return NextResponse.json(
        { error: 'Le backend a mis trop de temps à répondre (>115s).', details: 'AbortError' },
        { status: 504 }
      );
    }
    console.error('Proxy Error:', error);
    return NextResponse.json(
      { error: 'Failed to proxy request', details: error.message },
      { status: 502 }
    );
  }
}

export const GET = handleProxy;
export const POST = handleProxy;
export const PUT = handleProxy;
export const DELETE = handleProxy;
export const PATCH = handleProxy;
export const OPTIONS = handleProxy;
