const { Pool, types } = require('pg')

types.setTypeParser(20, (value) => Number(value))

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
})

pool.on('error', (err) => {
  console.error('[pg] idle client error', err.message)
})

async function query(text, params) {
  return pool.query(text, params)
}

async function withTransaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error('[pg] rollback failed', rollbackError.message)
    }
    throw e
  } finally {
    client.release()
  }
}

module.exports = { pool, query, withTransaction }
