const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }
  const sql = fs.readFileSync(path.join(__dirname, 'sql', 'schema.sql'), 'utf8')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    await pool.query(sql)
    console.log('database schema migrated')
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
