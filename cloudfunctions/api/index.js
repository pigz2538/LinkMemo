const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

const parser = require('./lib/parser')
const format = require('./lib/format')
const { firstLetter } = require('./lib/pinyin')
const { enrichWebItems } = require('./lib/fetcher')

const VALID_TYPES = ['wechat', 'web', 'text', 'mini', 'file', 'image', 'other']
const MAX_INPUT_LENGTH = 30000
const rateBuckets = new Map()

function ok(data) {
  return { code: 0, data }
}

function fail(message, code) {
  return { code: typeof code === 'number' ? code : -1, message: message || '请求失败' }
}

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function maskOpenid(openid) {
  const value = String(openid || '')
  if (value.length <= 8) return 'o****'
  return value.slice(0, 2) + '****' + value.slice(-4)
}

function checkRate(openid, action, limit, windowMs) {
  const key = openid + ':' + action
  const now = Date.now()
  const bucket = rateBuckets.get(key) || { start: now, count: 0 }
  if (now - bucket.start > windowMs) {
    bucket.start = now
    bucket.count = 0
  }
  bucket.count++
  rateBuckets.set(key, bucket)
  if (bucket.count > limit) throw new Error('操作过于频繁，请稍后再试')
}

async function getOrCreateUser(openid, touchLogin) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  let user = res.data[0]
  const now = Date.now()

  if (!user) {
    const data = {
      openid,
      display_name: '微信用户',
      avatar_url: '',
      login_type: '微信登录',
      plan: '个人版',
      created_at: now,
      last_login_at: now,
      status: 'active'
    }
    const added = await db.collection('users').add({ data })
    user = Object.assign({ _id: added._id }, data)
  } else if (touchLogin) {
    await db.collection('users').doc(user._id).update({
      data: { last_login_at: now, status: 'active' }
    })
    user = Object.assign({}, user, { last_login_at: now })
  }

  return user
}

function safeUser(user, openid) {
  return {
    _id: user._id,
    display_name: user.display_name || '微信用户',
    avatar_url: user.avatar_url || '',
    login_type: user.login_type || '微信登录',
    plan: user.plan || '个人版',
    openid_masked: maskOpenid(openid),
    created_at: user.created_at || null,
    last_login_at: user.last_login_at || null,
    status: user.status || 'active'
  }
}

async function loadMeta(userId) {
  const results = await Promise.all([
    db.collection('user_categories').where({ user_id: userId }).orderBy('sort_order', 'asc').limit(200).get(),
    db.collection('user_tags').where({ user_id: userId }).orderBy('created_at', 'asc').limit(500).get()
  ])
  return {
    categories: results[0].data || [],
    tags: results[1].data || []
  }
}

function enrich(item, meta) {
  return format.decorateItem(item, meta.categories, meta.tags)
}

async function login(openid) {
  if (!openid) throw new Error('无法获取微信身份')
  const user = await getOrCreateUser(openid, true)
  return { user: safeUser(user, openid), loggedIn: true, cloudMode: true }
}

