const dns = require('dns').promises
const net = require('net')
const axios = require('axios')
const cheerio = require('cheerio')
const { firstLetter } = require('./pinyin')

const MAX_BYTES = 512 * 1024
const MAX_REDIRECTS = 3
const TIMEOUT = 2500
const MAX_FETCH_ITEMS = 3

const BLOCKED_HOSTS = [
  'localhost',
  'metadata.google.internal',
  'metadata.tencentyun.com',
  'metadata.tencent.internal'
]

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

function inCidr(ip, base, bits) {
  const value = ipv4ToInt(ip)
  const baseValue = ipv4ToInt(base)
  if (value === null || baseValue === null) return false
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (value & mask) === (baseValue & mask)
}

function isBlockedIpv4(ip) {
  return (
    inCidr(ip, '0.0.0.0', 8) ||
    inCidr(ip, '10.0.0.0', 8) ||
    inCidr(ip, '100.64.0.0', 10) ||
    inCidr(ip, '127.0.0.0', 8) ||
    inCidr(ip, '169.254.0.0', 16) ||
    inCidr(ip, '172.16.0.0', 12) ||
    inCidr(ip, '192.0.0.0', 24) ||
    inCidr(ip, '192.0.2.0', 24) ||
    inCidr(ip, '192.88.99.0', 24) ||
    inCidr(ip, '192.168.0.0', 16) ||
    inCidr(ip, '198.18.0.0', 15) ||
    inCidr(ip, '198.51.100.0', 24) ||
    inCidr(ip, '203.0.113.0', 24) ||
    inCidr(ip, '224.0.0.0', 4) ||
    inCidr(ip, '240.0.0.0', 4)
  )
}

function isBlockedIpv6(ip) {
  const value = ip.toLowerCase()
  if (value === '::' || value === '::1') return true
  if (value.startsWith('fc') || value.startsWith('fd')) return true
  if (/^fe[89ab]/.test(value)) return true
  if (value.startsWith('ff')) return true
  if (value.startsWith('2001:db8:')) return true
  if (value.startsWith('::ffff:')) {
    const mapped = value.replace('::ffff:', '')
    if (net.isIPv4(mapped)) return isBlockedIpv4(mapped)
  }
  return false
}

function isBlockedIp(ip) {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip)
  if (net.isIPv6(ip)) return isBlockedIpv6(ip)
  return true
}

async function assertSafeUrl(rawUrl) {
  let url
  try {
    url = new URL(String(rawUrl || '').trim())
  } catch (e) {
    throw new Error('链接格式无效')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅支持 HTTP/HTTPS 链接')
  }
  if (url.username || url.password) {
    throw new Error('链接不能包含账号信息')
  }

  const hostname = url.hostname.toLowerCase()
  if (!hostname) throw new Error('链接缺少域名')
  if (BLOCKED_HOSTS.indexOf(hostname) !== -1) throw new Error('该地址不允许访问')
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('该地址不允许访问')
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error('该地址不允许访问')
    return url
  }

  let addresses
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch (e) {
    throw new Error('域名解析失败')
  }
  if (!addresses.length) throw new Error('域名解析失败')
  for (let i = 0; i < addresses.length; i++) {
    if (isBlockedIp(addresses[i].address)) {
      throw new Error('该地址不允许访问')
    }
  }
  return url
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
    if (!addresses.length) {
      callback(new Error('域名解析失败'))
      return
    }
    for (let i = 0; i < addresses.length; i++) {
      if (isBlockedIp(addresses[i].address)) {
        callback(new Error('该地址不允许访问'))
        return
      }
    }
    const family = options && options.family
    const chosen = family ? addresses.find((item) => item.family === family) : addresses[0]
    if (!chosen) {
      callback(new Error('域名解析失败'))
      return
    }
    callback(null, chosen.address, chosen.family)
  }).catch((e) => {
    callback(e)
  })
}

