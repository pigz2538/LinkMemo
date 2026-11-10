const crypto = require('crypto')
const parser = require('./lib/parser')
const format = require('./lib/format')
const { firstLetter } = require('./lib/pinyin')
const { enrichWebItems } = require('./lib/fetcher')
const { query, withTransaction } = require('./db')
const { getSessionUser, safeUser } = require('./auth')

const VALID_TYPES = ['wechat', 'web', 'text', 'mini', 'file', 'image', 'other']
const MAX_INPUT_LENGTH = 30000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function uid() {
  return crypto.randomUUID()
}

function isUuid(value) {
  return UUID_RE.test(String(value || ''))
}

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function addParam(params, value) {
  params.push(value)
  return '$' + params.length
}

function mapItem(row) {
  if (!row) return null
  return {
    _id: row.id,
    user_id: row.user_id,
    batch_id: row.batch_id,
    content_type: row.content_type,
    title: row.title,
    url: row.url,
    domain: row.domain,
    summary: row.summary,
    content: row.content,
    source_text: row.source_text,
    source_sender: row.source_sender,
    source_time_label: row.source_time_label,
    source_message_at: row.source_message_at,
    note: row.note,
    category_id: row.category_id,
    tag_ids: row.tag_ids || [],
    saved_at: row.saved_at,
    title_initial: row.title_initial,
    title_bucket: row.title_bucket,
    dedupe_key: row.dedupe_key,
    deleted_at: row.deleted_at,
    fetched_at: row.fetched_at,
    fetch_error: row.fetch_error,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function mapCategory(row) {
  if (!row) return null
  return {
    _id: row.id,
    user_id: row.user_id,
    name: row.name,
    color: row.color,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
    usage_count: row.usage_count === undefined ? 0 : Number(row.usage_count)
  }
}

function mapTag(row) {
  if (!row) return null
  return {
    _id: row.id,
    user_id: row.user_id,
    name: row.name,
    color: row.color,
    created_at: row.created_at,
    updated_at: row.updated_at,
    usage_count: row.usage_count === undefined ? 0 : Number(row.usage_count)
  }
}

async function loadMeta(userId) {
  const [categories, tags] = await Promise.all([
    query('SELECT * FROM user_categories WHERE user_id = $1 ORDER BY sort_order ASC, created_at ASC', [userId]),
    query('SELECT * FROM user_tags WHERE user_id = $1 ORDER BY created_at ASC', [userId])
  ])
  return {
    categories: categories.rows.map(mapCategory),
    tags: tags.rows.map(mapTag)
  }
}

function decorate(row, meta) {
  return format.decorateItem(mapItem(row), meta.categories, meta.tags)
}

function validateName(name) {
  const value = String(name || '').trim()
  if (!value) throw new Error('名称不能为空')
  if (value.length > 20) throw new Error('名称不能超过 20 个字符')
  return value
}

async function verifyCategory(userId, categoryId) {
  if (!categoryId) return null
  if (!isUuid(categoryId)) throw new Error('分类不存在')
  const result = await query('SELECT id FROM user_categories WHERE id = $1 AND user_id = $2', [categoryId, userId])
  if (!result.rows.length) throw new Error('分类不存在')
  return categoryId
}

async function verifyTags(userId, tagIds) {
  const ids = Array.isArray(tagIds) ? tagIds.filter((id) => isUuid(id)) : []
  if (!ids.length) return []
  const result = await query(
    'SELECT id FROM user_tags WHERE user_id = $1 AND id = ANY($2::uuid[])',
    [userId, ids]
  )
  return result.rows.map((row) => row.id)
}

async function getArchiveList(userId, payload) {
  const p = payload || {}
  const page = Math.max(Number(p.page) || 1, 1)
  const pageSize = Math.min(Math.max(Number(p.page_size) || 20, 1), 100)
  const params = [userId]
  const conditions = ['user_id = $1']

  conditions.push(p.recycle ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL')

  if (p.content_type && p.content_type !== 'all') {
    conditions.push('content_type = ' + addParam(params, String(p.content_type)))
  }

  if (p.category_id === 'uncategorized') {
    conditions.push('category_id IS NULL')
  } else if (p.category_id) {
    if (!isUuid(p.category_id)) throw new Error('分类不存在')
    conditions.push('category_id = ' + addParam(params, p.category_id) + '::uuid')
  }

  if (p.sender) {
    conditions.push('source_sender = ' + addParam(params, String(p.sender).trim()))
  }

  const tagIds = Array.isArray(p.tag_ids) ? p.tag_ids.filter((id) => isUuid(id)) : []
  if (tagIds.length) {
    const placeholder = addParam(params, tagIds) + '::uuid[]'
    conditions.push(p.tag_match === 'or' ? 'tag_ids && ' + placeholder : 'tag_ids @> ' + placeholder)
  }

  if (p.date_from) conditions.push('saved_at >= ' + addParam(params, Number(p.date_from)))
  if (p.date_to) conditions.push('saved_at <= ' + addParam(params, Number(p.date_to)))

  const keyword = String(p.keyword || '').trim()
  if (keyword) {
    const pattern = addParam(params, '%' + keyword + '%')
    conditions.push(
      '(title ILIKE ' + pattern +
      ' OR url ILIKE ' + pattern +
      ' OR domain ILIKE ' + pattern +
      ' OR summary ILIKE ' + pattern +
      ' OR content ILIKE ' + pattern +
      ' OR source_text ILIKE ' + pattern +
      ' OR note ILIKE ' + pattern + ')'
    )
  }

  const where = conditions.join(' AND ')
  const sort = p.sort || 'saved_desc'
  let orderBy = 'saved_at DESC, id DESC'
  if (sort === 'saved_asc') orderBy = 'saved_at ASC, id DESC'
  else if (sort === 'title_asc') orderBy = 'title_bucket ASC, saved_at DESC, id DESC'
  else if (sort === 'title_desc') orderBy = 'title_bucket DESC, saved_at DESC, id DESC'
  else if (sort === 'deleted_desc') orderBy = 'deleted_at DESC, id DESC'

  const offset = (page - 1) * pageSize
  const countParams = params.slice()
  const listParams = params.slice()
  listParams.push(pageSize, offset)

  const [countResult, listResult, meta] = await Promise.all([
    query('SELECT count(*)::int AS total FROM archive_items WHERE ' + where, countParams),
    query(
      'SELECT * FROM archive_items WHERE ' + where +
      ' ORDER BY ' + orderBy +
      ' LIMIT $' + (listParams.length - 1) + ' OFFSET $' + listParams.length,
      listParams
    ),
    loadMeta(userId)
  ])

  const total = Number(countResult.rows[0].total || 0)
  const records = listResult.rows.map((row) => decorate(row, meta))
  return {
    records,
    total,
    page,
    has_more: offset + records.length < total,
    next_cursor: offset + records.length < total ? page + 1 : null
  }
}

async function getArchiveDetail(userId, payload) {
  const id = String(payload.archive_id || payload.id || '')
  if (!isUuid(id)) throw new Error('记录不存在或已删除')
  const result = await query('SELECT * FROM archive_items WHERE id = $1 AND user_id = $2', [id, userId])
  if (!result.rows.length) throw new Error('记录不存在或已删除')
  const meta = await loadMeta(userId)
  return decorate(result.rows[0], meta)
}

async function updateArchiveInternal(userId, payload) {
  const id = String(payload.archive_id || payload.id || '')
  if (!isUuid(id)) throw new Error('记录不存在')

  const found = await query('SELECT * FROM archive_items WHERE id = $1 AND user_id = $2', [id, userId])
  if (!found.rows.length) throw new Error('记录不存在')
  const current = found.rows[0]

  const params = []
  const updates = []
  let effectiveType = current.content_type
  let effectiveUrl = current.url
  let effectiveTitle = current.title
  const dedupeContent = current.source_text || current.content || ''
  let effectiveContent = dedupeContent

  if (typeof payload.title === 'string') {
    const title = payload.title.trim()
    if (!title) throw new Error('标题不能为空')
    if (title.length > 200) throw new Error('标题不能超过 200 个字符')
    effectiveTitle = title
    const initial = firstLetter(title)
    updates.push('title = ' + addParam(params, title))
    updates.push('title_initial = ' + addParam(params, initial))
    updates.push('title_bucket = ' + addParam(params, initial === '#' ? 'ZZ' : initial))
  }

  if (typeof payload.url === 'string') {
    const url = payload.url.trim()
    if (url && !/^https?:\/\//i.test(url)) throw new Error('链接需以 http:// 或 https:// 开头')
    effectiveUrl = url
    updates.push('url = ' + addParam(params, url))
    updates.push('domain = ' + addParam(params, url ? parser.getDomain(url) : ''))
    if (url) {
      if (current.content_type === 'text' || current.content_type === 'wechat' || current.content_type === 'web') {
        effectiveType = parser.isWechatHost(url) ? 'wechat' : 'web'
      }
    } else if (current.content_type === 'wechat' || current.content_type === 'web') {
      effectiveType = 'text'
    }
  }

  if (typeof payload.note === 'string') {
    updates.push('note = ' + addParam(params, payload.note.slice(0, 2000)))
  }
  if (typeof payload.summary === 'string') {
    updates.push('summary = ' + addParam(params, payload.summary.slice(0, 500)))
  }
  if (typeof payload.content === 'string') {
    const content = payload.content.slice(0, MAX_INPUT_LENGTH)
    effectiveContent = content
    updates.push('content = ' + addParam(params, content))
  }
  if (typeof payload.content_type === 'string') {
    if (VALID_TYPES.indexOf(payload.content_type) === -1) throw new Error('内容类型无效')
    effectiveType = payload.content_type
  }

  if (payload.category_id !== undefined) {
    if (payload.category_id) {
      const categoryId = await verifyCategory(userId, payload.category_id)
      updates.push('category_id = ' + addParam(params, categoryId) + '::uuid')
    } else {
      updates.push('category_id = NULL')
    }
  }

  if (Array.isArray(payload.tag_ids)) {
    const tagIds = await verifyTags(userId, payload.tag_ids)
    updates.push('tag_ids = ' + addParam(params, tagIds) + '::uuid[]')
  }

  if (effectiveType !== current.content_type) {
    updates.push('content_type = ' + addParam(params, effectiveType))
  }

  const dedupeKey = effectiveUrl
    ? 'u:' + parser.normalizeUrlForKey(effectiveUrl)
    : 't:' + parser.hashString(effectiveType + '|' + dedupeContent)
  if (dedupeKey !== current.dedupe_key) {
    updates.push('dedupe_key = ' + addParam(params, dedupeKey))
  }

  if (!updates.length) {
    const meta = await loadMeta(userId)
    return decorate(current, meta)
  }

  const now = Date.now()
  updates.push('updated_at = ' + addParam(params, now))
  const idPlaceholder = addParam(params, id)
  const userPlaceholder = addParam(params, userId)
  const result = await query(
    'UPDATE archive_items SET ' + updates.join(', ') +
    ' WHERE id = ' + idPlaceholder + '::uuid AND user_id = ' + userPlaceholder + '::uuid RETURNING *',
    params
  )
  if (!result.rows.length) throw new Error('记录不存在')
  const meta = await loadMeta(userId)
  return decorate(result.rows[0], meta)
}

async function parseAndSave(userId, payload) {
  const rawText = String(payload.raw_text || '')
  if (!rawText.trim()) throw new Error('请先粘贴微信聊天内容')
  if (rawText.length > MAX_INPUT_LENGTH) {
    throw new Error('单次输入不能超过 ' + MAX_INPUT_LENGTH + ' 个字符')
  }

  const allowDuplicates = !!(payload.allowDuplicates || payload.allow_duplicates)
  const parsed = parser.parseMessages(rawText)
  const keys = parsed.items.map((item) => item.dedupe_key)
  let existing = {}

  if (!allowDuplicates && keys.length) {
    const result = await query(
      'SELECT dedupe_key FROM archive_items WHERE user_id = $1 AND deleted_at IS NULL AND dedupe_key = ANY($2::text[])',
      [userId, keys]
    )
    result.rows.forEach((row) => { existing[row.dedupe_key] = true })
  }

  const duplicates = []
  const selected = []
  parsed.items.forEach((item) => {
    if (!allowDuplicates && existing[item.dedupe_key]) {
      duplicates.push({ title: item.title, url: item.url, content_type: item.content_type })
      return
    }
    if (!allowDuplicates) existing[item.dedupe_key] = true
    selected.push(item)
  })

  const batchId = uid()
  const now = Date.now()
  const inserted = []

  await withTransaction(async (client) => {
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i]
      const initial = item.title_initial || firstLetter(item.title)
      const result = await client.query(
        `INSERT INTO archive_items (
          id, user_id, batch_id, content_type, title, url, domain, summary,
          content, source_text, source_sender, source_time_label, source_message_at,
          saved_at, title_initial, title_bucket, dedupe_key, created_at, updated_at
        ) VALUES (
          $1,$2,
          $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
        ) RETURNING *`,
        [
          uid(), userId, batchId, item.content_type, item.title, item.url || '',
          item.domain || '', item.summary || '', item.content || '',
          item.source_text || '', item.source_sender || '', item.source_time_label || '',
          item.source_message_at || null, now + i, initial,
          initial === '#' ? 'ZZ' : initial, item.dedupe_key, now, now
        ]
      )
      inserted.push(result.rows[0])
    }

    await client.query(
      `INSERT INTO parse_batches (
        id, user_id, raw_length, total_count, message_count,
        success_count, duplicate_count, failed_count, allow_duplicates, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        batchId, userId, rawText.length, parsed.items.length, parsed.messageCount,
        inserted.length, duplicates.length, parsed.failed.length, allowDuplicates, now
      ]
    )
  })

  const items = inserted.map((row) => format.decorateItem(mapItem(row), [], []))
  return {
    batch_id: batchId,
    items,
    pending_enrich_ids: inserted
      .filter((row) => row.content_type === 'web' && row.url)
      .slice(0, 5)
      .map((row) => row.id),
    success_count: inserted.length,
    duplicate_count: duplicates.length,
    failed_count: parsed.failed.length,
    total_count: parsed.items.length,
    message_count: parsed.messageCount,
    duplicates,
    failures: parsed.failed.slice(0, 10),
    allow_duplicates: allowDuplicates
  }
}

async function enrichArchive(userId, payload) {
  const ids = Array.isArray(payload.archive_ids) ? payload.archive_ids.filter((id) => isUuid(id)).slice(0, 10) : []
  if (!ids.length) return { updated_count: 0 }

  const result = await query(
    "SELECT * FROM archive_items WHERE user_id = $1 AND id = ANY($2::uuid[]) AND content_type = 'web'",
    [userId, ids]
  )
  const items = result.rows.map(mapItem)
  await enrichWebItems(items)

  let count = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const initial = item.title_initial || firstLetter(item.title)
    await query(
      `UPDATE archive_items
       SET title = $3, title_initial = $4, title_bucket = $5, summary = $6,
           fetched_at = $7, fetch_error = $8, updated_at = $9
       WHERE id = $1 AND user_id = $2`,
      [
        item._id, userId, item.title, initial, initial === '#' ? 'ZZ' : initial,
        item.summary || '', item.fetched_at || null, item.fetch_error || '', Date.now()
      ]
    )
    count++
  }
  return { updated_count: count }
}

async function deleteArchive(userId, payload) {
  const ids = Array.isArray(payload.archive_ids) ? payload.archive_ids.filter((id) => isUuid(id)) : []
  if (!ids.length) throw new Error('请选择记录')
  if (payload.permanent) {
    const result = await query('DELETE FROM archive_items WHERE user_id = $1 AND id = ANY($2::uuid[])', [userId, ids])
    return { deleted_count: result.rowCount || 0 }
  }
  const now = Date.now()
  const result = await query(
    'UPDATE archive_items SET deleted_at = $3, updated_at = $3 WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL',
    [userId, ids, now]
  )
  return { deleted_count: result.rowCount || 0 }
}

async function restoreArchive(userId, payload) {
  const ids = Array.isArray(payload.archive_ids) ? payload.archive_ids.filter((id) => isUuid(id)) : []
  if (!ids.length) throw new Error('请选择记录')
  const result = await query(
    'UPDATE archive_items SET deleted_at = NULL, updated_at = $3 WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NOT NULL',
    [userId, ids, Date.now()]
  )
  return { restored_count: result.rowCount || 0 }
}

async function emptyRecycleBin(userId) {
  const result = await query('DELETE FROM archive_items WHERE user_id = $1 AND deleted_at IS NOT NULL', [userId])
  return { deleted_count: result.rowCount || 0 }
}

async function getCategories(userId) {
  const result = await query(
    `SELECT c.*, COALESCE(x.cnt, 0)::int AS usage_count
     FROM user_categories c
     LEFT JOIN (
       SELECT category_id, count(*)::int AS cnt
       FROM archive_items
       WHERE user_id = $1 AND deleted_at IS NULL AND category_id IS NOT NULL
       GROUP BY category_id
     ) x ON x.category_id = c.id
     WHERE c.user_id = $1
     ORDER BY c.sort_order ASC, c.created_at ASC`,
    [userId]
  )
  return result.rows.map(mapCategory)
}

async function getTags(userId) {
  const result = await query(
    `SELECT t.*, COALESCE(x.cnt, 0)::int AS usage_count
     FROM user_tags t
     LEFT JOIN (
       SELECT tag_id, count(*)::int AS cnt
       FROM archive_items a, unnest(a.tag_ids) AS tag_id
       WHERE a.user_id = $1 AND a.deleted_at IS NULL
       GROUP BY tag_id
     ) x ON x.tag_id = t.id
     WHERE t.user_id = $1
     ORDER BY t.created_at ASC`,
    [userId]
  )
  return result.rows.map(mapTag)
}

async function getSenders(userId) {
  const result = await query(
    `SELECT source_sender AS name, count(*)::int AS count
     FROM archive_items
     WHERE user_id = $1 AND deleted_at IS NULL AND source_sender <> ''
     GROUP BY source_sender
     ORDER BY count DESC, name ASC`,
    [userId]
  )
  return result.rows.map((row) => ({ name: row.name, count: Number(row.count) }))
}

async function manageCategory(userId, payload) {
  const action = payload.action || 'create'

  if (action === 'create') {
    const name = validateName(payload.name)
    const countResult = await query('SELECT count(*)::int AS count FROM user_categories WHERE user_id = $1', [userId])
    try {
      const now = Date.now()
      const result = await query(
        `INSERT INTO user_categories (id, user_id, name, color, sort_order, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
        [uid(), userId, name, payload.color || '#2E9E5B', Number(countResult.rows[0].count), now]
      )
      return { category: mapCategory(result.rows[0]) }
    } catch (e) {
      if (e.code === '23505') throw new Error('分类名称已存在')
      throw e
    }
  }

  if (action === 'update') {
    const id = String(payload.id || '')
    if (!isUuid(id)) throw new Error('分类不存在')
    const found = await query('SELECT * FROM user_categories WHERE id = $1 AND user_id = $2', [id, userId])
    if (!found.rows.length) throw new Error('分类不存在')
    const params = []
    const updates = []
    if (payload.name !== undefined) {
      updates.push('name = ' + addParam(params, validateName(payload.name)))
    }
    if (payload.color) updates.push('color = ' + addParam(params, payload.color))
    updates.push('updated_at = ' + addParam(params, Date.now()))
    const idPlaceholder = addParam(params, id)
    const userPlaceholder = addParam(params, userId)
    try {
      const result = await query(
        'UPDATE user_categories SET ' + updates.join(', ') +
        ' WHERE id = ' + idPlaceholder + '::uuid AND user_id = ' + userPlaceholder + '::uuid RETURNING *',
        params
      )
      return { category: mapCategory(result.rows[0]) }
    } catch (e) {
      if (e.code === '23505') throw new Error('分类名称已存在')
      throw e
    }
  }

  if (action === 'delete') {
    const id = String(payload.id || '')
    if (!isUuid(id)) throw new Error('分类不存在')
    const result = await query('DELETE FROM user_categories WHERE id = $1 AND user_id = $2', [id, userId])
    if (!result.rowCount) throw new Error('分类不存在')
    return { deleted: true }
  }

  throw new Error('未知操作')
}

async function manageTag(userId, payload) {
  const action = payload.action || 'create'

  if (action === 'create') {
    const name = validateName(payload.name)
    try {
      const now = Date.now()
      const result = await query(
        `INSERT INTO user_tags (id, user_id, name, color, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$5) RETURNING *`,
        [uid(), userId, name, payload.color || '#2E9E5B', now]
      )
      return { tag: mapTag(result.rows[0]) }
    } catch (e) {
      if (e.code === '23505') throw new Error('标签名称已存在')
      throw e
    }
  }

  if (action === 'update') {
    const id = String(payload.id || '')
    if (!isUuid(id)) throw new Error('标签不存在')
    const found = await query('SELECT * FROM user_tags WHERE id = $1 AND user_id = $2', [id, userId])
    if (!found.rows.length) throw new Error('标签不存在')
    const params = []
    const updates = []
    if (payload.name !== undefined) {
      updates.push('name = ' + addParam(params, validateName(payload.name)))
    }
    if (payload.color) updates.push('color = ' + addParam(params, payload.color))
    updates.push('updated_at = ' + addParam(params, Date.now()))
    const idPlaceholder = addParam(params, id)
    const userPlaceholder = addParam(params, userId)
    try {
      const result = await query(
        'UPDATE user_tags SET ' + updates.join(', ') +
        ' WHERE id = ' + idPlaceholder + '::uuid AND user_id = ' + userPlaceholder + '::uuid RETURNING *',
        params
      )
      return { tag: mapTag(result.rows[0]) }
    } catch (e) {
      if (e.code === '23505') throw new Error('标签名称已存在')
      throw e
    }
  }

  if (action === 'delete') {
    const id = String(payload.id || '')
    if (!isUuid(id)) throw new Error('标签不存在')
    await withTransaction(async (client) => {
      await client.query(
        'UPDATE archive_items SET tag_ids = array_remove(tag_ids, $2::uuid), updated_at = $3 WHERE user_id = $1 AND $2::uuid = ANY(tag_ids)',
        [userId, id, Date.now()]
      )
      await client.query('DELETE FROM user_tags WHERE id = $1 AND user_id = $2', [id, userId])
    })
    return { deleted: true }
  }

  throw new Error('未知操作')
}

async function getProfileStats(userId) {
  const [counts, types] = await Promise.all([
    query(
      `SELECT
         (SELECT count(*)::int FROM archive_items WHERE user_id = $1 AND deleted_at IS NULL) AS total_count,
         (SELECT count(*)::int FROM user_categories WHERE user_id = $1) AS category_count,
         (SELECT count(*)::int FROM user_tags WHERE user_id = $1) AS tag_count,
         (SELECT count(*)::int FROM archive_items WHERE user_id = $1 AND deleted_at IS NOT NULL) AS recycle_count`,
      [userId]
    ),
    query(
      'SELECT content_type, count(*)::int AS count FROM archive_items WHERE user_id = $1 AND deleted_at IS NULL GROUP BY content_type',
      [userId]
    )
  ])
  const row = counts.rows[0] || {}
  const typeCounts = {}
  types.rows.forEach((item) => { typeCounts[item.content_type] = Number(item.count) })
  return {
    total_count: Number(row.total_count || 0),
    category_count: Number(row.category_count || 0),
    tag_count: Number(row.tag_count || 0),
    recycle_count: Number(row.recycle_count || 0),
    type_counts: typeCounts
  }
}

async function exportData(userId) {
  const [itemsResult, categoriesResult, tagsResult] = await Promise.all([
    query('SELECT * FROM archive_items WHERE user_id = $1 ORDER BY saved_at DESC', [userId]),
    query('SELECT * FROM user_categories WHERE user_id = $1 ORDER BY sort_order ASC, created_at ASC', [userId]),
    query('SELECT * FROM user_tags WHERE user_id = $1 ORDER BY created_at ASC', [userId])
  ])
  const categories = categoriesResult.rows.map(mapCategory)
  const tags = tagsResult.rows.map(mapTag)
  const categoryMap = {}
  const tagMap = {}
  categories.forEach((item) => { categoryMap[item._id] = item.name })
  tags.forEach((item) => { tagMap[item._id] = item.name })
  const items = itemsResult.rows.map((row) => {
    const item = mapItem(row)
    item.category_name = item.category_id ? (categoryMap[item.category_id] || '') : ''
    item.tag_names = (item.tag_ids || []).map((id) => tagMap[id]).filter(Boolean)
    return item
  })
  return {
    exported_at: new Date().toISOString(),
    app: '拾链 LinkMemo',
    version: '1.1.0',
    items,
    categories,
    tags
  }
}

async function clearUserData(userId) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM parse_batches WHERE user_id = $1', [userId])
    await client.query('DELETE FROM archive_items WHERE user_id = $1', [userId])
    await client.query('DELETE FROM user_tags WHERE user_id = $1', [userId])
    await client.query('DELETE FROM user_categories WHERE user_id = $1', [userId])
  })
  return { cleared: true }
}

