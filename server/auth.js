const crypto = require('crypto')
const axios = require('axios')
const jwt = require('jsonwebtoken')
const { query } = require('./db')

function maskOpenid(openid) {
  const value = String(openid || '')
  if (value.length <= 8) return 'o****'
  return value.slice(0, 2) + '****' + value.slice(-4)
}

function safeUser(user) {
  if (!user) return null
  return {
    _id: user.id,
    display_name: user.display_name || '微信用户',
    avatar_url: user.avatar_url || '',
    login_type: user.login_type || '微信登录',
    plan: user.plan || '个人版',
    openid_masked: maskOpenid(user.openid),
    created_at: user.created_at,
    last_login_at: user.last_login_at,
    status: user.status || 'active'
  }
}

async function upsertWechatUser(openid, unionid) {
  const now = Date.now()
  const result = await query(
    `INSERT INTO users (id, openid, display_name, avatar_url, login_type, plan, status, created_at, last_login_at)
     VALUES ($1, $2, '微信用户', '', '微信登录', '个人版', 'active', $3, $3)
     ON CONFLICT (openid)
     DO UPDATE SET last_login_at = EXCLUDED.last_login_at
     RETURNING *`,
    [crypto.randomUUID(), openid, now]
  )
  return result.rows[0]
}

async function loginWithWechatCode(code) {
  if (!process.env.WECHAT_APPID || !process.env.WECHAT_SECRET) {
    const err = new Error('服务端尚未配置微信 AppID / AppSecret')
    err.status = 503
    throw err
  }
  if (!code) {
    const err = new Error('缺少微信登录 code')
    err.status = 400
    throw err
  }

  let response
  try {
    response = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
      params: {
        appid: process.env.WECHAT_APPID,
        secret: process.env.WECHAT_SECRET,
        js_code: code,
        grant_type: 'authorization_code'
      },
      timeout: 8000
    })
  } catch (e) {
    const err = new Error('微信登录服务请求失败')
    err.status = 502
    throw err
  }

  const data = response.data || {}
  if (data.errcode || !data.openid) {
    const err = new Error('微信登录失败：' + (data.errmsg || '未获取到 openid'))
    err.status = 401
    throw err
  }

  const user = await upsertWechatUser(data.openid, data.unionid)
  const token = jwt.sign(
    { sub: user.id },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  )
  return { token, user: safeUser(user), loggedIn: true, cloudMode: false }
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET)
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ code: 401, message: '请先登录' })
    return
  }
  try {
    const payload = verifyToken(header.slice(7))
    req.userId = payload.sub
    next()
  } catch (e) {
    res.status(401).json({ code: 401, message: '登录已过期，请重新登录' })
  }
}

async function getSessionUser(userId) {
  const result = await query('SELECT * FROM users WHERE id = $1', [userId])
  return result.rows[0] || null
}

module.exports = {
  loginWithWechatCode,
  verifyToken,
  authMiddleware,
  getSessionUser,
  safeUser,
  maskOpenid
}
