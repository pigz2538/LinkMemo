const assert = require('assert')

const storage = {}
global.wx = {
  getStorageSync(key) {
    return storage[key] === undefined ? '' : JSON.parse(JSON.stringify(storage[key]))
  },
  setStorageSync(key, value) {
    storage[key] = JSON.parse(JSON.stringify(value))
  },
  removeStorageSync(key) {
    delete storage[key]
  }
}

const api = require('../miniprogram/utils/local-api')

async function run() {
  console.log('local api tests')

  const init = await api.init()
  assert.ok(init.user)
  assert.strictEqual(init.loggedIn, true)
  assert.ok(init.user.display_name)

  const stats = await api.getProfileStats()
  assert.ok(stats.total_count >= 10)
  assert.ok(stats.category_count >= 4)
  assert.ok(stats.tag_count >= 4)
  console.log('  ok  seed and stats', JSON.stringify(stats))

  const list = await api.getArchiveList({ page: 1, page_size: 5, sort: 'saved_desc' })
  assert.strictEqual(list.records.length, 5)
  assert.ok(list.total > 5)
  assert.ok(list.has_more)
  assert.ok(list.records[0].type_icon)
  assert.ok(list.records[0].saved_date)
  assert.ok(list.records[0].category_name)
  console.log('  ok  archive pagination and decoration')

  const wechat = await api.getArchiveList({ content_type: 'wechat', page: 1, page_size: 20 })
  assert.ok(wechat.total > 0)
  wechat.records.forEach((item) => assert.strictEqual(item.content_type, 'wechat'))

  const keyword = await api.getArchiveList({ keyword: '微塑料', page: 1, page_size: 20 })
  assert.ok(keyword.total > 0)

  const categories = await api.getCategories()
  const job = categories.find((item) => item.name === '求职')
  assert.ok(job)
  assert.ok(job.usage_count > 0)

  const jobFiltered = await api.getArchiveList({ category_id: job._id, page: 1, page_size: 50 })
  assert.ok(jobFiltered.total > 0)
  jobFiltered.records.forEach((item) => assert.strictEqual(item.category_id, job._id))

  const tags = await api.getTags()
  const important = tags.find((item) => item.name === '重要')
  assert.ok(important)
  const tagFiltered = await api.getArchiveList({ tag_ids: [important._id], page: 1, page_size: 50 })
  assert.ok(tagFiltered.total > 0)
  tagFiltered.records.forEach((item) => assert.ok(item.tag_ids.indexOf(important._id) !== -1))
  console.log('  ok  filters by type, keyword, category and tag')

  const detail = await api.getArchiveDetail(list.records[0]._id)
  assert.ok(detail.title)

  const updated = await api.updateArchive(detail._id, {
    title: '新的标题',
    note: '测试备注',
    content_type: 'text'
  })
  assert.strictEqual(updated.title, '新的标题')
  assert.strictEqual(updated.note, '测试备注')
  assert.strictEqual(updated.content_type, 'text')
  assert.ok(updated.title_initial)

  let duplicateError = null
  try {
    await api.manageCategory({ action: 'create', name: job.name })
  } catch (e) {
    duplicateError = e
  }
  assert.ok(duplicateError)

  const created = await api.manageCategory({ action: 'create', name: '测试分类', color: '#123456' })
  assert.ok(created.category)
  const updatedCat = await api.manageCategory({
    action: 'update',
    id: created.category._id,
    name: '测试分类2',
    color: '#654321'
  })
  assert.strictEqual(updatedCat.category.name, '测试分类2')
  await api.manageCategory({ action: 'delete', id: created.category._id })

  const createdTag = await api.manageTag({ action: 'create', name: '测试标签' })
  assert.ok(createdTag.tag)
  await api.manageTag({ action: 'delete', id: createdTag.tag._id })
  console.log('  ok  category and tag CRUD')

  const text = [
    'AAA猪彼得',
    '2026年11月09日 21:53',
    '[链接] 微塑料蓝是什么蓝？| 一周论文新鲜读 http://mp.weixin.qq.com/s?__biz=test&scene=0#rd',
    '',
    'AAA猪彼得',
    '2026年11月09日 21:44',
    '测试用临时备忘'
  ].join('\n')

  const first = await api.parseAndSave(text)
  assert.strictEqual(first.success_count, 2)
  assert.strictEqual(first.duplicate_count, 0)
  assert.ok(first.items.length === 2)
  assert.strictEqual(first.total_count, 2)
  assert.strictEqual(first.message_count, 2)

  const second = await api.parseAndSave(text)
  assert.strictEqual(second.success_count, 0)
  assert.strictEqual(second.duplicate_count, 2)

  const third = await api.parseAndSave(text, { allowDuplicates: true })
  assert.strictEqual(third.success_count, 2)
  console.log('  ok  parse, dedupe and allow duplicates')

  const newIds = first.items.map((item) => item._id)
  const deleted = await api.deleteArchive(newIds)
  assert.strictEqual(deleted.deleted_count, 2)
  const recycle = await api.getArchiveList({ recycle: true, sort: 'deleted_desc', page: 1, page_size: 50 })
  assert.ok(recycle.total >= 2)
  const restored = await api.restoreArchive([newIds[0]])
  assert.strictEqual(restored.restored_count, 1)
  const permanent = await api.permanentDelete([newIds[1]])
  assert.strictEqual(permanent.deleted_count, 1)
  console.log('  ok  soft delete, recycle, restore and permanent delete')

  const batchCat = await api.batchUpdateArchive([newIds[0]], { category_id: job._id })
  assert.strictEqual(batchCat.updated_count, 1)
  const batchTags = await api.batchTag([newIds[0]], [important._id], 'add')
  assert.strictEqual(batchTags.updated_count, 1)
  const afterBatch = await api.getArchiveDetail(newIds[0])
  assert.strictEqual(afterBatch.category_id, job._id)
  assert.ok(afterBatch.tag_ids.indexOf(important._id) !== -1)
  console.log('  ok  batch operations')

  const exported = await api.exportData()
  assert.ok(exported.items.length > 0)
  assert.ok(exported.categories.length > 0)

  const cleared = await api.clearUserData()
  assert.strictEqual(cleared.cleared, true)
  const emptyStats = await api.getProfileStats()
  assert.strictEqual(emptyStats.total_count, 0)
  assert.strictEqual(emptyStats.category_count, 0)

  const reset = await api.resetDemoData()
  assert.strictEqual(reset.reset, true)
  const resetStats = await api.getProfileStats()
  assert.ok(resetStats.total_count > 0)
  console.log('  ok  export, clear and reset')

  const session = await api.getSession()
  assert.strictEqual(session.loggedIn, true)
  await api.logout()
  const loggedOut = await api.getSession()
  assert.strictEqual(loggedOut.loggedIn, false)
  await api.login()
  const loggedIn = await api.getSession()
  assert.strictEqual(loggedIn.loggedIn, true)
  console.log('  ok  login, logout and session state')

  const some = (await api.getArchiveList({ page: 1, page_size: 1, sort: 'saved_desc' })).records[0]
  const asWechat = await api.updateArchive(some._id, { url: 'https://mp.weixin.qq.com/s/abc' })
  assert.strictEqual(asWechat.content_type, 'wechat')
  const asSpoof = await api.updateArchive(some._id, { url: 'https://mp.weixin.qq.com.evil.com/s/abc' })
  assert.strictEqual(asSpoof.content_type, 'web')
  const asText = await api.updateArchive(some._id, { url: '' })
  assert.strictEqual(asText.content_type, 'text')
  const retitled = await api.updateArchive(some._id, { title: '中文标题' })
  assert.strictEqual(retitled.title_initial, 'Z')

  const work = await api.manageCategory({ action: 'create', name: 'Work' })
  let caseDup = null
  try {
    await api.manageCategory({ action: 'create', name: 'work' })
  } catch (e) {
    caseDup = e
  }
  assert.ok(caseDup)
  const renamed = await api.manageCategory({
    action: 'update',
    id: work.category._id,
    name: 'Works',
    color: '#123456'
  })
  assert.strictEqual(renamed.category.name, 'Works')
  await api.updateArchive(some._id, { category_id: work.category._id })
  await api.manageCategory({ action: 'delete', id: work.category._id })
  const afterCatDelete = await api.getArchiveDetail(some._id)
  assert.strictEqual(afterCatDelete.category_id, null)

  const urgent = await api.manageTag({ action: 'create', name: 'Urgent' })
  let tagDup = null
  try {
    await api.manageTag({ action: 'create', name: 'urgent' })
  } catch (e) {
    tagDup = e
  }
  assert.ok(tagDup)
  await api.updateArchive(some._id, { tag_ids: [urgent.tag._id] })
  await api.manageTag({ action: 'delete', id: urgent.tag._id })
  const afterTagDelete = await api.getArchiveDetail(some._id)
  assert.ok(afterTagDelete.tag_ids.indexOf(urgent.tag._id) === -1)
  console.log('  ok  URL type correction, title initial, category/tag uniqueness and deletion')

  const tagA = await api.manageTag({ action: 'create', name: '标签A' })
  const tagB = await api.manageTag({ action: 'create', name: '标签B' })
  const two = (await api.getArchiveList({ page: 1, page_size: 2, sort: 'saved_desc' })).records
  await api.updateArchive(two[0]._id, { tag_ids: [tagA.tag._id] })
  await api.updateArchive(two[1]._id, { tag_ids: [tagB.tag._id] })
  const tagAnd = await api.getArchiveList({ tag_ids: [tagA.tag._id, tagB.tag._id], tag_match: 'and', page_size: 50 })
  const tagOr = await api.getArchiveList({ tag_ids: [tagA.tag._id, tagB.tag._id], tag_match: 'or', page_size: 50 })
  assert.strictEqual(tagAnd.total, 0)
  assert.strictEqual(tagOr.total, 2)

  const dateFiltered = await api.getArchiveList({
    date_from: Date.now() - 2 * 86400000,
    date_to: Date.now() + 86400000,
    page_size: 50
  })
  assert.ok(dateFiltered.total > 0)

  const titleSorted = await api.getArchiveList({ sort: 'title_asc', page_size: 100 })
  function rank(initial) {
    return initial === '#' ? 27 : initial.charCodeAt(0) - 65
  }
  const ranks = titleSorted.records.map((item) => rank(item.title_initial))
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i - 1] <= ranks[i], 'title sort should be nondecreasing')
  }

  const exportAfter = await api.exportData()
  assert.ok(exportAfter.items.some((item) => item.title === '中文标题'))
  console.log('  ok  tag AND/OR filters, date filter, title sort and export content')

  await api.resetDemoData()
  console.log('\nlocal api tests passed')
}

run().catch((e) => {
  console.error(e.stack || e)
  process.exit(1)
})
