const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { query, pool } = require('../db')

async function main() {
  const openid = process.argv[2] || 'dev-openid'
  const now = Date.now()
  const result = await query(
    `INSERT INTO users (id, openid, display_name, avatar_url, login_type, plan, status, created_at, last_login_at)
     VALUES ($1, $2, '开发测试用户', '', '开发测试', '个人版', 'active', $3, $3)
     ON CONFLICT (openid) DO UPDATE SET last_login_at = EXCLUDED.last_login_at
     RETURNING *`,
    [crypto.randomUUID(), openid, now]
  )
  const user = result.rows[0]
  const token = jwt.sign(
    { sub: user.id },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )
  console.log(JSON.stringify({ user_id: user.id, openid, token }))
}

main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
}).finally(() => pool.end())
