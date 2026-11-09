const { firstLetter } = require('./pinyin')

const PERIOD_GROUP = '(上午|下午|中午|晚上|凌晨)?'
const TIME_GROUP = '(\\d{1,2}):(\\d{2})(?::(\\d{2}))?'
const FULL_DATE_RE = new RegExp(
  '^(\\d{4})\\s*[年/.-]\\s*(\\d{1,2})\\s*[月/.-]\\s*(\\d{1,2})\\s*日?\\s*T?\\s*' +
  PERIOD_GROUP + '\\s*' + TIME_GROUP + '$'
)
const SHORT_DATE_RE = new RegExp(
  '^(\\d{1,2})月(\\d{1,2})日\\s*' + PERIOD_GROUP + '\\s*' + TIME_GROUP + '$'
)
const RELATIVE_DATE_RE = new RegExp(
  '^(今天|昨天|前天)\\s*' + PERIOD_GROUP + '\\s*' + TIME_GROUP + '$'
)
const WEEKDAY_DATE_RE = new RegExp(
  '^((?:星期|周)[一二三四五六日天])\\s*' + PERIOD_GROUP + '\\s*' + TIME_GROUP + '$'
)
const WEEKDAY_MAP = {
  '一': 1,
  '二': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
  '日': 0,
  '天': 0
}
const SENDER_MAX_LENGTH = 80
const URL_RE = /https?:\/\/[^\s<>"'“”‘’（）【】{}，。！？；：、]+/gi
const URL_TRAILING_PUNCT_RE = /[.,;:!?，。！？；：、'"“”‘’】》>]+$/
const MARKER_TYPES = ['链接', '文件', '图片', '小程序', '聊天记录', '语音', '视频', '位置', '名片', '表情']
const TYPE_PRIORITY = ['file', 'image', 'mini', 'other']

function normalizeText(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function applyPeriod(hour, period) {
  if (!period) return hour
  if ((period === '下午' || period === '晚上') && hour < 12) return hour + 12
  if (period === '中午' && hour < 11) return hour + 12
  if (period === '凌晨' && hour === 12) return 0
  return hour
}

function buildTimestamp(year, month, day, hour, minute, second) {
  const sec = second || 0
  const date = new Date(year, month - 1, day, hour, minute, sec, 0)
  if (Number.isNaN(date.getTime())) return null
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== sec
  ) {
    return null
  }
  return date.getTime()
}

function parseDateLine(label) {
  const value = String(label || '').trim()
  if (!value) return null
  const now = new Date()

  let m = value.match(FULL_DATE_RE)
  if (m) {
    const hour = applyPeriod(Number(m[5]), m[4])
    const timestamp = buildTimestamp(Number(m[1]), Number(m[2]), Number(m[3]), hour, Number(m[6]), Number(m[7] || 0))
    return timestamp === null ? null : { timestamp, label: value, precision: 'full' }
  }

  m = value.match(SHORT_DATE_RE)
  if (m) {
    const hour = applyPeriod(Number(m[4]), m[3])
    let timestamp = buildTimestamp(now.getFullYear(), Number(m[1]), Number(m[2]), hour, Number(m[5]), Number(m[6] || 0))
    if (timestamp !== null && timestamp > now.getTime() + 2 * 86400000) {
      timestamp = buildTimestamp(now.getFullYear() - 1, Number(m[1]), Number(m[2]), hour, Number(m[5]), Number(m[6] || 0))
    }
    return timestamp === null ? null : { timestamp, label: value, precision: 'short' }
  }

  m = value.match(RELATIVE_DATE_RE)
  if (m) {
    const offset = m[1] === '今天' ? 0 : m[1] === '昨天' ? 1 : 2
    const hour = applyPeriod(Number(m[3]), m[2])
    const date = new Date(now.getTime())
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - offset)
    date.setHours(hour, Number(m[4]), Number(m[5] || 0), 0)
    return { timestamp: date.getTime(), label: value, precision: 'relative' }
  }

  m = value.match(WEEKDAY_DATE_RE)
  if (m) {
    const target = WEEKDAY_MAP[m[1].slice(-1)]
    const hour = applyPeriod(Number(m[3]), m[2])
    const date = new Date(now.getTime())
    date.setHours(0, 0, 0, 0)
    const diff = (date.getDay() - target + 7) % 7
    date.setDate(date.getDate() - diff)
    date.setHours(hour, Number(m[4]), Number(m[5] || 0), 0)
    return { timestamp: date.getTime(), label: value, precision: 'weekday' }
  }

  return null
}

function isDateLine(line) {
  return !!parseDateLine(line)
}

function parseMessageDate(label) {
  const parsed = parseDateLine(label)
  return parsed ? parsed.timestamp : null
}

function splitMessages(rawText) {
  const text = normalizeText(rawText)
  if (!text) return []

  const lines = text.split('\n')
  const headerIndexes = []

  for (let i = 0; i < lines.length - 1; i++) {
    const sender = lines[i].trim()
    const dateLine = lines[i + 1].trim()
    if (
      sender &&
      sender.length <= SENDER_MAX_LENGTH &&
      !/https?:\/\//i.test(sender) &&
      isDateLine(dateLine)
    ) {
      headerIndexes.push(i)
    }
  }

  if (headerIndexes.length) {
    const messages = []
    const prefix = lines.slice(0, headerIndexes[0]).join('\n').trim()
    if (prefix) {
      messages.push({ sender: '', timeLabel: '', body: prefix })
    }

    headerIndexes.forEach((start, idx) => {
      const end = idx + 1 < headerIndexes.length ? headerIndexes[idx + 1] : lines.length
      const sender = lines[start].trim()
      const timeLabel = lines[start + 1].trim()
      const body = lines.slice(start + 2, end).join('\n').trim()
      if (body) messages.push({ sender, timeLabel, body })
    })
    return messages
  }

  return text
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((body) => ({ sender: '', timeLabel: '', body }))
}

function trimUrlPunctuation(raw) {
  let value = String(raw || '').replace(URL_TRAILING_PUNCT_RE, '')
  const pairs = [['(', ')'], ['[', ']']]
  pairs.forEach((pair) => {
    const open = pair[0]
    const close = pair[1]
    while (value.charAt(value.length - 1) === close) {
      const opens = value.split(open).length - 1
      const closes = value.split(close).length - 1
      if (closes <= opens) break
      value = value.slice(0, -1)
    }
  })
  return value
}

function extractUrls(text) {
  const found = String(text || '').match(URL_RE) || []
  const result = []
  found.forEach((raw) => {
    const url = trimUrlPunctuation(raw)
    if (url && result.indexOf(url) === -1) result.push(url)
  })
  return result
}

function splitUrl(url) {
  const m = String(url || '').match(/^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i)
  if (!m) return null
  return {
    protocol: m[1].toLowerCase(),
    host: m[2].toLowerCase(),
    pathname: m[3] || '/',
    search: m[4] || '',
    hash: m[5] || ''
  }
}

function getDomain(url) {
  const parts = splitUrl(url)
  if (!parts) return ''
  return parts.host.replace(/:\d+$/, '').replace(/^www\./i, '')
}

function isWechatHost(url) {
  const parts = splitUrl(url)
  if (!parts) return false
  const host = parts.host.replace(/:\d+$/, '').toLowerCase()
  return host === 'mp.weixin.qq.com'
}

const TRACKING_PARAM_RE = /^(utm_|spm$|scm$|from$|scene$|xtrack$|chksm$|nsukey$|clicktime$|enterid$|isappinstalled$|share_token$|sharer_sharetime$|sharer_shareid$|fbclid$|gclid$|ascene$|exportkey$|pass_ticket$|wx_header$)/i

function normalizeUrlForKey(url) {
  const parts = splitUrl(url)
  if (!parts) return String(url || '').trim()

  const host = parts.host.replace(/:(80|443)$/, '')
  const params = parts.search
    .replace(/^\?/, '')
    .split('&')
    .filter(Boolean)
    .filter((pair) => {
      const key = pair.split('=')[0]
      return !TRACKING_PARAM_RE.test(key)
    })
    .sort()

  const query = params.length ? '?' + params.join('&') : ''
  return parts.protocol + '://' + host + parts.pathname + query
}

function extractJobTitle(url) {
  let decoded = String(url || '')
  try {
    decoded = decodeURIComponent(decoded)
  } catch (e) {
    decoded = String(url || '')
  }

  let m = decoded.match(/"jobTitle"\s*:\s*"([^"]+)"/)
  if (m && m[1]) return cleanInline(m[1], 100)

  m = String(url || '').match(/[?&]jobTitle=([^&]+)/)
  if (m && m[1]) {
    try {
      return cleanInline(decodeURIComponent(m[1]), 100)
    } catch (e) {
      return cleanInline(m[1], 100)
    }
  }
  return ''
}