async function findExistingKeys(userId, keys) {
  const map = {}
  const groups = chunk(keys, 50)
  for (let i = 0; i < groups.length; i++) {
    const res = await db.collection('archive_items')
      .where({ user_id: userId, dedupe_key: _.in(groups[i]) })
      .field({ dedupe_key: true, deleted_at: true })
      .limit(1000)
      .get()
    res.data.forEach((item) => {
      if (!item.deleted_at) map[item.dedupe_key] = true
    })
  }
  return map
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
  const existing = allowDuplicates ? {} : await findExistingKeys(userId, keys)

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

  const batchId = uid('batch')
  const now = Date.now()
  const inserted = []

  const groups = chunk(selected, 10)
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g]
    const results = await Promise.all(group.map(async (item, index) => {
      const record = {
        user_id: userId,
        batch_id: batchId,
        content_type: item.content_type,
        title: item.title,
        url: item.url,
        domain: item.domain,
        summary: item.summary,
        content: item.content,
        source_text: item.source_text,
        source_sender: item.source_sender || '',
        source_time_label: item.source_time_label || '',
        source_message_at: item.source_message_at || null,
        note: '',
        category_id: null,
        tag_ids: [],
        saved_at: now + inserted.length + index,
        title_initial: item.title_initial,
        title_bucket: item.title_initial === '#' ? 'ZZ' : item.title_initial,
        dedupe_key: item.dedupe_key,
        deleted_at: null,
        fetched_at: item.fetched_at || null,
        fetch_error: item.fetch_error || ''
      }
      const res = await db.collection('archive_items').add({ data: record })
      return Object.assign({ _id: res._id }, record)
    }))
    inserted.push.apply(inserted, results)
  }

  const batch = {
    user_id: userId,
    raw_length: rawText.length,
    total_count: parsed.items.length,
    message_count: parsed.messageCount,
    success_count: inserted.length,
    duplicate_count: duplicates.length,
    failed_count: parsed.failed.length,
    allow_duplicates: allowDuplicates,
    created_at: now
  }
  await db.collection('parse_batches').add({ data: batch })

  return {
    batch_id: batchId,
    items: inserted.map((item) => format.decorateItem(item, [], [])),
    pending_enrich_ids: inserted
      .filter((item) => item.content_type === 'web' && item.url)
      .slice(0, 5)
      .map((item) => item._id),
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
  const ids = Array.isArray(payload.archive_ids) ? payload.archive_ids.slice(0, 10) : []
  if (!ids.length) return { updated_count: 0 }

  const res = await db.collection('archive_items')
    .where({ _id: _.in(ids), user_id: userId, content_type: 'web' })
    .limit(10)
    .get()

  const items = res.data || []
  await enrichWebItems(items)

  let count = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    await db.collection('archive_items').doc(item._id).update({
      data: {
        title: item.title,
        title_initial: item.title_initial,
        title_bucket: item.title_bucket,
        summary: item.summary,
        fetched_at: item.fetched_at || null,
        fetch_error: item.fetch_error || ''
      }
    })
    count++
  }
  return { updated_count: count }
}

function buildListWhere(userId, p) {
  const base = { user_id: userId }
  base.deleted_at = p.recycle ? _.neq(null) : null

  if (p.content_type && p.content_type !== 'all') {
    base.content_type = p.content_type
  }
  if (p.category_id === 'uncategorized') {
    base.category_id = null
  } else if (p.category_id) {
    base.category_id = p.category_id
  }

  const tagIds = Array.isArray(p.tag_ids) ? p.tag_ids.filter(Boolean) : []
  if (tagIds.length) {
    base.tag_ids = p.tag_match === 'or' ? _.in(tagIds) : _.all(tagIds)
  }

  if (p.date_from || p.date_to) {
    if (p.date_from && p.date_to) {
      base.saved_at = _.gte(Number(p.date_from)).and(_.lte(Number(p.date_to)))
    } else if (p.date_from) {
      base.saved_at = _.gte(Number(p.date_from))
    } else {
      base.saved_at = _.lte(Number(p.date_to))
    }
  }

  const keyword = String(p.keyword || '').trim()
  if (!keyword) return base

  const reg = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
  const keywordWhere = _.or([
    { title: reg },
    { url: reg },
    { domain: reg },
    { summary: reg },
    { content: reg },
    { source_text: reg },
    { note: reg }
  ])
  return _.and([base, keywordWhere])
}

async function getArchiveList(userId, payload) {
  const p = payload || {}
  const page = Math.max(Number(p.page) || 1, 1)
  const pageSize = Math.min(Math.max(Number(p.page_size) || 20, 1), 100)
  const where = buildListWhere(userId, p)
  const sort = p.sort || 'saved_desc'
  const [meta, countRes] = await Promise.all([
    loadMeta(userId),
    db.collection('archive_items').where(where).count()
  ])

  let query = db.collection('archive_items').where(where)
  if (sort === 'title_asc') {
    query = query.orderBy('title_bucket', 'asc').orderBy('saved_at', 'desc')
  } else if (sort === 'title_desc') {
    query = query.orderBy('title_bucket', 'desc').orderBy('saved_at', 'desc')
  } else if (sort === 'saved_asc') {
    query = query.orderBy('saved_at', 'asc')
  } else if (sort === 'deleted_desc') {
    query = query.orderBy('deleted_at', 'desc')
  } else {
    query = query.orderBy('saved_at', 'desc')
  }

  const res = await query.skip((page - 1) * pageSize).limit(pageSize).get()
  const records = res.data.map((item) => enrich(item, meta))
  const total = countRes.total

  return {
    records,
    total,
    page,
    has_more: (page - 1) * pageSize + records.length < total,
    next_cursor: (page - 1) * pageSize + records.length < total ? page + 1 : null
  }
}

