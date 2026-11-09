const assert = require('assert')
const fs = require('fs')
const path = require('path')
const parser = require('../miniprogram/utils/parser')
const { firstLetter } = require('../miniprogram/utils/pinyin')

let passed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ok  ' + name)
  } catch (e) {
    console.error('  FAIL ' + name)
    console.error(e.stack || e)
    process.exitCode = 1
  }
}

console.log('parser tests')

test('split message boundaries', () => {
  const raw = [
    'AAA猪彼得',
    '2026年11月09日 21:53',
    '[链接] 微塑料蓝是什么蓝？ https://mp.weixin.qq.com/s/abc',
    '',
    'AAA猪彼得',
    '2026年11月09日 21:44',
    '记得有事情',
    '',
    'AAA猪彼得',
    '2026年11月09日 21:45',
    '[文件] 试卷.pdf'
  ].join('\n')

  const messages = parser.splitMessages(raw)
  assert.strictEqual(messages.length, 3)
  assert.strictEqual(messages[0].sender, 'AAA猪彼得')
  assert.strictEqual(messages[0].timeLabel, '2026年11月09日 21:53')
  assert.ok(messages[0].body.indexOf('[链接]') === 0)
})

test('preserve multi-line body with blank lines between headers', () => {
  const raw = [
    'AAA猪彼得',
    '2026年11月02日 18:26',
    '第一段',
    '',
    '第二段',
    '',
    'AAA猪彼得',
    '2026年11月03日 10:00',
    '另一条'
  ].join('\n')
  const messages = parser.splitMessages(raw)
  assert.strictEqual(messages.length, 2)
  assert.ok(messages[0].body.indexOf('第二段') !== -1)
})

test('extract URLs and strip trailing punctuation', () => {
  const urls = parser.extractUrls('看这个 https://example.com/a?x=1，还有 http://mp.weixin.qq.com/s/abc。')
  assert.strictEqual(urls.length, 2)
  assert.strictEqual(urls[0], 'https://example.com/a?x=1')
  assert.strictEqual(urls[1], 'http://mp.weixin.qq.com/s/abc')
})

test('detect wechat article and prefer share title', () => {
  const body = '[链接] 微塑料蓝是什么蓝？| 一周论文新鲜读 http://mp.weixin.qq.com/s?__biz=MzAw&mid=1#rd'
  const result = parser.parseMessages('AAA\n2026年11月09日 21:53\n' + body)
  assert.strictEqual(result.items.length, 1)
  assert.strictEqual(result.items[0].content_type, 'wechat')
  assert.strictEqual(result.items[0].title, '微塑料蓝是什么蓝？| 一周论文新鲜读')
  assert.strictEqual(result.items[0].domain, 'mp.weixin.qq.com')
})

test('extract jobTitle for yingjiesheng URL', () => {
  const url = 'https://q.yingjiesheng.com/jobdetail/165746825.html?jobTitle=%E7%A0%94%E7%A9%B6%E5%91%98%EF%BC%88%E6%A0%87%E5%87%86%E5%8C%96%E5%B7%A5%E4%BD%9C%EF%BC%89'
  assert.strictEqual(parser.extractJobTitle(url), '研究员（标准化工作）')
  const result = parser.parseMessages('AAA\n2026年11月09日 16:52\n' + url)
  assert.strictEqual(result.items[0].content_type, 'web')
  assert.ok(result.items[0].title.indexOf('研究员') !== -1)
})

test('text item uses first 30 chars as title', () => {
  const longText = '这是一段很长的临时备忘文字，用来验证标题是否只截取前三十个字符，同时完整内容仍然保留在 content 字段中。'
  const result = parser.parseMessages('AAA\n2026年11月09日 20:00\n' + longText)
  assert.strictEqual(result.items[0].content_type, 'text')
  assert.strictEqual(result.items[0].title.length, 30)
  assert.strictEqual(result.items[0].content, longText)
})