function cleanInline(text, max) {
  const value = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s[\]【】:：,，.。;；!！?？\-—_]+/, '')
    .replace(/[\s[\]【】:：,，.。;；!！?？\-—_]+$/, '')
    .trim()
  if (max && value.length > max) return value.slice(0, max)
  return value
}

function cleanTitle(text, max) {
  const value = String(text || '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleanInline(value, max || 90)
}

function getMarker(body, name) {
  const re = new RegExp('\\[' + name + '\\]\\s*([^\\n]*)')
  const m = String(body || '').match(re)
  return m ? m[1].trim() : ''
}

function hasMarker(body, name) {
  return new RegExp('\\[' + name + '\\]').test(String(body || ''))
}

function stripMarkersAndUrls(body) {
  let text = String(body || '')
  text = text.replace(URL_RE, ' ')
  MARKER_TYPES.forEach((name) => {
    text = text.replace(new RegExp('\\[' + name + '\\]', 'g'), ' ')
  })
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function detectType(body, urls) {
  if (hasMarker(body, '链接') && urls.length) {
    return isWechatHost(urls[0]) ? 'wechat' : 'web'
  }
  for (let i = 0; i < TYPE_PRIORITY.length; i++) {
    const key = TYPE_PRIORITY[i]
    const marker = { file: '文件', image: '图片', mini: '小程序', other: '聊天记录' }[key]
    if (marker && hasMarker(body, marker)) return key
  }
  if (/\[(语音|视频|位置|名片|表情)\]/.test(body)) return 'other'
  if (urls.length) {
    return isWechatHost(urls[0]) ? 'wechat' : 'web'
  }
  return 'text'
}

function hashString(text) {
  let hash = 5381
  const value = String(text || '')
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

function buildTitle(type, body, url) {
  const explicitLinkTitle = cleanTitle(getMarker(body, '链接').replace(URL_RE, ' '), 90)
  const jobTitle = url ? extractJobTitle(url) : ''
  const stripped = stripMarkersAndUrls(body)
  const strippedTitle = cleanTitle(stripped, 90)
  const domain = url ? getDomain(url) : ''

  if (type === 'file' || type === 'image' || type === 'mini') {
    const markerName = { file: '文件', image: '图片', mini: '小程序' }[type]
    const markerText = cleanTitle(getMarker(body, markerName), 120)
    if (markerText) return markerText
    if (strippedTitle) return cleanTitle(strippedTitle, 90)
    return type === 'file' ? '文件线索' : type === 'image' ? '图片线索' : '小程序分享'
  }

  if (type === 'wechat') {
    return explicitLinkTitle || jobTitle || strippedTitle || (domain ? domain : '公众号文章')
  }

  if (type === 'web') {
    return explicitLinkTitle || jobTitle || strippedTitle || domain || '网页链接'
  }

  if (type === 'other') {
    if (hasMarker(body, '聊天记录')) return '聊天记录'
    if (hasMarker(body, '语音')) return '语音消息'
    if (hasMarker(body, '视频')) return '视频消息'
    if (hasMarker(body, '位置')) return '位置消息'
    if (hasMarker(body, '名片')) return '名片消息'
    if (hasMarker(body, '表情')) return '表情消息'
    return strippedTitle || '其他内容'
  }

  const textTitle = cleanTitle(stripped, 30)
  return textTitle || '未命名文本'
}

function getUrlLineText(body, url) {
  const text = String(body || '')
  const index = text.indexOf(url)
  if (index === -1) return ''
  const start = text.lastIndexOf('\n', index)
  const end = text.indexOf('\n', index)
  const line = text.slice(start + 1, end === -1 ? text.length : end)
  return cleanTitle(stripMarkersAndUrls(line), 90)
}

function buildTitleForUrl(type, body, url, urls, index) {
  const allowExplicit = !urls || urls.length <= 1 || index === 0
  const explicitLinkTitle = allowExplicit
    ? cleanTitle(getMarker(body, '链接').replace(URL_RE, ' '), 90)
    : ''
  const jobTitle = url ? extractJobTitle(url) : ''
  const lineTitle = urls && urls.length > 1 ? getUrlLineText(body, url) : ''
  const strippedTitle = cleanTitle(stripMarkersAndUrls(body), 90)
  const domain = url ? getDomain(url) : ''

  if (type === 'wechat') {
    return explicitLinkTitle || jobTitle || lineTitle || strippedTitle || domain || '公众号文章'
  }
  if (type === 'web') {
    return explicitLinkTitle || jobTitle || lineTitle || strippedTitle || domain || '网页链接'
  }
  return buildTitle(type, body, url)
}

function buildContent(type, body) {
  const stripped = stripMarkersAndUrls(body)
  if (type === 'text') return String(body || '').trim()
  if (type === 'file' || type === 'image' || type === 'mini') return stripped
  return stripped
}

function buildSummary(type, body, url) {
  if (type === 'text') {
    return cleanInline(String(body || '').replace(/\s+/g, ' '), 110)
  }
  if (type === 'file' || type === 'image' || type === 'mini') {
    return cleanInline(stripMarkersAndUrls(body).replace(/\s+/g, ' '), 110)
  }
  if (type === 'other') {
    return cleanInline(stripMarkersAndUrls(body).replace(/\s+/g, ' '), 110)
  }
  if (url) {
    return '收录自 ' + (getDomain(url) || '网页')
  }
  return ''
}

function makeDedupeKey(type, url, body, title) {
  if (url) return 'u:' + normalizeUrlForKey(url)
  return 't:' + hashString(type + '|' + title + '|' + String(body || '').trim())
}

const MAX_URLS_PER_MESSAGE = 20

function buildItem(block, type, url, urls, index) {
  const body = String(block.body || '').trim()
  const title = buildTitleForUrl(type, body, url, urls, index)
  const content = buildContent(type, body)
  const summary = buildSummary(type, body, url)
  const domain = url ? getDomain(url) : ''
  const sourceMessageAt = block.timeLabel ? parseMessageDate(block.timeLabel) : null
  const initial = firstLetter(title)
  const dedupeKey = makeDedupeKey(type, url, body, title)

  return {
    content_type: type,
    title,
    url,
    domain,
    summary,
    content,
    source_text: body,
    source_sender: block.sender || '',
    source_time_label: block.timeLabel || '',
    source_message_at: sourceMessageAt,
    title_initial: initial,
    title_bucket: initial === '#' ? 'ZZ' : initial,
    dedupe_key: dedupeKey,
    note: '',
    category_id: null,
    tag_ids: [],
    deleted_at: null
  }
}

function parseBlockItems(block, options) {
  const body = String(block.body || '').trim()
  if (!body) return []

  const urls = extractUrls(body).slice(0, MAX_URLS_PER_MESSAGE)
  const type = detectType(body, urls)

  if ((type === 'web' || type === 'wechat') && urls.length > 1) {
    return urls.map((url, index) => {
      const itemType = isWechatHost(url) ? 'wechat' : 'web'
      return buildItem(block, itemType, url, urls, index)
    })
  }

  return [buildItem(block, type, urls[0] || '', urls, 0)]
}

function parseMessages(rawText, options) {
  const opts = options || {}
  const messages = splitMessages(rawText)
  const items = []
  const failed = []

  messages.forEach((message) => {
    try {
      const parsed = parseBlockItems(message, opts)
      parsed.forEach((item) => items.push(item))
    } catch (e) {
      failed.push({ body: String(message.body || '').slice(0, 120), reason: e.message })
    }
  })

  return { items, failed, messageCount: messages.length }
}

function detectContentType(body) {
  return detectType(String(body || ''), extractUrls(body))
}

module.exports = {
  normalizeText,
  splitMessages,
  isDateLine,
  parseDateLine,
  parseMessageDate,
  extractUrls,
  splitUrl,
  getDomain,
  isWechatHost,
  normalizeUrlForKey,
  extractJobTitle,
  detectType: detectContentType,
  hashString,
  parseMessages,
  buildTitle,
  makeDedupeKey
}
