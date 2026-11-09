const assert = require('assert')
const Module = require('module')

const store = {
  users: [],
  archive_items: [],
  user_categories: [],
  user_tags: [],
  parse_batches: []
}
let currentOpenid = 'openid-a'
let idSeq = 0

function uid(prefix) {
  idSeq++
  return prefix + '_' + idSeq
}

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function deepEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  return JSON.stringify(a) === JSON.stringify(b)
}

function makeCmd(op, value) {
  return {
    __cmd: op,
    value,
    and(other) {
      return { __cmd: '__fieldAnd', values: [this, other] }
    },
    or(other) {
      return { __cmd: '__fieldOr', values: [this, other] }
    }
  }
}

const command = {
  eq: (v) => makeCmd('eq', v),
  neq: (v) => makeCmd('neq', v),
  gt: (v) => makeCmd('gt', v),
  gte: (v) => makeCmd('gte', v),
  lt: (v) => makeCmd('lt', v),
  lte: (v) => makeCmd('lte', v),
  in: (v) => makeCmd('in', v),
  nin: (v) => makeCmd('nin', v),
  all: (v) => makeCmd('all', v),
  exists: (v) => makeCmd('exists', v),
  pull: (v) => makeCmd('pull', v),
  and: (values) => ({ __queryOp: 'and', values }),
  or: (values) => ({ __queryOp: 'or', values }),
  aggregate: {
    sum: (value) => ({ __agg: 'sum', value })
  }
}

function matchValue(value, condition) {
  if (condition && condition.__regexp) {
    return new RegExp(condition.regexp, condition.options || '').test(String(value == null ? '' : value))
  }
  if (condition && condition.__cmd) {
    switch (condition.__cmd) {
      case 'eq':
        return deepEqual(value, condition.value)
      case 'neq':
        return !deepEqual(value, condition.value)
      case 'gt':
        return value > condition.value
      case 'gte':
        return value >= condition.value
      case 'lt':
        return value < condition.value
      case 'lte':
        return value <= condition.value
      case 'in':
        if (Array.isArray(value)) {
          return value.some((item) => condition.value.some((expected) => deepEqual(item, expected)))
        }
        return condition.value.some((expected) => deepEqual(value, expected))
      case 'nin':
        if (Array.isArray(value)) {
          return !value.some((item) => condition.value.some((expected) => deepEqual(item, expected)))
        }
        return !condition.value.some((expected) => deepEqual(value, expected))
      case 'all':
        if (!Array.isArray(value)) return false
        return condition.value.every((expected) => value.some((item) => deepEqual(item, expected)))
      case 'exists':
        return condition.value ? value !== undefined : value === undefined
      case '__fieldAnd':
        return condition.values.every((item) => matchValue(value, item))
      case '__fieldOr':
        return condition.values.some((item) => matchValue(value, item))
      default:
        return false
    }
  }
  if (condition === null) return value === null || value === undefined
  if (Array.isArray(value) && (typeof condition !== 'object' || condition === null)) {
    return value.some((item) => deepEqual(item, condition))
  }
  return deepEqual(value, condition)
}

function matchQuery(doc, query) {
  if (!query) return true
  if (query.__queryOp === 'and') return query.values.every((item) => matchQuery(doc, item))
  if (query.__queryOp === 'or') return query.values.some((item) => matchQuery(doc, item))
  return Object.keys(query).every((key) => matchValue(doc[key], query[key]))
}

function applyUpdate(doc, data) {
  Object.keys(data).forEach((key) => {
    const value = data[key]
    if (value && value.__cmd === 'pull') {
      const current = Array.isArray(doc[key]) ? doc[key].slice() : []
      const targets = Array.isArray(value.value) ? value.value : [value.value]
      doc[key] = current.filter((item) => !targets.some((target) => deepEqual(item, target)))
      return
    }
    if (value && value.__cmd === 'inc') {
      doc[key] = (Number(doc[key]) || 0) + Number(value.value)
      return
    }
    doc[key] = clone(value)
  })
}

function compareValues(a, b) {
  if (a === b) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

function sortRows(rows, orders) {
  if (!orders.length) return rows
  return rows.slice().sort((a, b) => {
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i]
      const cmp = compareValues(a[order.field], b[order.field])
      if (cmp !== 0) return order.direction === 'desc' ? -cmp : cmp
    }
    return 0
  })
}

