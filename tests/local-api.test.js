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

function pad(value) {
  return value < 10 ? '0' + value : '' + value
}

function dateLabel(timestamp) {
  const d = new Date(timestamp)
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function buildChatFixture() {
  const now = Date.now()
  const senders = ['Alice', 'Bob', '张三', '李四', '王五', 'Carol', 'Dave', '群助手']
  const specs = [
    { body: '[链接] 招聘信息一 https://mp.weixin.qq.com/s/alpha1', type: 'wechat' },
    { body: 'https://example.com/job/1?jobTitle=%E7%A0%94%E7%A9%B6%E5%91%98', type: 'web' },
    { body: '明天记得交材料', type: 'text' },
    { body: '[文件] 报告一.pdf', type: 'file' },
    { body: '[图片] 现场照片一.dat', type: 'image' },
    { body: '[小程序] 好物分享一', type: 'mini' },
    { body: '[链接] 招聘信息二 https://mp.weixin.qq.com/s/alpha2', type: 'wechat' },
    { body: 'https://example.com/web/2', type: 'web' },
    { body: '周末去看展览', type: 'text' },
    { body: '[文件] 课程笔记.txt', type: 'file' },
    { body: '[图片] 截图二.dat', type: 'image' },
    { body: '[小程序] 课程报名', type: 'mini' },
    { body: '[链接] 招聘信息三 https://mp.weixin.qq.com/s/alpha3', type: 'wechat' },
    { body: 'https://example.com/web/3', type: 'web' },
    { body: '这是一条比较长的临时备忘，用来测试文本标题截取和全文保存是否正常。', type: 'text' },
    { body: '[文件] 组会材料.pptx', type: 'file' },
    { body: '[链接] 招聘信息四 https://mp.weixin.qq.com/s/alpha4', type: 'wechat' },
    { body: 'https://example.com/web/4', type: 'web' },
    { body: '下午三点开会', type: 'text' },
    { body: '[语音] 5"', type: 'other' },
    { body: '[链接] 招聘信息五 https://mp.weixin.qq.com/s/alpha5', type: 'wechat' },
    { body: '买牛奶和面包', type: 'text' },
    { body: '给老师发邮件确认时间', type: 'text' },
    { body: '整理本周阅读清单', type: 'text' }
  ]

  const blocks = specs.map((spec, index) => {
    return senders[index % senders.length] + '\n' +
      dateLabel(now - index * 3600000) + '\n' +
      spec.body
  })

  return {
    raw: blocks.join('\n\n'),
    messageCount: specs.length,
    specs,
    senders
  }
}

function rank(initial) {
  return initial === '#' ? 27 : initial.charCodeAt(0) - 65
}

async function run() {
  console.log('local api tests')

  const init = await api.init()
  assert.ok(init.user)
  assert.strictEqual(init.loggedIn, false)
  assert.strictEqual(init.user.display_name, '微信用户')

  const emptyStats = await api.getProfileStats()
  assert.strictEqual(emptyStats.total_count, 0)
  assert.strictEqual(emptyStats.category_count, 0)
  assert.strictEqual(emptyStats.tag_count, 0)
  assert.strictEqual(emptyStats.recycle_count, 0)
  const emptyList = await api.getArchiveList({ page: 1, page_size: 20 })
  assert.strictEqual(emptyList.total, 0)
  assert.deepStrictEqual(await api.getCategories(), [])
  assert.deepStrictEqual(await api.getTags(), [])
  assert.deepStrictEqual(await api.getSenders(), [])
  console.log('  ok  fresh install starts completely empty and logged out')

  await api.login()
  assert.strictEqual((await api.getSession()).loggedIn, true)

  const fixture = buildChatFixture()
  const parsed = await api.parseAndSave(fixture.raw)
  assert.strictEqual(parsed.success_count, fixture.messageCount)
  assert.strictEqual(parsed.duplicate_count, 0)
  assert.strictEqual(parsed.failed_count, 0)
  assert.strictEqual(parsed.total_count, fixture.messageCount)
  assert.strictEqual(parsed.message_count, fixture.messageCount)

  const stats = await api.getProfileStats()
  assert.strictEqual(stats.total_count, fixture.messageCount)
  assert.strictEqual(stats.category_count, 0)
  assert.strictEqual(stats.tag_count, 0)

  const senders = await api.getSenders()
  assert.strictEqual(senders.reduce((sum, item) => sum + item.count, 0), fixture.messageCount)
  assert.ok(senders.length > 1)
  assert.ok(senders.some((item) => item.name === 'Alice'))
  console.log('  ok  import fixture and sender aggregation')

  const all = await api.getArchiveList({ page: 1, page_size: 100, sort: 'saved_desc' })
  assert.strictEqual(all.records.length, fixture.messageCount)

  const catJob = await api.manageCategory({ action: 'create', name: '求职', color: '#F0A03C' })
  const catStudy = await api.manageCategory({ action: 'create', name: '学习', color: '#4C8DFF' })
  const catLife = await api.manageCategory({ action: 'create', name: '生活', color: '#7B61FF' })
  const tagImportant = await api.manageTag({ action: 'create', name: '重要', color: '#DA5A5A' })
  const tagRead = await api.manageTag({ action: 'create', name: '待阅读', color: '#2E9E5B' })

  for (let i = 0; i < all.records.length; i++) {
    const item = all.records[i]
    let categoryId = catLife.category._id
    let tagIds = []
    if (item.content_type === 'wechat' || item.content_type === 'web') {
      categoryId = catJob.category._id
      tagIds = item.content_type === 'wechat' ? [tagImportant.tag._id] : [tagRead.tag._id]
    } else if (item.content_type === 'file' || item.content_type === 'mini') {
      categoryId = catStudy.category._id
    }
    await api.updateArchive(item._id, { category_id: categoryId, tag_ids: tagIds })
  }

  const jobList = await api.getArchiveList({ category_id: catJob.category._id, page: 1, page_size: 100 })
  assert.strictEqual(jobList.total, 9)
  jobList.records.forEach((item) => assert.ok(item.content_type === 'wechat' || item.content_type === 'web'))

  const studyList = await api.getArchiveList({ category_id: catStudy.category._id, page: 1, page_size: 100 })
  assert.strictEqual(studyList.total, 5)
  const importantList = await api.getArchiveList({ tag_ids: [tagImportant.tag._id], page: 1, page_size: 100 })
  assert.strictEqual(importantList.total, 5)
  const textList = await api.getArchiveList({ content_type: 'text', page: 1, page_size: 100 })
  assert.strictEqual(textList.total, 7)
  const keywordList = await api.getArchiveList({ keyword: '招聘信息', page: 1, page_size: 100 })
  assert.strictEqual(keywordList.total, 5)
  const aliceCount = fixture.specs.filter((_, index) => fixture.senders[index % fixture.senders.length] === 'Alice').length
  const aliceList = await api.getArchiveList({ sender: 'Alice', page: 1, page_size: 100 })
  assert.strictEqual(aliceList.total, aliceCount)
  aliceList.records.forEach((item) => assert.strictEqual(item.source_sender, 'Alice'))
  const dateList = await api.getArchiveList({
    date_from: Date.now() - 86400000,
    date_to: Date.now() + 86400000,
    page: 1,
    page_size: 100
  })
  assert.strictEqual(dateList.total, fixture.messageCount)
  const futureList = await api.getArchiveList({
    date_from: Date.now() + 30 * 86400000,
    date_to: Date.now() + 31 * 86400000,
    page: 1,
    page_size: 100
  })
  assert.strictEqual(futureList.total, 0)
  console.log('  ok  category, tag, type, keyword, sender and date filters')

  const page1 = await api.getArchiveList({ page: 1, page_size: 5 })
  const page2 = await api.getArchiveList({ page: 2, page_size: 5 })
  assert.strictEqual(page1.records.length, 5)
  assert.strictEqual(page1.total, fixture.messageCount)
  assert.strictEqual(page1.has_more, true)
  assert.notStrictEqual(page1.records[0]._id, page2.records[0]._id)

  const titleSorted = await api.getArchiveList({ sort: 'title_asc', page: 1, page_size: 100 })
  const ranks = titleSorted.records.map((item) => rank(item.title_initial))
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i - 1] <= ranks[i])
  }
  const newest = await api.getArchiveList({ sort: 'saved_desc', page: 1, page_size: 100 })
  for (let i = 1; i < newest.records.length; i++) {
    assert.ok(newest.records[i - 1].saved_at >= newest.records[i].saved_at)
  }
  console.log('  ok  pagination and sorting')

  const target = all.records[0]
  const detail = await api.getArchiveDetail(target._id)
  assert.ok(detail.title)
  const updated = await api.updateArchive(target._id, { title: '新的标题', note: '测试备注' })
  assert.strictEqual(updated.title, '新的标题')
  assert.strictEqual(updated.note, '测试备注')
  assert.ok(updated.title_initial)
  const asWechat = await api.updateArchive(target._id, { url: 'https://mp.weixin.qq.com/s/updated' })
  assert.strictEqual(asWechat.content_type, 'wechat')
  const asSpoof = await api.updateArchive(target._id, { url: 'https://mp.weixin.qq.com.evil.com/s/updated' })
  assert.strictEqual(asSpoof.content_type, 'web')
  const asText = await api.updateArchive(target._id, { url: '' })
  assert.strictEqual(asText.content_type, 'text')
  const retitled = await api.updateArchive(target._id, { title: '【测试】新标题' })
  assert.strictEqual(retitled.title_initial, 'C')
  assert.strictEqual(retitled.dedupe_key, detail.dedupe_key)
  console.log('  ok  detail, edit, URL type correction, title initial and stable dedupe key')

  let caseDup = null
  try {
    await api.manageCategory({ action: 'create', name: '求职' })
  } catch (e) {
    caseDup = e
  }
  assert.ok(caseDup)
  let tagDup = null
  try {
    await api.manageTag({ action: 'create', name: '重要' })
  } catch (e) {
    tagDup = e
  }
  assert.ok(tagDup)
  const renamedCat = await api.manageCategory({
    action: 'update',
    id: catStudy.category._id,
    name: '学习资料',
    color: '#123456'
  })
  assert.strictEqual(renamedCat.category.name, '学习资料')

  const jobItem = jobList.records[0]
  await api.manageCategory({ action: 'delete', id: catJob.category._id })
  const afterCatDelete = await api.getArchiveDetail(jobItem._id)
  assert.strictEqual(afterCatDelete.category_id, null)

  const readItem = all.records.find((item) => item.content_type === 'web')
  await api.manageTag({ action: 'delete', id: tagRead.tag._id })
  const afterTagDelete = await api.getArchiveDetail(readItem._id)
  assert.ok(afterTagDelete.tag_ids.indexOf(tagRead.tag._id) === -1)
  console.log('  ok  category/tag uniqueness, rename and deletion semantics')

  const tagA = await api.manageTag({ action: 'create', name: '标签A' })
  const tagB = await api.manageTag({ action: 'create', name: '标签B' })
  const three = (await api.getArchiveList({ page: 1, page_size: 3 })).records
  await api.updateArchive(three[0]._id, { tag_ids: [tagA.tag._id] })
  await api.updateArchive(three[1]._id, { tag_ids: [tagB.tag._id] })
  await api.updateArchive(three[2]._id, { tag_ids: [tagA.tag._id, tagB.tag._id] })
  const tagAnd = await api.getArchiveList({ tag_ids: [tagA.tag._id, tagB.tag._id], tag_match: 'and', page_size: 100 })
  const tagOr = await api.getArchiveList({ tag_ids: [tagA.tag._id, tagB.tag._id], tag_match: 'or', page_size: 100 })
  assert.strictEqual(tagAnd.total, 1)
  assert.strictEqual(tagOr.total, 3)
  console.log('  ok  tag AND/OR filters')

  const batchCategory = await api.manageCategory({ action: 'create', name: '批量分类' })
  const batchTag = await api.manageTag({ action: 'create', name: '批量标签' })
  const batchIds = [three[0]._id, three[1]._id]
  const batchCatResult = await api.batchUpdateArchive(batchIds, { category_id: batchCategory.category._id })
  assert.strictEqual(batchCatResult.updated_count, 2)
  const batchTagResult = await api.batchTag(batchIds, [batchTag.tag._id], 'add')
  assert.strictEqual(batchTagResult.updated_count, 2)
  const batchTagRemoved = await api.batchTag([batchIds[0]], [batchTag.tag._id], 'remove')
  assert.strictEqual(batchTagRemoved.updated_count, 1)
  console.log('  ok  batch category and tag operations')

  const deleteIds = [three[1]._id, three[2]._id]
  const deleted = await api.deleteArchive(deleteIds)
  assert.strictEqual(deleted.deleted_count, 2)
  const recycle = await api.getArchiveList({ recycle: true, sort: 'deleted_desc', page: 1, page_size: 50 })
  assert.strictEqual(recycle.total, 2)
  const restored = await api.restoreArchive([deleteIds[0]])
  assert.strictEqual(restored.restored_count, 1)
  const emptied = await api.emptyRecycleBin()
  assert.strictEqual(emptied.deleted_count, 1)
  await api.deleteArchive([deleteIds[0]])
  const permanently = await api.permanentDelete([deleteIds[0]])
  assert.strictEqual(permanently.deleted_count, 1)
  const afterRecycleStats = await api.getProfileStats()
  assert.strictEqual(afterRecycleStats.total_count, fixture.messageCount - 2)
  assert.strictEqual(afterRecycleStats.recycle_count, 0)
  console.log('  ok  soft delete, recycle, restore, empty recycle and permanent delete')

  const exported = await api.exportData()
  assert.strictEqual(exported.items.length, afterRecycleStats.total_count)
  assert.ok(exported.items.some((item) => item.title === '【测试】新标题'))

  const duplicate = await api.parseAndSave(fixture.raw)
  assert.strictEqual(duplicate.duplicate_count, fixture.messageCount - 2)
  assert.strictEqual(duplicate.success_count, 2)
  const forced = await api.parseAndSave(fixture.raw, { allowDuplicates: true })
  assert.strictEqual(forced.success_count, fixture.messageCount)
  console.log('  ok  duplicate detection and allowDuplicates')

  const session = await api.getSession()
  assert.strictEqual(session.loggedIn, true)
  await api.logout()
  assert.strictEqual((await api.getSession()).loggedIn, false)
  await api.login()
  assert.strictEqual((await api.getSession()).loggedIn, true)
  console.log('  ok  login, logout and session state')

  const beforeClear = await api.getProfileStats()
  assert.ok(beforeClear.total_count > 0)
  const cleared = await api.clearUserData()
  assert.strictEqual(cleared.cleared, true)
  const clearedStats = await api.getProfileStats()
  assert.strictEqual(clearedStats.total_count, 0)
  assert.strictEqual(clearedStats.category_count, 0)
  assert.strictEqual(clearedStats.tag_count, 0)
  assert.strictEqual((await api.getArchiveList({ page: 1, page_size: 20 })).total, 0)
  assert.deepStrictEqual(await api.getSenders(), [])
  console.log('  ok  clear account data returns to an empty library')

  console.log('\nlocal api tests passed')
}

run().catch((e) => {
  console.error(e.stack || e)
  process.exit(1)
})
