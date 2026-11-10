const express = require('express')
const { loginWithWechatCode, authMiddleware } = require('./auth')
const { handleAction } = require('./handlers')
const { pool } = require('./db')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is required')
  process.exit(1)
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({
      ok: true,
      service: 'linkmemo-api',
      database: 'ok',
      time: new Date().toISOString()
    })
  } catch (e) {
    res.status(503).json({ ok: false, service: 'linkmemo-api', database: 'error' })
  }
})

app.post('/api', (req, res, next) => {
  if (req.body && req.body.action === 'login') return next()
  return authMiddleware(req, res, next)
}, async (req, res) => {
  const { action, payload } = req.body || {}
  if (!action) {
    res.status(400).json({ code: 400, message: '缺少 action' })
    return
  }

  try {
    let data
    if (action === 'login') {
      data = await loginWithWechatCode((payload || {}).code)
    } else {
      data = await handleAction(action, payload || {}, req.userId)
    }
    res.json({ code: 0, data })
  } catch (e) {
    const status = Number(e.status) || 400
    if (status >= 500) {
      console.error('[api]', action, e.message)
    }
    res.status(status).json({
      code: status === 401 ? 401 : -1,
      message: e.message || '请求失败'
    })
  }
})

app.use((req, res) => {
  res.status(404).json({ code: 404, message: 'Not found' })
})

async function start() {
  try {
    await pool.query('SELECT 1')
    const port = Number(process.env.PORT || 3000)
    const server = app.listen(port, '127.0.0.1', () => {
      console.log('LinkMemo API listening on 127.0.0.1:' + port)
    })
    const shutdown = async () => {
      server.close(async () => {
        await pool.end()
        process.exit(0)
      })
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
  } catch (e) {
    console.error('database connection failed:', e.message)
    process.exit(1)
  }
}

if (require.main === module) {
  start()
}

module.exports = app