function clean(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!value) return ''
  return max && value.length > max ? value.slice(0, max) : value
}

function extractMeta(html, finalUrl) {
  const $ = cheerio.load(html)
  const meta = (selector) => {
    const node = $(selector).first()
    return node.length ? node.attr('content') || '' : ''
  }

  const ogTitle = meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]')
  const activityTitle = $('#activity-name').first().text()
  const htmlTitle = $('title').first().text()
  const description = meta('meta[property="og:description"]') ||
    meta('meta[name="description"]') ||
    meta('meta[name="twitter:description"]')

  let bodyText = ''
  if (!description) {
    const paragraphs = []
    $('p').slice(0, 8).each((_, el) => {
      const text = clean($(el).text(), 260)
      if (text) paragraphs.push(text)
    })
    bodyText = clean(paragraphs.join(' '), 200)
  }

  return {
    title: clean(ogTitle || activityTitle || htmlTitle, 160),
    description: clean(description || bodyText, 300),
    final_url: finalUrl
  }
}

async function fetchPage(rawUrl) {
  let current = String(rawUrl || '').trim()

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const safeUrl = await assertSafeUrl(current)
    let response
    try {
      response = await axios.get(safeUrl.href, {
        maxRedirects: 0,
        timeout: TIMEOUT,
        responseType: 'text',
        maxContentLength: MAX_BYTES,
        maxBodyLength: MAX_BYTES,
        decompress: false,
        lookup: safeLookup,
        validateStatus: (status) => status >= 200 && status < 400,
        transformResponse: [(data) => data],
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36 LinkMemoBot/1.1',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
          'Accept-Encoding': 'identity'
        }
      })
    } catch (e) {
      throw new Error(e.code === 'ECONNABORTED' ? '网页请求超时' : '网页请求失败')
    }

    if (response.status >= 300) {
      const location = response.headers && response.headers.location
      if (!location) throw new Error('网页重定向缺少目标地址')
      current = new URL(location, safeUrl).href
      continue
    }

    const contentType = String((response.headers && response.headers['content-type']) || '').toLowerCase()
    if (contentType && contentType.indexOf('html') === -1 && contentType.indexOf('xml') === -1) {
      throw new Error('目标不是网页内容')
    }

    const html = typeof response.data === 'string' ? response.data : String(response.data || '')
    if (Buffer.byteLength(html, 'utf8') > MAX_BYTES) {
      throw new Error('网页内容过大')
    }

    return extractMeta(html, safeUrl.href)
  }

  throw new Error('网页重定向次数过多')
}

async function enrichWebItems(items) {
  const targets = items
    .filter((item) => item.content_type === 'web' && item.url)
    .slice(0, MAX_FETCH_ITEMS)

  const queue = targets.slice()
  const results = []

  async function worker() {
    while (queue.length) {
      const item = queue.shift()
      try {
        const meta = await fetchPage(item.url)
        results.push({ item, meta })
      } catch (e) {
        results.push({ item, error: e.message || '抓取失败' })
      }
    }
  }

  const workers = []
  for (let i = 0; i < 3; i++) workers.push(worker())
  await Promise.all(workers)

  results.forEach((entry) => {
    const item = entry.item
    if (entry.error) {
      item.fetch_error = entry.error
      return
    }
    const meta = entry.meta
    const fallbackTitle = !item.title ||
      item.title === item.domain ||
      item.title === '网页链接' ||
      item.title === '未命名文本'
    if (meta.title && fallbackTitle) {
      item.title = meta.title
      item.title_initial = firstLetter(meta.title)
      item.title_bucket = item.title_initial === '#' ? 'ZZ' : item.title_initial
    }
    if (meta.description && (!item.summary || item.summary.indexOf('收录自') === 0)) {
      item.summary = meta.description
    }
    item.fetched_at = Date.now()
  })

  return items
}

module.exports = {
  fetchPage,
  enrichWebItems,
  assertSafeUrl,
  isBlockedIp,
  extractMeta
}