async function getArchiveDetail(userId, payload) {
  const id = String(payload.archive_id || payload.id || '')
  if (!id) throw new Error('缺少记录 ID')
  const meta = await loadMeta(userId)
  const res = await db.collection('archive_items').where({ _id: id, user_id: userId }).limit(1).get()
  if (!res.data.length) throw new Error('记录不存在或已删除')
  return enrich(res.data[0], meta)
}

async function verifyCategory(userId, categoryId) {
  if (!categoryId) return null
  const res = await db.collection('user_categories')
    .where({ _id: categoryId, user_id: userId })
    .count()
  if (!res.total) throw new Error('分类不存在')
  return categoryId
}

async function verifyTags(userId, tagIds) {
  const ids = Array.isArray(tagIds) ? tagIds.filter(Boolean) : []
  if (!ids.length) return []
  const res = await db.collection('user_tags')
    .where({ _id: _.in(ids), user_id: userId })
    .limit(100)
    .get()
  return res.data.map((item) => item._id)
}

async function updateArchiveInternal(userId, payload) {
  const id = String(payload.archive_id || payload.id || '')
  if (!id) throw new Error('缺少记录 ID')

  const found = await db.collection('archive_items').where({ _id: id, user_id: userId }).limit(1).get()
  if (!found.data.length) throw new Error('记录不存在')
  const item = found.data[0]
  const update = {}

  if (typeof payload.title === 'string') {
    const title = payload.title.trim()
    if (!title) throw new Error('标题不能为空')
    if (title.length > 200) throw new Error('标题不能超过 200 个字符')
    update.title = title
    update.title_initial = firstLetter(title)
    update.title_bucket = update.title_initial === '#' ? 'ZZ' : update.title_initial
  }

  if (typeof payload.url === 'string') {
    const url = payload.url.trim()
    if (url && !/^https?:\/\//i.test(url)) throw new Error('链接需以 http:// 或 https:// 开头')
    update.url = url
    update.domain = url ? parser.getDomain(url) : ''
    if (url) {
      update.dedupe_key = 'u:' + parser.normalizeUrlForKey(url)
      if (item.content_type === 'text' || item.content_type === 'wechat' || item.content_type === 'web') {
        update.content_type = parser.isWechatHost(url) ? 'wechat' : 'web'
      }
    } else if (item.content_type === 'wechat' || item.content_type === 'web') {
      update.content_type = 'text'
    }
  }

  if (typeof payload.note === 'string') update.note = payload.note.slice(0, 2000)
  if (typeof payload.summary === 'string') update.summary = payload.summary.slice(0, 500)
  if (typeof payload.content === 'string') update.content = payload.content.slice(0, MAX_INPUT_LENGTH)

  if (typeof payload.content_type === 'string') {
    if (VALID_TYPES.indexOf(payload.content_type) === -1) throw new Error('内容类型无效')
    update.content_type = payload.content_type
  }

  if (payload.category_id !== undefined) {
    update.category_id = payload.category_id ? await verifyCategory(userId, payload.category_id) : null
  }

  if (Array.isArray(payload.tag_ids)) {
    update.tag_ids = await verifyTags(userId, payload.tag_ids)
  }

  if (Object.keys(update).length) {
    const effectiveUrl = update.url !== undefined ? update.url : item.url
    if (!effectiveUrl) {
      const effectiveType = update.content_type || item.content_type
      const effectiveTitle = update.title || item.title
      const effectiveContent = update.content !== undefined ? update.content : (item.content || item.source_text || '')
      update.dedupe_key = 't:' + parser.hashString(effectiveType + '|' + effectiveTitle + '|' + effectiveContent)
    }
    update.updated_at = Date.now()
    await db.collection('archive_items').doc(id).update({ data: update })
  }

  const meta = await loadMeta(userId)
  const updated = await db.collection('archive_items').where({ _id: id, user_id: userId }).limit(1).get()
  return enrich(updated.data[0], meta)
}

async function batchUpdateArchive(userId, payload) {
  const ids = Array.isArray(payload.archive_ids) ? payload.archive_ids : []
  if (!ids.length) throw new Error('请选择记录')
  const patch = payload.patch || {}
  const results = []
  for (let i = 0; i < ids.length; i++) {
    results.push(await updateArchiveInternal(userId, Object.assign({}, patch, { archive_id: ids[i] })))
  }
  return { updated_count: results.length, items: results }
}

async function batchTag(userId, payload) {
  const ids = Array.isArray(payload.archive_ids) ? payload.archive_ids : []
  const mode = payload.mode === 'remove' ? 'remove' : 'add'
  const tagIds = await verifyTags(userId, payload.tag_ids)
  if (!ids.length) throw new Error('请选择记录')
  if (!tagIds.length) throw new Error('请选择有效标签')

  let count = 0
  for (let i = 0; i < ids.length; i++) {
    const res = await db.collection('archive_items')
      .where({ _id: ids[i], user_id: userId })
      .limit(1)
      .get()
    if (!res.data.length) continue
    const item = res.data[0]
    const current = item.tag_ids || []
    let next
    if (mode === 'remove') {
      next = current.filter((id) => tagIds.indexOf(id) === -1)
    } else {
      next = current.slice()
      tagIds.forEach((id) => {
        if (next.indexOf(id) === -1) next.push(id)
      })
    }
    await db.collection('archive_items').doc(item._id).update({
      data: { tag_ids: next, updated_at: Date.now() }
    })
    count++
  }
  return { updated_count: count }
}

async function deleteArchive(userId, payload) {
  const ids = Array.isArray(payload.archive_ids) ? payload.archive_ids : []
  if (!ids.length) throw new Error('请选择记录')
  const permanent = !!payload.permanent
  const groups = chunk(ids, 50)
  let count = 0

  for (let i = 0; i < groups.length; i++) {
    if (permanent) {
      const res = await db.collection('archive_items')
        .where({ _id: _.in(groups[i]), user_id: userId })
        .remove()
      count += (res.stats && res.stats.removed) || 0
    } else {
      const res = await db.collection('archive_items')
        .where({ _id: _.in(groups[i]), user_id: userId, deleted_at: null })
        .update({ data: { deleted_at: Date.now() } })
      count += (res.stats && res.stats.updated) || 0
    }
  }

  return { deleted_count: count }
}

async function restoreArchive(userId, payload) {
  const ids = Array.isArray(payload.archive_ids) ? payload.archive_ids : []
  if (!ids.length) throw new Error('请选择记录')
  const groups = chunk(ids, 50)
  let count = 0
  for (let i = 0; i < groups.length; i++) {
    const res = await db.collection('archive_items')
      .where({ _id: _.in(groups[i]), user_id: userId, deleted_at: _.neq(null) })
      .update({ data: { deleted_at: null } })
    count += (res.stats && res.stats.updated) || 0
  }
  return { restored_count: count }
}

async function removeAll(collection, where) {
  let removed = 0
  for (let i = 0; i < 20; i++) {
    const res = await db.collection(collection).where(where).remove()
    const n = (res.stats && res.stats.removed) || 0
    removed += n
    if (!n) break
  }
  return removed
}

async function emptyRecycleBin(userId) {
  const removed = await removeAll('archive_items', { user_id: userId, deleted_at: _.neq(null) })
  return { deleted_count: removed }
}

async function getCategories(userId) {
  const [catRes, countRes] = await Promise.all([
    db.collection('user_categories').where({ user_id: userId }).orderBy('sort_order', 'asc').limit(200).get(),
    db.collection('archive_items').aggregate()
      .match({ user_id: userId, deleted_at: null })
      .group({ _id: '$category_id', count: $.sum(1) })
      .end()
  ])
  const counts = {}
  ;(countRes.list || []).forEach((row) => {
    if (row._id) counts[row._id] = row.count
  })
  return (catRes.data || []).map((item) => Object.assign({}, item, {
    usage_count: counts[item._id] || 0
  }))
}

async function getTags(userId) {
  const [tagRes, countRes] = await Promise.all([
    db.collection('user_tags').where({ user_id: userId }).orderBy('created_at', 'asc').limit(500).get(),
    db.collection('archive_items').aggregate()
      .match({ user_id: userId, deleted_at: null })
      .unwind('$tag_ids')
      .group({ _id: '$tag_ids', count: $.sum(1) })
      .end()
  ])
  const counts = {}
  ;(countRes.list || []).forEach((row) => {
    if (row._id) counts[row._id] = row.count
  })
  return (tagRes.data || []).map((item) => Object.assign({}, item, {
    usage_count: counts[item._id] || 0
  }))
}

function validateName(name) {
  const value = String(name || '').trim()
  if (!value) throw new Error('名称不能为空')
  if (value.length > 20) throw new Error('名称不能超过 20 个字符')
  return value
}

async function manageCategory(userId, payload) {
  const action = payload.action || 'create'

  if (action === 'create') {
    const name = validateName(payload.name)
    const dup = await db.collection('user_categories').where({
      user_id: userId,
      name: db.RegExp({ regexp: '^' + escapeRegExp(name) + '$', options: 'i' })
    }).count()
    if (dup.total) throw new Error('分类名称已存在')
    const countRes = await db.collection('user_categories').where({ user_id: userId }).count()
    const data = {
      user_id: userId,
      name,
      color: payload.color || '#2E9E5B',
      sort_order: countRes.total,
      created_at: Date.now(),
      updated_at: Date.now()
    }
    const added = await db.collection('user_categories').add({ data })
    return { category: Object.assign({ _id: added._id }, data) }
  }

  if (action === 'update') {
    const id = String(payload.id || '')
    const found = await db.collection('user_categories').where({ _id: id, user_id: userId }).limit(1).get()
    if (!found.data.length) throw new Error('分类不存在')
    const update = { updated_at: Date.now() }
    if (payload.name !== undefined) {
      const name = validateName(payload.name)
      const dup = await db.collection('user_categories')
        .where({
          user_id: userId,
          name: db.RegExp({ regexp: '^' + escapeRegExp(name) + '$', options: 'i' }),
          _id: _.neq(id)
        })
        .count()
      if (dup.total) throw new Error('分类名称已存在')
      update.name = name
    }
    if (payload.color) update.color = payload.color
    await db.collection('user_categories').doc(id).update({ data: update })
    return { category: Object.assign({}, found.data[0], update) }
  }

  if (action === 'delete') {
    const id = String(payload.id || '')
    const found = await db.collection('user_categories').where({ _id: id, user_id: userId }).limit(1).get()
    if (!found.data.length) throw new Error('分类不存在')
    await db.collection('archive_items')
      .where({ user_id: userId, category_id: id })
      .update({ data: { category_id: null } })
    await db.collection('user_categories').doc(id).remove()
    return { deleted: true }
  }

  throw new Error('未知操作')
}

async function manageTag(userId, payload) {
  const action = payload.action || 'create'

  if (action === 'create') {
    const name = validateName(payload.name)
    const dup = await db.collection('user_tags').where({
      user_id: userId,
      name: db.RegExp({ regexp: '^' + escapeRegExp(name) + '$', options: 'i' })
    }).count()
    if (dup.total) throw new Error('标签名称已存在')
    const data = {
      user_id: userId,
      name,
      color: payload.color || '#2E9E5B',
      created_at: Date.now(),
      updated_at: Date.now()
    }
    const added = await db.collection('user_tags').add({ data })
    return { tag: Object.assign({ _id: added._id }, data) }
  }

  if (action === 'update') {
    const id = String(payload.id || '')
    const found = await db.collection('user_tags').where({ _id: id, user_id: userId }).limit(1).get()
    if (!found.data.length) throw new Error('标签不存在')
    const update = { updated_at: Date.now() }
    if (payload.name !== undefined) {
      const name = validateName(payload.name)
      const dup = await db.collection('user_tags')
        .where({
          user_id: userId,
          name: db.RegExp({ regexp: '^' + escapeRegExp(name) + '$', options: 'i' }),
          _id: _.neq(id)
        })
        .count()
      if (dup.total) throw new Error('标签名称已存在')
      update.name = name
    }
    if (payload.color) update.color = payload.color
    await db.collection('user_tags').doc(id).update({ data: update })
    return { tag: Object.assign({}, found.data[0], update) }
  }

  if (action === 'delete') {
    const id = String(payload.id || '')
    const found = await db.collection('user_tags').where({ _id: id, user_id: userId }).limit(1).get()
    if (!found.data.length) throw new Error('标签不存在')
    await db.collection('archive_items')
      .where({ user_id: userId, tag_ids: id })
      .update({ data: { tag_ids: _.pull(id) } })
    await db.collection('user_tags').doc(id).remove()
    return { deleted: true }
  }

  throw new Error('未知操作')
}

async function getProfileStats(userId) {
  const results = await Promise.all([
    db.collection('archive_items').where({ user_id: userId, deleted_at: null }).count(),
    db.collection('user_categories').where({ user_id: userId }).count(),
    db.collection('user_tags').where({ user_id: userId }).count(),
    db.collection('archive_items').where({ user_id: userId, deleted_at: _.neq(null) }).count(),
    db.collection('archive_items').aggregate()
      .match({ user_id: userId, deleted_at: null })
      .group({ _id: '$content_type', count: $.sum(1) })
      .end()
  ])

  const typeCounts = {}
  ;(results[4].list || []).forEach((row) => {
    if (row._id) typeCounts[row._id] = row.count
  })

  return {
    total_count: results[0].total,
    category_count: results[1].total,
    tag_count: results[2].total,
    recycle_count: results[3].total,
    type_counts: typeCounts
  }
}

async function fetchAllDocs(collection, where, orderField, max) {
  const out = []
  const limit = 100
  const cap = max || 5000
  let skip = 0
  while (out.length < cap) {
    let query = db.collection(collection).where(where)
    if (orderField) query = query.orderBy(orderField, 'desc')
    const res = await query.skip(skip).limit(limit).get()
    out.push.apply(out, res.data)
    if (res.data.length < limit) break
    skip += limit
  }
  return out.slice(0, cap)
}

async function exportData(userId) {
  const results = await Promise.all([
    fetchAllDocs('archive_items', { user_id: userId }, 'saved_at', 5000),
    db.collection('user_categories').where({ user_id: userId }).orderBy('sort_order', 'asc').limit(500).get(),
    db.collection('user_tags').where({ user_id: userId }).orderBy('created_at', 'asc').limit(1000).get()
  ])
  const cats = results[1].data || []
  const tags = results[2].data || []
  const catMap = {}
  const tagMap = {}
  cats.forEach((c) => { catMap[c._id] = c.name })
  tags.forEach((t) => { tagMap[t._id] = t.name })

  const items = results[0].map((item) => Object.assign({}, item, {
    category_name: item.category_id ? (catMap[item.category_id] || '') : '',
    tag_names: (item.tag_ids || []).map((id) => tagMap[id]).filter(Boolean)
  }))

  return {
    exported_at: new Date().toISOString(),
    app: '拾链 LinkMemo',
    version: '1.1.0',
    items,
    categories: cats,
    tags
  }
}

async function clearUserData(userId) {
  await Promise.all([
    removeAll('archive_items', { user_id: userId }),
    removeAll('user_categories', { user_id: userId }),
    removeAll('user_tags', { user_id: userId }),
    removeAll('parse_batches', { user_id: userId })
  ])
  return { cleared: true }
}

exports.main = async (event, context) => {
  const action = event && event.action
  const payload = (event && event.payload) || {}
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    if (action === 'login') {
      return ok(await login(openid))
    }

    if (!openid) return fail('未获取到微信登录状态')

    const user = await getOrCreateUser(openid, false)
    const userId = user._id

    switch (action) {
      case 'parseAndSave':
        checkRate(openid, action, 12, 60 * 1000)
        return ok(await parseAndSave(userId, payload))
      case 'enrichArchive':
        checkRate(openid, action, 10, 60 * 1000)
        return ok(await enrichArchive(userId, payload))
      case 'getArchiveList':
        return ok(await getArchiveList(userId, payload))
      case 'getArchiveDetail':
        return ok(await getArchiveDetail(userId, payload))
      case 'updateArchive':
        return ok(await updateArchiveInternal(userId, payload))
      case 'batchUpdateArchive':
        return ok(await batchUpdateArchive(userId, payload))
      case 'batchTag':
        return ok(await batchTag(userId, payload))
      case 'deleteArchive':
        return ok(await deleteArchive(userId, payload))
      case 'restoreArchive':
        return ok(await restoreArchive(userId, payload))
      case 'emptyRecycleBin':
        return ok(await emptyRecycleBin(userId))
      case 'getCategories':
        return ok(await getCategories(userId))
      case 'getTags':
        return ok(await getTags(userId))
      case 'manageCategory':
        return ok(await manageCategory(userId, payload))
      case 'manageTag':
        return ok(await manageTag(userId, payload))
      case 'getProfileStats':
        return ok(await getProfileStats(userId))
      case 'exportData':
        return ok(await exportData(userId))
      case 'clearUserData':
        return ok(await clearUserData(userId))
      default:
        return fail('未知接口：' + String(action))
    }
  } catch (e) {
    console.error('[api]', action, e && e.message)
    return fail((e && e.message) || '服务异常')
  }
}
