import { defineConfig, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'

const readJsonBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

const sendJson = (res: ServerResponse, status: number, data: unknown) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(typeof data === 'string' ? data : JSON.stringify(data))
}

const proxyGeminiRequest = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const { model, payload } = await readJsonBody(req)
    const clientKey = req.headers['x-gemini-api-key']
    const apiKey = Array.isArray(clientKey) ? clientKey[0] : clientKey || process.env.GEMINI_API_KEY

    if (!apiKey) {
      sendJson(res, 400, { error: 'API Key not provided. Please enter a Gemini API Key.' })
      return
    }

    if (!model || !payload) {
      sendJson(res, 400, { error: 'Missing Gemini model or payload.' })
      return
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await response.text()

    res.statusCode = response.status
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json')
    res.end(text)
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'Internal server error' })
  }
}

const localApiPlugin = () => ({
  name: 'local-api',
  configureServer(server: ViteDevServer) {
    server.middlewares.use('/api/config', (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' })
        return
      }
      sendJson(res, 200, { hasKey: !!process.env.GEMINI_API_KEY })
    })

    server.middlewares.use('/api/generate-story', (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' })
        return
      }
      void proxyGeminiRequest(req, res)
    })

    server.middlewares.use('/api/generate-image', (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' })
        return
      }
      void proxyGeminiRequest(req, res)
    })

    server.middlewares.use('/api/sync', (_req: IncomingMessage, res: ServerResponse) => {
      sendJson(res, 200, [])
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localApiPlugin()],
})
