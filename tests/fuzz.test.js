const assert = require('assert')
const parser = require('../miniprogram/utils/parser')

let seed = 20261109
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

function pick(list) {
  return list[Math.floor(random() * list.length)]
}

const senders = ['AAA', '张三', 'Bob', '这是一个比较长的微信群名称', '😀用户']
const dates = [
  '2026年11月9日 21:53',
  '2026/11/09 21:53',
  '2026-11-09T21:53:00',
  '11月9日 21:53',
  '昨天 08:00',
  '星期一 09:00',
  '2026年11月9日 下午9:53',
  '2026年2月30日 10:00',
  '不是日期',
  '2026年11月9日 24:00'
]
const bodies = [
  '[链接] 一个标题 https://mp.weixin.qq.com/s/abc',
  '[链接] 两个链接 https://mp.weixin.qq.com/s/one https://example.com/two',
  'https://example.com/a?x=1&utm_source=test',
  'https://mp.weixin.qq.com.evil.com/s/spoof',
  'https://example.com/path_(with_parentheses)',
  '[文件] 试卷.pdf',
  '[图片] 微信图片_20260101000000_1.dat',
  '[小程序] 商品分享文案\n\n第二行描述',
  '[语音] 5"',
  '[视频] 00:30',
  '[位置] 长沙市岳麓区',
  '[聊天记录]',
  '普通文本，包含中文标点。',
  '记得有事情',
  '😀 emoji 与 English mixed',
  '【测试】标题',
  '多行文本第一行\n第二行\n\n第四行',
  'A'.repeat(500),
  '中文'.repeat(500),
  'https://a.com/1 和 https://b.com/2 和 https://c.com/3'
]

function randomMessage() {
  const body = pick(bodies)
  if (random() < 0.55) {
    return pick(senders) + '\n' + pick(dates) + '\n' + body
  }
  if (random() < 0.5) {
    return body
  }
  return pick(senders) + '\n' + pick(dates) + '\n' + body + '\n\n' + pick(bodies)
}

console.log('parser fuzz tests')

const VALID_TYPES = ['wechat', 'web', 'text', 'mini', 'file', 'image', 'other']

for (let i = 0; i < 1200; i++) {
  const input = randomMessage()
  const result = parser.parseMessages(input)
  assert.ok(Array.isArray(result.items), 'items must be an array')
  assert.ok(Array.isArray(result.failed), 'failed must be an array')
  assert.ok(typeof result.messageCount === 'number')
  result.items.forEach((item) => {
    assert.ok(VALID_TYPES.indexOf(item.content_type) !== -1, 'invalid type ' + item.content_type)
    assert.strictEqual(typeof item.title, 'string')
    assert.ok(item.title.length > 0, 'title must not be empty')
    assert.strictEqual(typeof item.url, 'string')
    assert.strictEqual(typeof item.dedupe_key, 'string')
    assert.ok(item.dedupe_key.length > 0)
    assert.strictEqual(typeof item.title_initial, 'string')
    assert.strictEqual(item.title_initial.length, 1)
    assert.ok(item.source_message_at === null || typeof item.source_message_at === 'number')
  })
}

for (let i = 0; i < 500; i++) {
  const url = 'https://' + pick(['example.com', 'mp.weixin.qq.com', 'sub.example.com', '127.0.0.1']) +
    '/path?b=2&a=1&utm_source=x#frag'
  const normalized = parser.normalizeUrlForKey(url)
  assert.strictEqual(typeof normalized, 'string')
  assert.ok(normalized.indexOf('#') === -1)
  const domain = parser.getDomain(url)
  assert.strictEqual(typeof domain, 'string')
  assert.ok(domain.length > 0)
}

console.log('  ok  1200 random inputs parsed without throwing')
console.log('  ok  URL normalization and domain extraction stayed stable')
console.log('\nparser fuzz tests passed')
