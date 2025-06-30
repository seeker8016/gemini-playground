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
  
  console.log('Target URL:', targetUrl);
  
  const pendingMessages = [];
  const targetWs = new WebSocket(targetUrl);
  
  targetWs.onopen = () => {
    console.log('Connected to Gemini');
    pendingMessages.forEach(msg => targetWs.send(msg));
    pendingMessages.length = 0;
  };

  clientWs.onmessage = (event) => {
    console.log('Client message received');
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(event.data);
    } else {
      pendingMessages.push(event.data);
    }
  };

  targetWs.onmessage = (event) => {
    console.log('Gemini message received');
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(event.data);
    }
  };

  clientWs.onclose = (event) => {
    console.log('Client connection closed');
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.close(1000, event.reason);
    }
  };

  targetWs.onclose = (event) => {
    console.log('Gemini connection closed');
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
    // IMPORTANT: Path adjusted to be relative to the root index.js
    const worker = await import('./src/api_proxy/worker.mjs');
    return await worker.default.fetch(req);
  } catch (error) {
    console.error('API request error:', error);
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
  const url = new URL(req.url);
  console.log(`[PROXY DEBUG] Incoming pathname: ${url.pathname}`);
  console.log(`[PROXY DEBUG] Incoming search: ${url.search}`);
  const targetUrl = `https://generativelanguage.googleapis.com${url.pathname}${url.search}`;
  console.log('Direct Gemini Proxy Target URL:', targetUrl);

  // 1. 从原始请求中提取 API Key
  const auth = req.headers.get("Authorization");
  const apiKey = auth?.split(" ")[1];

  // 2. 创建新的请求头
  const newHeaders = new Headers(req.headers);
  newHeaders.delete('Host'); // 删除原始 Host
  newHeaders.delete('Authorization'); // 删除原始 Authorization

  // 3. 添加 Gemini API 需要的请求头
  if (apiKey) {
    newHeaders.set('x-goog-api-key', apiKey);
  }
  // 模仿 worker.mjs，添加 api-client 头
  newHeaders.set('x-goog-api-client', 'genai-js/0.21.0');

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: newHeaders, // 使用我们构造的新请求头
      body: req.body,
      redirect: 'manual',
    });
    return response;
  } catch (error) {
    console.error('Direct Gemini proxy request error:', error);
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
  console.log(`--- New Request Received ---`);
  console.log(`[REQUEST DEBUG] Full incoming URL: ${req.url}`);
  console.log(`[REQUEST DEBUG] Method: ${req.method}`);
  console.log(`[REQUEST DEBUG] Pathname: ${url.pathname}`);
  console.log('Request URL:', req.url);

  // WebSocket 处理
  if (req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return handleWebSocket(req);
  }

  // Add condition for direct Gemini API paths
  // Gemini API paths typically start with /v1 or /v1beta
  if (url.pathname.startsWith("/v1") || url.pathname.startsWith("/v1beta")) {
    console.log('Detected direct Gemini API request, proxying directly.');
    return handleGeminiDirectProxyRequest(req);
  }

  // Existing check for OpenAI API paths
  if (url.pathname.endsWith("/chat/completions") ||
      url.pathname.endsWith("/embeddings") ||
      url.pathname.endsWith("/models")) {
    console.log('Detected OpenAI API request, delegating to worker.');
    return handleAPIRequest(req);
  }

  // 静态文件处理
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
    console.error('Error details:', e);
    return new Response('Not Found', { 
      status: 404,
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
      }
    });
  }
}

Deno.serve(handleRequest);