function projectRow(doc, projection) {
  if (!projection) return clone(doc)
  const out = { _id: doc._id }
  Object.keys(projection).forEach((key) => {
    if (projection[key]) out[key] = clone(doc[key])
  })
  return out
}

function createAggregate(name) {
  const stages = []
  const api = {
    match(query) {
      stages.push({ type: 'match', query })
      return api
    },
    unwind(field) {
      stages.push({ type: 'unwind', field })
      return api
    },
    group(spec) {
      stages.push({ type: 'group', spec })
      return api
    },
    sort(spec) {
      stages.push({ type: 'sort', spec })
      return api
    },
    limit(n) {
      stages.push({ type: 'limit', n })
      return api
    },
    async end() {
      let rows = store[name].map(clone)
      stages.forEach((stage) => {
        if (stage.type === 'match') {
          rows = rows.filter((row) => matchQuery(row, stage.query))
          return
        }
        if (stage.type === 'unwind') {
          const field = String(stage.field || '').replace(/^\$/, '')
          const next = []
          rows.forEach((row) => {
            const value = row[field]
            if (Array.isArray(value)) {
              value.forEach((item) => {
                const copy = clone(row)
                copy[field] = clone(item)
                next.push(copy)
              })
            } else if (value !== undefined && value !== null) {
              next.push(row)
            }
          })
          rows = next
          return
        }
        if (stage.type === 'group') {
          const idExpr = stage.spec._id
          const countExpr = stage.spec.count
          const groups = {}
          rows.forEach((row) => {
            const id = typeof idExpr === 'string' && idExpr.charAt(0) === '$'
              ? row[idExpr.slice(1)]
              : idExpr
            const key = JSON.stringify(id === undefined ? null : id)
            if (!groups[key]) groups[key] = { _id: id === undefined ? null : id, count: 0 }
            if (countExpr && countExpr.__agg === 'sum') {
              let value = countExpr.value
              if (typeof value === 'string' && value.charAt(0) === '$') value = row[value.slice(1)]
              groups[key].count += Number(value) || 0
            }
          })
          rows = Object.keys(groups).map((key) => groups[key])
          return
        }
        if (stage.type === 'sort') {
          const orders = Object.keys(stage.spec).map((field) => ({
            field,
            direction: stage.spec[field] < 0 ? 'desc' : 'asc'
          }))
          rows = sortRows(rows, orders)
          return
        }
        if (stage.type === 'limit') {
          rows = rows.slice(0, stage.n)
        }
      })
      return { list: rows }
    }
  }
  return api
}

function collection(name) {
  if (!store[name]) store[name] = []
  const state = {
    query: null,
    orders: [],
    skip: 0,
    limit: null,
    projection: null
  }

  const api = {
    where(query) {
      state.query = query
      return api
    },
    orderBy(field, direction) {
      state.orders.push({ field, direction: direction || 'asc' })
      return api
    },
    skip(n) {
      state.skip = n
      return api
    },
    limit(n) {
      state.limit = n
      return api
    },
    field(projection) {
      state.projection = projection
      return api
    },
    async get() {
      let rows = store[name].filter((doc) => matchQuery(doc, state.query))
      rows = sortRows(rows, state.orders)
      if (state.skip) rows = rows.slice(state.skip)
      if (state.limit !== null) rows = rows.slice(0, state.limit)
      return { data: rows.map((row) => projectRow(row, state.projection)) }
    },
    async count() {
      return { total: store[name].filter((doc) => matchQuery(doc, state.query)).length }
    },
    async update({ data }) {
      let updated = 0
      store[name].forEach((doc) => {
        if (matchQuery(doc, state.query)) {
          applyUpdate(doc, data)
          updated++
        }
      })
      return { stats: { updated } }
    },
    async remove() {
      const before = store[name].length
      store[name] = store[name].filter((doc) => !matchQuery(doc, state.query))
      return { stats: { removed: before - store[name].length } }
    },
    async add({ data }) {
      const _id = uid(name.slice(0, 3))
      store[name].push(Object.assign({ _id }, clone(data)))
      return { _id }
    },
    doc(id) {
      return {
        async update({ data }) {
          const doc = store[name].find((item) => item._id === id)
          if (!doc) throw new Error('doc not found')
          applyUpdate(doc, data)
          return { stats: { updated: 1 } }
        },
        async remove() {
          const before = store[name].length
          store[name] = store[name].filter((item) => item._id !== id)
          return { stats: { removed: before - store[name].length } }
        },
        async get() {
          const doc = store[name].find((item) => item._id === id)
          return { data: doc ? [clone(doc)] : [] }
        }
      }
    },
    aggregate() {
      return createAggregate(name)
    }
  }
  return api
}

