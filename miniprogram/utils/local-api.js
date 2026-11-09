const config = require('../config')
const parser = require('./parser')
const format = require('./format')
const { buildSeed } = require('./seed')

const DB_KEY = 'linkmemo_db_v1'
const VALID_TYPES = ['wechat', 'web', 'text', 'mini', 'file', 'image', 'other']
let memoryDb = null

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function loadDb() {
  if (memoryDb) return memoryDb
  let db = null
  try {
    db = wx.getStorageSync(DB_KEY)
  } catch (e) {
    db = null
  }
  if (!db || db.version !== 1) {
    db = buildSeed(Date.now())
    db.loggedIn = true
    saveDb(db)
  }
  if (typeof db.loggedIn !== 'boolean') db.loggedIn = true
  memoryDb = db
  return db
}

function saveDb(db) {
  memoryDb = db
  try {
    wx.setStorageSync(DB_KEY, db)
  } catch (e) {
    console.error('saveDb failed', e)
  }
}

function activeItems(db) {
  return (db.items || []).filter((item) => !item.deleted_at)
}

function findItem(db, id) {
  return (db.items || []).find((item) => item._id === id)
}

function findCategory(db, id) {
  return (db.categories || []).find((item) => item._id === id)
}

function findTag(db, id) {
  return (db.tags || []).find((item) => item._id === id)
}

function categoryUsage(db, categoryId) {
  return activeItems(db).filter((item) => item.category_id === categoryId).length
}

function tagUsage(db, tagId) {
  return activeItems(db).filter((item) => (item.tag_ids || []).indexOf(tagId) !== -1).length
}

function initialRank(initial) {
  if (!initial || initial === '#') return 27
  const code = initial.charCodeAt(0)
  if (code >= 65 && code <= 90) return code - 65
  return 27
}

function matchesKeyword(db, item, keyword) {
  if (!keyword) return true
  const cat = item.category_id ? findCategory(db, item.category_id) : null
  const tagNames = (item.tag_ids || []).map((id) => {
    const tag = findTag(db, id)
    return tag ? tag.name : ''
  })
  const haystack = [
    item.title,
    item.url,
    item.domain,
    item.summary,
    item.content,
    item.source_text,
    item.note,
    cat ? cat.name : '',
    tagNames.join(' ')
  ].join(' ').toLowerCase()
  return haystack.indexOf(keyword.toLowerCase()) !== -1
}

function filterItems(db, params) {
  const p = params || {}
  const recycle = !!p.recycle
  const keyword = String(p.keyword || '').trim()
  const contentType = p.content_type || 'all'
  const categoryId = p.category_id || ''
  const tagIds = Array.isArray(p.tag_ids) ? p.tag_ids.filter(Boolean) : []
  const tagMatch = p.tag_match === 'or' ? 'or' : 'and'
  const dateFrom = p.date_from ? format.startOfDay(p.date_from) : null
  const dateTo = p.date_to ? format.endOfDay(p.date_to) : null

  return (db.items || []).filter((item) => {
    if (recycle) {
      if (!item.deleted_at) return false
    } else if (item.deleted_at) {
      return false
    }
    if (contentType !== 'all' && item.content_type !== contentType) return false
    if (categoryId === 'uncategorized') {
      if (item.category_id) return false
    } else if (categoryId && item.category_id !== categoryId) {
      return false
    }
    if (dateFrom && Number(item.saved_at) < dateFrom) return false
    if (dateTo && Number(item.saved_at) > dateTo) return false
    if (tagIds.length) {
      const ids = item.tag_ids || []
      const hit = tagMatch === 'or'
        ? tagIds.some((id) => ids.indexOf(id) !== -1)
        : tagIds.every((id) => ids.indexOf(id) !== -1)
      if (!hit) return false
    }
    return matchesKeyword(db, item, keyword)
  })
}

function sortItems(items, sort) {
  const list = items.slice()
  const mode = sort || 'saved_desc'
  list.sort((a, b) => {
    if (mode === 'saved_asc') return Number(a.saved_at) - Number(b.saved_at)
    if (mode === 'title_asc' || mode === 'title_desc') {
      const ra = initialRank(a.title_initial)
      const rb = initialRank(b.title_initial)
      if (ra !== rb) return mode === 'title_asc' ? ra - rb : rb - ra
      const cmp = String(a.title || '').localeCompare(String(b.title || ''))
      return mode === 'title_asc' ? cmp : -cmp
    }
    if (mode === 'deleted_desc') return Number(b.deleted_at || 0) - Number(a.deleted_at || 0)
    return Number(b.saved_at) - Number(a.saved_at)
  })
  return list
}