test('file and image clues keep filename without binary', () => {
  const result = parser.parseMessages([
    'AAA',
    '2026年11月06日 11:18',
    '[文件] 试卷.pdf',
    '',
    'AAA',
    '2026年11月09日 15:18',
    '[图片] 微信图片_20261109151804_236.dat'
  ].join('\n'))
  assert.strictEqual(result.items[0].content_type, 'file')
  assert.strictEqual(result.items[0].title, '试卷.pdf')
  assert.strictEqual(result.items[1].content_type, 'image')
  assert.strictEqual(result.items[1].title, '微信图片_20261109151804_236.dat')
})

test('mini program clue keeps visible title', () => {
  const body = '[小程序] 【焓姨专属】盐都老味道✅下厨房富顺豆花\n\n🥢正宗富顺胆水豆花'
  const result = parser.parseMessages('AAA\n2026年11月09日 21:45\n' + body)
  assert.strictEqual(result.items[0].content_type, 'mini')
  assert.ok(result.items[0].title.indexOf('盐都老味道') !== -1)
})

test('wechat link without title falls back', () => {
  const result = parser.parseMessages('AAA\n2026年11月09日 21:44\n[链接]\nhttp://mp.weixin.qq.com/s?__biz=abc')
  assert.strictEqual(result.items[0].content_type, 'wechat')
  assert.ok(result.items[0].title)
})

test('normalize dedupe key removes tracking params and fragment', () => {
  const a = 'https://mp.weixin.qq.com/s?__biz=abc&mid=1&idx=1&sn=xyz&scene=0&xtrack=1&chksm=foo#rd'
  const b = 'https://mp.weixin.qq.com/s?__biz=abc&mid=1&idx=1&sn=xyz&chksm=bar&utm_source=test'
  assert.strictEqual(parser.normalizeUrlForKey(a), parser.normalizeUrlForKey(b))
  assert.ok(parser.normalizeUrlForKey(a).indexOf('__biz=abc') !== -1)
})

test('pinyin initial handles Chinese, punctuation and digits', () => {
  assert.strictEqual(firstLetter('微塑料'), 'W')
  assert.strictEqual(firstLetter('等不到李老师'), 'D')
  assert.strictEqual(firstLetter('【给媒专属】盐都老味道'), 'G')
  assert.strictEqual(firstLetter('2026年招聘'), '#')
  assert.strictEqual(firstLetter('Hello'), 'H')
})

test('parse bundled chat sample end to end', () => {
  const samplePath = path.join(__dirname, '..', '链接样例.txt')
  if (!fs.existsSync(samplePath)) {
    console.log('      skip: local 链接样例.txt not present')
    return
  }
  const raw = fs.readFileSync(samplePath, 'utf8')
  const result = parser.parseMessages(raw)
  assert.ok(result.items.length > 60, 'expected more than 60 items, got ' + result.items.length)

  const types = {}
  result.items.forEach((item) => {
    types[item.content_type] = (types[item.content_type] || 0) + 1
    assert.ok(item.title)
    assert.ok(item.title_initial)
    assert.ok(item.dedupe_key)
  })
  assert.ok(types.wechat > 0)
  assert.ok(types.text > 0)
  assert.ok(types.file > 0)
  assert.ok(types.image > 0)
  assert.ok(types.mini > 0)

  const plastic = result.items.find((item) => item.title.indexOf('微塑料蓝') !== -1)
  assert.ok(plastic)
  assert.strictEqual(plastic.content_type, 'wechat')
  assert.ok(plastic.url.indexOf('mp.weixin.qq.com') !== -1)

  const job = result.items.find((item) => item.url.indexOf('yingjiesheng.com/jobdetail') !== -1)
  assert.ok(job)
  assert.strictEqual(job.content_type, 'web')
  assert.ok(job.title.indexOf('研究员') !== -1)

  const note = result.items.find((item) => item.content === '记得有事情')
  assert.ok(note)
  assert.strictEqual(note.content_type, 'text')

  console.log('      sample messages parsed:', result.items.length, 'types:', JSON.stringify(types))
})

console.log('\n' + passed + ' test groups passed')