async function handleAction(action, payload, userId) {
  switch (action) {
    case 'getSession': {
      const user = await getSessionUser(userId)
      if (!user) throw new Error('用户不存在')
      return { user: safeUser(user), loggedIn: true }
    }
    case 'logout':
      return { loggedIn: false }
    case 'parseAndSave':
      return parseAndSave(userId, payload)
    case 'enrichArchive':
      return enrichArchive(userId, payload)
    case 'getArchiveList':
      return getArchiveList(userId, payload)
    case 'getArchiveDetail':
      return getArchiveDetail(userId, payload)
    case 'updateArchive':
      return updateArchiveInternal(userId, payload)
    case 'batchUpdateArchive': {
      const ids = Array.isArray(payload.archive_ids) ? payload.archive_ids : []
      const patch = payload.patch || {}
      const items = []
      for (let i = 0; i < ids.length; i++) {
        items.push(await updateArchiveInternal(userId, Object.assign({ archive_id: ids[i] }, patch)))
      }
      return { updated_count: items.length, items }
    }
    case 'batchTag': {
      const ids = Array.isArray(payload.archive_ids) ? payload.archive_ids.filter((id) => isUuid(id)) : []
      const tagIds = await verifyTags(userId, payload.tag_ids)
      if (!ids.length) throw new Error('请选择记录')
      if (!tagIds.length) throw new Error('请选择有效标签')
      const mode = payload.mode === 'remove' ? 'remove' : 'add'
      let count = 0
      await withTransaction(async (client) => {
        const result = await client.query(
          'SELECT id, tag_ids FROM archive_items WHERE user_id = $1 AND id = ANY($2::uuid[])',
          [userId, ids]
        )
        for (let i = 0; i < result.rows.length; i++) {
          const row = result.rows[i]
          const current = row.tag_ids || []
          let next
          if (mode === 'remove') {
            next = current.filter((id) => tagIds.indexOf(id) === -1)
          } else {
            next = current.slice()
            tagIds.forEach((id) => {
              if (next.indexOf(id) === -1) next.push(id)
            })
          }
          await client.query(
            'UPDATE archive_items SET tag_ids = $1::uuid[], updated_at = $2 WHERE id = $3 AND user_id = $4',
            [next, Date.now(), row.id, userId]
          )
          count++
        }
      })
      return { updated_count: count }
    }
    case 'deleteArchive':
      return deleteArchive(userId, payload)
    case 'restoreArchive':
      return restoreArchive(userId, payload)
    case 'emptyRecycleBin':
      return emptyRecycleBin(userId)
    case 'getCategories':
      return getCategories(userId)
    case 'getTags':
      return getTags(userId)
    case 'getSenders':
      return getSenders(userId)
    case 'manageCategory':
      return manageCategory(userId, payload)
    case 'manageTag':
      return manageTag(userId, payload)
    case 'getProfileStats':
      return getProfileStats(userId)
    case 'exportData':
      return exportData(userId)
    case 'clearUserData':
      return clearUserData(userId)
    default:
      throw new Error('未知接口：' + String(action))
  }
}

module.exports = { handleAction }
