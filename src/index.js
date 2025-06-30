// --- DEPLOYMENT TEST v4 ---
// If you see this comment in your Deno Deploy source view, the deployment is working.

const getContentType = (path) => {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const types = {
    'js': 'application/javascript',
    'css': 'text/css',
    'html': 'text/html',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif'
  };
  return types[ext] || 'text/plain';
};

async function handleWebSocket(req) {
  const { socket: clientWs, response } = Deno.upgradeWebSocket(req);
  
  const url = new URL(req.url);
  const targetUrl = `wss://generativelanguage.googleapis.com${url.pathname}${url.search}`;
  
  const pendingMessages = [];
  const targetWs = new WebSocket(targetUrl);
  
  targetWs.onopen = () => {
    pendingMessages.forEach(msg => targetWs.send(msg));
    pendingMessages.length = 0;
  };

  clientWs.onmessage = (event) => {
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(event.data);
    } else {
      pendingMessages.push(event.data);
    }
  };

  targetWs.onmessage = (event) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(event.data);
    }
  };

  clientWs.onclose = (event) => {
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.close(1000, event.reason);
    }
  };

  targetWs.onclose = (event) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(event.code, event.reason);
    }
  };

  targetWs.onerror = (error) => {
    console.error('Gemini WebSocket error:', error);
  };

  return response;
}

async function handleAPIRequest(req) {
  try {
    const worker = await import('./src/api_proxy/worker.mjs');
    return await worker.default.fetch(req);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorStatus = (error).status || 500;
    return new Response(errorMessage, {
      status: errorStatus,
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
      }
    });
  }
}

async function handleGeminiDirectProxyRequest(req) {
  console.log('--- ENTERING PROXY v4 ---'); // V4 of the code
  const url = new URL(req.url);
  let correctedPathname = url.pathname;

  if (correctedPathname.includes('/v1/v1beta')) {
    console.log(`[PROXY FIX v4] Path before fix: '${correctedPathname}'`);
    correctedPathname = correctedPathname.replace('/v1/v1beta', '/v1beta');
    console.log(`[PROXY FIX v4] Path after fix: '${correctedPathname}'`);
  }

  const targetUrl = `https://generativelanguage.googleapis.com${correctedPathname}${url.search}`;
  console.log('[PROXY v4] Final Target URL:', targetUrl);

  const auth = req.headers.get("Authorization");
  const apiKey = auth?.split(" ")[1];

  const newHeaders = new Headers(req.headers);
  newHeaders.delete('Host');
  newHeaders.delete('Authorization');

  if (apiKey) {
    newHeaders.set('x-goog-api-key', apiKey);
  }
  newHeaders.set('x-goog-api-client', 'genai-js/0.21.0');

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: newHeaders,
      body: req.body,
      redirect: 'manual',
    });
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorStatus = (error).status || 500;
    return new Response(errorMessage, {
      status: errorStatus,
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
      }
    });
  }
}

async function handleRequest(req) {
  const url = new URL(req.url);

  if (req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return handleWebSocket(req);
  }

  if (url.pathname.startsWith("/v1") || url.pathname.startsWith("/v1beta")) {
    return handleGeminiDirectProxyRequest(req);
  }

  if (url.pathname.endsWith("/chat/completions") ||
      url.pathname.endsWith("/embeddings") ||
      url.pathname.endsWith("/models")) {
    return handleAPIRequest(req);
  }

  try {
    let filePath = url.pathname;
    if (filePath === '/' || filePath === '/index.html') {
      filePath = '/index.html';
    }
    const fullPath = `${Deno.cwd()}/src/static${filePath}`;
    const file = await Deno.readFile(fullPath);
    const contentType = getContentType(filePath);
    return new Response(file, {
      headers: {
        'content-type': `${contentType};charset=UTF-8`,
      },
    });
  } catch (e) {
    return new Response('Not Found', { 
      status: 404,
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
      }
    });
  }
}

Deno.serve(handleRequest);