const TYPE_META = {
  wechat: {
    key: 'wechat',
    label: '公众号',
    short: '公众号',
    icon: '/assets/icons/type-wechat.png',
    color: '#2E9E5B'
  },
  web: {
    key: 'web',
    label: '网页',
    short: '网页',
    icon: '/assets/icons/type-web.png',
    color: '#4C8DFF'
  },
  text: {
    key: 'text',
    label: '文本',
    short: '文本',
    icon: '/assets/icons/type-text.png',
    color: '#7B61FF'
  },
  mini: {
    key: 'mini',
    label: '小程序',
    short: '小程序',
    icon: '/assets/icons/type-mini.png',
    color: '#2E9E5B'
  },
  file: {
    key: 'file',
    label: '文件线索',
    short: '文件',
    icon: '/assets/icons/type-file.png',
    color: '#F0A03C'
  },
  image: {
    key: 'image',
    label: '图片线索',
    short: '图片',
    icon: '/assets/icons/type-image.png',
    color: '#3F9FE0'
  },
  other: {
    key: 'other',
    label: '其他',
    short: '其他',
    icon: '/assets/icons/type-other.png',
    color: '#7C8781'
  }
}

const TYPE_ORDER = ['all', 'wechat', 'web', 'text', 'mini', 'file', 'image', 'other']

function pad(value) {
  return value < 10 ? '0' + value : '' + value
}

function formatDate(timestamp) {
  if (!timestamp) return ''
  const d = new Date(Number(timestamp))
  if (Number.isNaN(d.getTime())) return ''
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function formatDateTime(timestamp) {
  if (!timestamp) return ''
  const d = new Date(Number(timestamp))
  if (Number.isNaN(d.getTime())) return ''
  return formatDate(timestamp) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function startOfDay(timestamp) {
  const d = new Date(Number(timestamp))
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function endOfDay(timestamp) {
  const d = new Date(Number(timestamp))
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

function getTypeMeta(type) {
  return TYPE_META[type] || TYPE_META.other
}

function truncate(text, max) {
  const value = String(text || '')
  if (value.length <= max) return value
  return value.slice(0, max) + '…'
}

function decorateItem(item, categories, tags) {
  const catMap = {}
  const tagMap = {}
  ;(categories || []).forEach((c) => { catMap[c._id] = c })
  ;(tags || []).forEach((t) => { tagMap[t._id] = t })
  const meta = getTypeMeta(item.content_type)
  const category = item.category_id ? catMap[item.category_id] : null
  const itemTags = (item.tag_ids || []).map((id) => tagMap[id]).filter(Boolean)

  return Object.assign({}, item, {
    type_label: meta.label,
    type_short: meta.short,
    type_icon: meta.icon,
    type_color: meta.color,
    category_name: category ? category.name : '未分类',
    category_color: category ? category.color : '#B8C2BC',
    tags: itemTags,
    saved_date: formatDate(item.saved_at),
    saved_time: formatDateTime(item.saved_at),
    source_time_text: item.source_message_at ? formatDateTime(item.source_message_at) : '',
    display_summary: item.summary || (item.url ? item.domain : truncate(item.content, 90))
  })
}

module.exports = {
  TYPE_META,
  TYPE_ORDER,
  formatDate,
  formatDateTime,
  startOfDay,
  endOfDay,
  getTypeMeta,
  truncate,
  decorateItem
}