function enrichItems(db, items) {
  return items.map((item) => format.decorateItem(item, db.categories, db.tags))
}

function validateName(name) {
  const value = String(name || '').trim()
  if (!value) throw new Error('名称不能为空')
  if (value.length > 20) throw new Error('名称不能超过 20 个字符')
  return value
}

function nameExists(list, name, excludeId) {
  const target = name.trim().toLowerCase()
  return list.some((item) => item._id !== excludeId && item.name.trim().toLowerCase() === target)
}

const localApi = {
  async init() {
    const db = loadDb()
    return {
      user: clone(db.user),
      loggedIn: db.loggedIn !== false,
      cloudMode: false
    }
  },

  async login() {
    const db = loadDb()
    db.loggedIn = true
    db.user.last_login_at = Date.now()
    saveDb(db)
    return { user: clone(db.user), loggedIn: true }
  },

  async logout() {
    const db = loadDb()
    db.loggedIn = false
    saveDb(db)
    return { loggedIn: false }
  },

  async getSession() {
    const db = loadDb()
    return { user: clone(db.user), loggedIn: db.loggedIn !== false }
  },

  async getArchiveList(params) {
    const db = loadDb()
    const p = Object.assign({ page: 1, page_size: config.pageSize }, params || {})
    const page = Math.max(Number(p.page) || 1, 1)
    const pageSize = Math.min(Math.max(Number(p.page_size) || config.pageSize, 1), 100)
    const filtered = sortItems(filterItems(db, p), p.sort)
    const total = filtered.length
    const start = (page - 1) * pageSize
    const records = enrichItems(db, filtered.slice(start, start + pageSize))
    return {
      records,
      total,
      page,
      has_more: start + records.length < total,
      next_cursor: start + records.length < total ? page + 1 : null
    }
  },

  async getArchiveDetail(id) {
    const db = loadDb()
    const item = findItem(db, id)
    if (!item) throw new Error('记录不存在或已删除')
    return enrichItems(db, [item])[0]
  },

  async parseAndSave(rawText, options) {
    const db = loadDb()
    const text = String(rawText || '')
    if (!text.trim()) throw new Error('请先粘贴微信聊天内容')
    if (text.length > config.maxInputLength) {
      throw new Error('单次输入不能超过 ' + config.maxInputLength + ' 个字符')
    }

    const opts = options || {}
    const allowDuplicates = !!opts.allowDuplicates
    const parsed = parser.parseMessages(text)
    const batchId = uid('batch')
    const now = Date.now()
    const existingKeys = {}
    if (!allowDuplicates) {
      activeItems(db).forEach((item) => {
        if (item.dedupe_key) existingKeys[item.dedupe_key] = true
      })
    }

    const inserted = []
    const duplicates = []
    let failedCount = parsed.failed.length

    parsed.items.forEach((item) => {
      if (!allowDuplicates && existingKeys[item.dedupe_key]) {
        duplicates.push({ title: item.title, url: item.url, content_type: item.content_type })
        return
      }
      if (!allowDuplicates) existingKeys[item.dedupe_key] = true

      const record = Object.assign({}, item, {
        _id: uid('item'),
        user_id: db.user._id,
        batch_id: batchId,
        category_id: null,
        tag_ids: item.tag_ids || [],
        note: '',
        saved_at: now + inserted.length,
        deleted_at: null
      })
      db.items.push(record)
      inserted.push(record)
    })

    const batch = {
      _id: batchId,
      user_id: db.user._id,
      raw_length: text.length,
      total_count: parsed.messageCount,
      success_count: inserted.length,
      duplicate_count: duplicates.length,
      failed_count: failedCount,
      created_at: now,
      allow_duplicates: allowDuplicates
    }
    db.batches.unshift(batch)
    db.batches = db.batches.slice(0, 50)
    saveDb(db)

    return {
      batch_id: batchId,
      items: enrichItems(db, inserted),
      pending_enrich_ids: [],
      success_count: inserted.length,
      duplicate_count: duplicates.length,
      failed_count: failedCount,
      total_count: parsed.messageCount,
      duplicates,
      failures: parsed.failed.slice(0, 10),
      allow_duplicates: allowDuplicates
    }
  },

  async enrichArchive() {
    return { updated_count: 0 }
  },

  async updateArchive(id, patch) {
    const db = loadDb()
    const item = findItem(db, id)
    if (!item) throw new Error('记录不存在')

    const p = patch || {}
    if (typeof p.title === 'string') {
      const title = p.title.trim()
      if (!title) throw new Error('标题不能为空')
      if (title.length > 200) throw new Error('标题不能超过 200 个字符')
      item.title = title
      item.title_initial = require('./pinyin').firstLetter(title)
    }
    if (typeof p.url === 'string') {
      const url = p.url.trim()
      if (url && !/^https?:\/\//i.test(url)) throw new Error('链接需以 http:// 或 https:// 开头')
      item.url = url
      item.domain = url ? parser.getDomain(url) : ''
      if (url) {
        item.dedupe_key = 'u:' + parser.normalizeUrlForKey(url)
        if (item.content_type === 'text' || item.content_type === 'wechat' || item.content_type === 'web') {
          item.content_type = parser.isWechatHost(url) ? 'wechat' : 'web'
        }
      } else if (item.content_type === 'wechat' || item.content_type === 'web') {
        item.content_type = 'text'
      }
    }
    if (typeof p.note === 'string') item.note = p.note.slice(0, 2000)
    if (typeof p.summary === 'string') item.summary = p.summary.slice(0, 500)
    if (typeof p.content === 'string') item.content = p.content.slice(0, config.maxInputLength)
    if (typeof p.content_type === 'string' && VALID_TYPES.indexOf(p.content_type) !== -1) {
      item.content_type = p.content_type
    }
    if (p.category_id !== undefined) {
      if (p.category_id && !findCategory(db, p.category_id)) throw new Error('分类不存在')
      item.category_id = p.category_id || null
    }
    if (Array.isArray(p.tag_ids)) {
      item.tag_ids = p.tag_ids.filter((tagId) => !!findTag(db, tagId))
    }
    if (!item.url) {
      item.dedupe_key = 't:' + parser.hashString(
        item.content_type + '|' + item.title + '|' + (item.content || item.source_text || '')
      )
    }
    item.updated_at = Date.now()
    saveDb(db)
    return enrichItems(db, [item])[0]
  },

  async batchUpdateArchive(ids, patch) {
    const list = Array.isArray(ids) ? ids : [ids]
    const result = []
    for (let i = 0; i < list.length; i++) {
      result.push(await this.updateArchive(list[i], patch))
    }
    return { updated_count: result.length, items: result }
  },

  async batchTag(ids, tagIds, mode) {
    const db = loadDb()
    const list = Array.isArray(ids) ? ids : [ids]
    const tags = (Array.isArray(tagIds) ? tagIds : []).filter((id) => !!findTag(db, id))
    let count = 0
    list.forEach((id) => {
      const item = findItem(db, id)
      if (!item || item.deleted_at) return
      const current = item.tag_ids || []
      let next = current.slice()
      if (mode === 'remove') {
        next = next.filter((tagId) => tags.indexOf(tagId) === -1)
      } else {
        tags.forEach((tagId) => {
          if (next.indexOf(tagId) === -1) next.push(tagId)
        })
      }
      item.tag_ids = next
      item.updated_at = Date.now()
      count++
    })
    saveDb(db)
    return { updated_count: count }
  },

  async deleteArchive(ids) {
    const db = loadDb()
    const list = Array.isArray(ids) ? ids : [ids]
    const now = Date.now()
    let count = 0
    list.forEach((id) => {
      const item = findItem(db, id)
      if (item && !item.deleted_at) {
        item.deleted_at = now
        count++
      }
    })
    saveDb(db)
    return { deleted_count: count }
  },

  async restoreArchive(ids) {
    const db = loadDb()
    const list = Array.isArray(ids) ? ids : [ids]
    let count = 0
    list.forEach((id) => {
      const item = findItem(db, id)
      if (item && item.deleted_at) {
        item.deleted_at = null
        count++
      }
    })
    saveDb(db)
    return { restored_count: count }
  },

  async permanentDelete(ids) {
    const db = loadDb()
    const list = Array.isArray(ids) ? ids : [ids]
    const idMap = {}
    list.forEach((id) => { idMap[id] = true })
    const before = db.items.length
    db.items = db.items.filter((item) => !idMap[item._id])
    saveDb(db)
    return { deleted_count: before - db.items.length }
  },

  async emptyRecycleBin() {
    const db = loadDb()
    const before = db.items.length
    db.items = db.items.filter((item) => !item.deleted_at)
    saveDb(db)
    return { deleted_count: before - db.items.length }
  },

  async getCategories() {
    const db = loadDb()
    return clone(db.categories)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((item) => Object.assign({}, item, { usage_count: categoryUsage(db, item._id) }))
  },

  async getTags() {
    const db = loadDb()
    return clone(db.tags)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((item) => Object.assign({}, item, { usage_count: tagUsage(db, item._id) }))
  },

  async manageCategory(payload) {
    const db = loadDb()
    const p = payload || {}
    const action = p.action || 'create'

    if (action === 'create') {
      const name = validateName(p.name)
      if (nameExists(db.categories, name)) throw new Error('分类名称已存在')
      const category = {
        _id: uid('cat'),
        user_id: db.user._id,
        name,
        color: p.color || '#2E9E5B',
        sort_order: db.categories.length,
        created_at: Date.now(),
        updated_at: Date.now()
      }
      db.categories.push(category)
      saveDb(db)
      return { category: clone(category) }
    }

    if (action === 'update') {
      const category = findCategory(db, p.id)
      if (!category) throw new Error('分类不存在')
      if (p.name !== undefined) {
        const name = validateName(p.name)
        if (nameExists(db.categories, name, category._id)) throw new Error('分类名称已存在')
        category.name = name
      }
      if (p.color) category.color = p.color
      category.updated_at = Date.now()
      saveDb(db)
      return { category: clone(category) }
    }

    if (action === 'delete') {
      const category = findCategory(db, p.id)
      if (!category) throw new Error('分类不存在')
      db.categories = db.categories.filter((item) => item._id !== category._id)
      db.items.forEach((item) => {
        if (item.category_id === category._id) item.category_id = null
      })
      saveDb(db)
      return { deleted: true }
    }

    throw new Error('未知操作')
  },

  async manageTag(payload) {
    const db = loadDb()
    const p = payload || {}
    const action = p.action || 'create'

    if (action === 'create') {
      const name = validateName(p.name)
      if (nameExists(db.tags, name)) throw new Error('标签名称已存在')
      const tag = {
        _id: uid('tag'),
        user_id: db.user._id,
        name,
        color: p.color || '#2E9E5B',
        created_at: Date.now(),
        updated_at: Date.now()
      }
      db.tags.push(tag)
      saveDb(db)
      return { tag: clone(tag) }
    }

    if (action === 'update') {
      const tag = findTag(db, p.id)
      if (!tag) throw new Error('标签不存在')
      if (p.name !== undefined) {
        const name = validateName(p.name)
        if (nameExists(db.tags, name, tag._id)) throw new Error('标签名称已存在')
        tag.name = name
      }
      if (p.color) tag.color = p.color
      tag.updated_at = Date.now()
      saveDb(db)
      return { tag: clone(tag) }
    }

    if (action === 'delete') {
      const tag = findTag(db, p.id)
      if (!tag) throw new Error('标签不存在')
      db.tags = db.tags.filter((item) => item._id !== tag._id)
      db.items.forEach((item) => {
        if (item.tag_ids && item.tag_ids.indexOf(tag._id) !== -1) {
          item.tag_ids = item.tag_ids.filter((id) => id !== tag._id)
        }
      })
      saveDb(db)
      return { deleted: true }
    }

    throw new Error('未知操作')
  },

  async getProfileStats() {
    const db = loadDb()
    const active = activeItems(db)
    const typeCounts = {}
    active.forEach((item) => {
      typeCounts[item.content_type] = (typeCounts[item.content_type] || 0) + 1
    })
    return {
      total_count: active.length,
      category_count: db.categories.length,
      tag_count: db.tags.length,
      recycle_count: db.items.filter((item) => !!item.deleted_at).length,
      type_counts: typeCounts
    }
  },

  async exportData() {
    const db = loadDb()
    return {
      exported_at: new Date().toISOString(),
      app: '拾链 LinkMemo',
      version: config.version,
      user: clone(db.user),
      items: clone(db.items),
      categories: clone(db.categories),
      tags: clone(db.tags)
    }
  },

  async clearUserData() {
    const db = loadDb()
    db.items = []
    db.categories = []
    db.tags = []
    db.batches = []
    saveDb(db)
    return { cleared: true }
  },

  async resetDemoData() {
    const db = buildSeed(Date.now())
    db.loggedIn = true
    saveDb(db)
    return { reset: true }
  }
}

module.exports = localApi