const db = {
  collection,
  command,
  RegExp(options) {
    return { __regexp: true, regexp: options.regexp, options: options.options || '' }
  }
}

const mockCloud = {
  DYNAMIC_CURRENT_ENV: 'mock-env',
  init() {},
  database() {
    return db
  },
  getWXContext() {
    return { OPENID: currentOpenid }
  }
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return mockCloud
  return originalLoad.call(this, request, parent, isMain)
}

let api
try {
  api = require('../cloudfunctions/api/index.js')
} catch (e) {
  console.log('cloud api tests skipped (run npm install --prefix cloudfunctions/api first)')
  console.log(e.message)
  process.exit(0)
}

async function call(action, payload, openid) {
  currentOpenid = openid
  return api.main({ action, payload: payload || {} }, {})
}

function ok(result) {
  assert.strictEqual(result.code, 0, result.message || 'expected success')
  return result.data
}

function fail(result) {
  assert.notStrictEqual(result.code, 0, 'expected failure')
  return result.message || ''
}

function resetStore() {
  Object.keys(store).forEach((key) => { store[key] = [] })
  idSeq = 0
}

async function run() {
  console.log('cloud api tests')
  resetStore()

  const USER_A = 'openid-user-a-123456'
  const USER_B = 'openid-user-b-654321'

  const loginA = ok(await call('login', {}, USER_A))
  assert.ok(loginA.user)
  assert.ok(loginA.user._id)
  assert.strictEqual(loginA.user.openid, undefined)
  assert.ok(loginA.user.openid_masked)
  assert.strictEqual(loginA.user.display_name, '微信用户')
  assert.strictEqual(store.users.length, 1)

  const loginA2 = ok(await call('login', {}, USER_A))
  assert.strictEqual(loginA2.user._id, loginA.user._id)
  assert.strictEqual(store.users.length, 1)

  const loginB = ok(await call('login', {}, USER_B))
  assert.notStrictEqual(loginB.user._id, loginA.user._id)
  assert.strictEqual(store.users.length, 2)
  console.log('  ok  login creates isolated accounts without exposing openid')

  const mixedText = [
    'AAA',
    '2026年11月9日 21:00',
    '[链接] A 的公众号文章 https://mp.weixin.qq.com/s/abc',
    'AAA',
    '2026年11月9日 21:01',
    'https://q.yingjiesheng.com/jobdetail/1.html?jobTitle=%E7%A0%94%E7%A9%B6%E5%91%98',
    'AAA',
    '2026年11月9日 21:02',
    'A 的私有文本'
  ].join('\n')

  const parsedA = ok(await call('parseAndSave', { raw_text: mixedText }, USER_A))
  assert.strictEqual(parsedA.success_count, 3)
  assert.strictEqual(parsedA.failed_count, 0)
  assert.strictEqual(parsedA.items.length, 3)
  const aWechatId = parsedA.items[0]._id
  const aWebId = parsedA.items[1]._id
  const aTextId = parsedA.items[2]._id

  const listA = ok(await call('getArchiveList', { page: 1, page_size: 20 }, USER_A))
  const listB = ok(await call('getArchiveList', { page: 1, page_size: 20 }, USER_B))
  assert.strictEqual(listA.total, 3)
  assert.strictEqual(listB.total, 0)
  assert.ok(fail(await call('getArchiveDetail', { archive_id: aWechatId }, USER_B)))
  assert.ok(fail(await call('updateArchive', { archive_id: aWechatId, title: 'hacked' }, USER_B)))
  const ownDetail = ok(await call('getArchiveDetail', { archive_id: aWechatId }, USER_A))
  assert.ok(ownDetail.title.indexOf('A 的公众号文章') !== -1)
  const crossDelete = ok(await call('deleteArchive', { archive_ids: [aWechatId] }, USER_B))
  assert.strictEqual(crossDelete.deleted_count, 0)
  console.log('  ok  cross-account read, update and delete are blocked')

  const parsedB = ok(await call('parseAndSave', { raw_text: mixedText }, USER_B))
  assert.strictEqual(parsedB.success_count, 3)
  const bWechatId = parsedB.items[0]._id
  const bTextId = parsedB.items[2]._id
  const parsedAAgain = ok(await call('parseAndSave', { raw_text: mixedText }, USER_A))
  assert.strictEqual(parsedAAgain.success_count, 0)
  assert.strictEqual(parsedAAgain.duplicate_count, 3)

  const USER_C = 'openid-user-c-999999'
  ok(await call('login', {}, USER_C))
  const cFirst = ok(await call('parseAndSave', { raw_text: mixedText }, USER_C))
  const cForced = ok(await call('parseAndSave', { raw_text: mixedText, allowDuplicates: true }, USER_C))
  assert.strictEqual(cFirst.success_count, 3)
  assert.strictEqual(cForced.success_count, 3)
  const cList = ok(await call('getArchiveList', { page: 1, page_size: 20 }, USER_C))
  assert.strictEqual(cList.total, 6)
  ok(await call('clearUserData', {}, USER_C))
  console.log('  ok  deduplication is scoped per account and allowDuplicates works')

  const catA = ok(await call('manageCategory', { action: 'create', name: '工作', color: '#2E9E5B' }, USER_A))
  const catB = ok(await call('manageCategory', { action: 'create', name: '工作', color: '#4C8DFF' }, USER_B))
  assert.notStrictEqual(catA.category._id, catB.category._id)
  assert.strictEqual((ok(await call('getCategories', {}, USER_A))).length, 1)
  assert.strictEqual((ok(await call('getCategories', {}, USER_B))).length, 1)

  const tagA = ok(await call('manageTag', { action: 'create', name: '重要', color: '#DA5A5A' }, USER_A))
  const tagB = ok(await call('manageTag', { action: 'create', name: '重要', color: '#F0A03C' }, USER_B))
  assert.notStrictEqual(tagA.tag._id, tagB.tag._id)

  const updatedA = ok(await call('updateArchive', {
    archive_id: aWechatId,
    category_id: catA.category._id,
    tag_ids: [tagA.tag._id],
    note: 'A 的备注'
  }, USER_A))
  assert.strictEqual(updatedA.category_name, '工作')
  assert.strictEqual(updatedA.tags.length, 1)
  assert.strictEqual(updatedA.tags[0].name, '重要')

  assert.ok(fail(await call('updateArchive', {
    archive_id: bWechatId,
    category_id: catA.category._id
  }, USER_B)))

  const bWithForeignTag = ok(await call('updateArchive', {
    archive_id: bWechatId,
    tag_ids: [tagA.tag._id]
  }, USER_B))
  assert.deepStrictEqual(bWithForeignTag.tag_ids, [])
  console.log('  ok  categories and tags are isolated and foreign IDs are rejected')

  const textWechat = ok(await call('getArchiveList', {
    keyword: '公众号',
    content_type: 'wechat',
    page: 1,
    page_size: 20
  }, USER_A))
  assert.ok(textWechat.total >= 1)
  const textKeyword = ok(await call('getArchiveList', { keyword: '私有文本', page: 1, page_size: 20 }, USER_A))
  assert.strictEqual(textKeyword.total, 1)
  const byCategory = ok(await call('getArchiveList', { category_id: catA.category._id, page: 1, page_size: 20 }, USER_A))
  assert.strictEqual(byCategory.total, 1)
  const byTag = ok(await call('getArchiveList', { tag_ids: [tagA.tag._id], page: 1, page_size: 20 }, USER_A))
  assert.strictEqual(byTag.total, 1)
  const byDate = ok(await call('getArchiveList', {
    date_from: Date.now() - 86400000,
    date_to: Date.now() + 86400000,
    page: 1,
    page_size: 20
  }, USER_A))
  assert.strictEqual(byDate.total, 3)
  const future = ok(await call('getArchiveList', {
    date_from: Date.now() + 86400000 * 30,
    date_to: Date.now() + 86400000 * 31,
    page: 1,
    page_size: 20
  }, USER_A))
  assert.strictEqual(future.total, 0)
  const page1 = ok(await call('getArchiveList', { page: 1, page_size: 1 }, USER_A))
  assert.strictEqual(page1.records.length, 1)
  assert.strictEqual(page1.total, 3)
  assert.strictEqual(page1.has_more, true)
  const page2 = ok(await call('getArchiveList', { page: 2, page_size: 1 }, USER_A))
  assert.strictEqual(page2.records.length, 1)
  assert.notStrictEqual(page2.records[0]._id, page1.records[0]._id)
  const page3 = ok(await call('getArchiveList', { page: 3, page_size: 1 }, USER_A))
  assert.strictEqual(page3.has_more, false)
  const sorted = ok(await call('getArchiveList', { sort: 'title_asc', page: 1, page_size: 20 }, USER_A))
  const initials = sorted.records.map((item) => item.title_initial)
  assert.deepStrictEqual(initials, initials.slice().sort())
  const newestFirst = ok(await call('getArchiveList', { sort: 'saved_desc', page: 1, page_size: 20 }, USER_A))
  for (let i = 1; i < newestFirst.records.length; i++) {
    assert.ok(newestFirst.records[i - 1].saved_at >= newestFirst.records[i].saved_at)
  }
  console.log('  ok  keyword, type, category, tag, date, pagination and sort filters')

  const changedType = ok(await call('updateArchive', {
    archive_id: aTextId,
    url: 'https://example.com/new-page'
  }, USER_A))
  assert.strictEqual(changedType.content_type, 'web')
  assert.strictEqual(changedType.domain, 'example.com')
  const changedBack = ok(await call('updateArchive', {
    archive_id: aTextId,
    url: ''
  }, USER_A))
  assert.strictEqual(changedBack.content_type, 'text')
  const retitled = ok(await call('updateArchive', {
    archive_id: aTextId,
    title: '【测试】新的标题'
  }, USER_A))
  assert.strictEqual(retitled.title_initial, 'C')
  assert.ok(fail(await call('updateArchive', { archive_id: aTextId, title: '   ' }, USER_A)))
  console.log('  ok  content type correction, title initial recomputation and validation')

  const batchCat = ok(await call('manageCategory', { action: 'create', name: '批量分类' }, USER_A))
  const batchTag = ok(await call('manageTag', { action: 'create', name: '批量标签' }, USER_A))
  const batchUpdated = ok(await call('batchUpdateArchive', {
    archive_ids: [aWechatId, aWebId],
    patch: { category_id: batchCat.category._id }
  }, USER_A))
  assert.strictEqual(batchUpdated.updated_count, 2)
  const batchTagged = ok(await call('batchTag', {
    archive_ids: [aWechatId, aWebId],
    tag_ids: [batchTag.tag._id],
    mode: 'add'
  }, USER_A))
  assert.strictEqual(batchTagged.updated_count, 2)
  const batchTagRemoved = ok(await call('batchTag', {
    archive_ids: [aWebId],
    tag_ids: [batchTag.tag._id],
    mode: 'remove'
  }, USER_A))
  assert.strictEqual(batchTagRemoved.updated_count, 1)
  assert.ok(fail(await call('batchTag', {
    archive_ids: [aWechatId],
    tag_ids: [tagB.tag._id],
    mode: 'add'
  }, USER_A)))
  const crossBatch = ok(await call('batchTag', {
    archive_ids: [aWechatId],
    tag_ids: [tagB.tag._id],
    mode: 'add'
  }, USER_B))
  assert.strictEqual(crossBatch.updated_count, 0)
  console.log('  ok  batch category and tag operations respect ownership')

  const deleteResult = ok(await call('deleteArchive', { archive_ids: [aWebId] }, USER_A))
  assert.strictEqual(deleteResult.deleted_count, 1)
  const recycleA = ok(await call('getArchiveList', { recycle: true, page: 1, page_size: 50 }, USER_A))
  const recycleB = ok(await call('getArchiveList', { recycle: true, page: 1, page_size: 50 }, USER_B))
  assert.strictEqual(recycleA.total, 1)
  assert.strictEqual(recycleB.total, 0)
  const restored = ok(await call('restoreArchive', { archive_ids: [aWebId] }, USER_A))
  assert.strictEqual(restored.restored_count, 1)
  const permanently = ok(await call('deleteArchive', { archive_ids: [aWebId], permanent: true }, USER_A))
  assert.strictEqual(permanently.deleted_count, 1)
  assert.ok(fail(await call('getArchiveDetail', { archive_id: aWebId }, USER_A)))
  console.log('  ok  recycle, restore and permanent delete are scoped per account')

  const catDelete = ok(await call('manageCategory', { action: 'delete', id: batchCat.category._id }, USER_A))
  assert.strictEqual(catDelete.deleted, true)
  const afterCatDelete = ok(await call('getArchiveDetail', { archive_id: aWechatId }, USER_A))
  assert.strictEqual(afterCatDelete.category_id, null)
  const catBStill = ok(await call('getCategories', {}, USER_B))
  assert.strictEqual(catBStill.length, 1)

  const tagDelete = ok(await call('manageTag', { action: 'delete', id: batchTag.tag._id }, USER_A))
  assert.strictEqual(tagDelete.deleted, true)
  const afterTagDelete = ok(await call('getArchiveDetail', { archive_id: aWechatId }, USER_A))
  assert.ok(afterTagDelete.tag_ids.indexOf(batchTag.tag._id) === -1)
  const tagBStill = ok(await call('getTags', {}, USER_B))
  assert.strictEqual(tagBStill.length, 1)
  console.log('  ok  category/tag deletion does not cross account boundaries')

  const statsA = ok(await call('getProfileStats', {}, USER_A))
  const statsB = ok(await call('getProfileStats', {}, USER_B))
  assert.strictEqual(statsA.total_count, 2)
  assert.strictEqual(statsB.total_count, 3)
  assert.ok(statsA.category_count >= 1)
  assert.ok(statsB.category_count === 1)
  assert.ok(statsA.type_counts.wechat >= 1)
  const exportA = ok(await call('exportData', {}, USER_A))
  const exportB = ok(await call('exportData', {}, USER_B))
  assert.ok(exportA.items.length === 2)
  assert.ok(exportB.items.length === 3)
  exportA.items.forEach((item) => assert.ok(item.user_id !== loginB.user._id))
  console.log('  ok  stats and exports only include the current account')

  const bList = ok(await call('getArchiveList', { page: 1, page_size: 20 }, USER_B))
  const bItemForRecycle = bList.records[0]._id
  const bSoftDelete = ok(await call('deleteArchive', { archive_ids: [bItemForRecycle] }, USER_B))
  assert.strictEqual(bSoftDelete.deleted_count, 1)
  const bRecycle = ok(await call('getArchiveList', { recycle: true, page: 1, page_size: 20 }, USER_B))
  assert.strictEqual(bRecycle.total, 1)
  const bEmpty = ok(await call('emptyRecycleBin', {}, USER_B))
  assert.strictEqual(bEmpty.deleted_count, 1)
  const bStatsAfterEmpty = ok(await call('getProfileStats', {}, USER_B))
  assert.strictEqual(bStatsAfterEmpty.total_count, 2)
  assert.strictEqual(bStatsAfterEmpty.recycle_count, 0)
  console.log('  ok  empty recycle bin keeps active records and is account-scoped')

  const blockedWebText = 'AAA\n2026年11月9日 21:10\nhttps://127.0.0.1/private'
  const blockedParsed = ok(await call('parseAndSave', { raw_text: blockedWebText }, USER_A))
  assert.strictEqual(blockedParsed.pending_enrich_ids.length, 1)
  const enrichedA = ok(await call('enrichArchive', { archive_ids: blockedParsed.pending_enrich_ids }, USER_A))
  assert.strictEqual(enrichedA.updated_count, 1)
  const blockedDetail = ok(await call('getArchiveDetail', {
    archive_id: blockedParsed.pending_enrich_ids[0]
  }, USER_A))
  assert.ok(blockedDetail.fetch_error.indexOf('不允许') !== -1)
  const enrichedB = ok(await call('enrichArchive', {
    archive_ids: blockedParsed.pending_enrich_ids
  }, USER_B))
  assert.strictEqual(enrichedB.updated_count, 0)
  console.log('  ok  async metadata enrichment fails safely and is ownership-scoped')

  const invalid = await call('notAnAction', {}, USER_A)
  assert.notStrictEqual(invalid.code, 0)

  const cleared = ok(await call('clearUserData', {}, USER_A))
  assert.strictEqual(cleared.cleared, true)
  const statsAAfter = ok(await call('getProfileStats', {}, USER_A))
  assert.strictEqual(statsAAfter.total_count, 0)
  assert.strictEqual(statsAAfter.category_count, 0)
  assert.strictEqual(statsAAfter.tag_count, 0)
  const statsBAfter = ok(await call('getProfileStats', {}, USER_B))
  assert.strictEqual(statsBAfter.total_count, 2)
  const loginAAgain = ok(await call('login', {}, USER_A))
  assert.strictEqual(loginAAgain.user._id, loginA.user._id)
  console.log('  ok  account data deletion is isolated and keeps the account record')

  console.log('\ncloud api tests passed')
}

run().catch((e) => {
  console.error(e.stack || e)
  process.exit(1)
})
