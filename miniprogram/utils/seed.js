const { firstLetter } = require('./pinyin')
const { hashString, normalizeUrlForKey, getDomain } = require('./parser')

const CATEGORY_SEED = [
  { name: '求职', color: '#F0A03C' },
  { name: '学习', color: '#4C8DFF' },
  { name: '工作', color: '#2E9E5B' },
  { name: '生活', color: '#7B61FF' },
  { name: '旅行', color: '#3FBFB0' }
]

const TAG_SEED = [
  { name: '招聘', color: '#F0A03C' },
  { name: '重要', color: '#DA5A5A' },
  { name: '论文', color: '#7B61FF' },
  { name: '待阅读', color: '#2E9E5B' },
  { name: '组会', color: '#4C8DFF' },
  { name: '科研', color: '#3FBFB0' },
  { name: '周末', color: '#E0A54C' }
]

const ITEM_SEED = [
  {
    type: 'wechat',
    title: '“汇聚英才 众创未来”2026年秋季湖北高校就业促进巡回招聘会——武汉大学站',
    url: 'http://mp.weixin.qq.com/s?__biz=MzAxNDE2ODQxOQ==&mid=2651003032&idx=1&sn=04dbf36d995fadfb93136008355c7c6d&chksm=8108477c79b5c1a4770a3a348ef78a7fb0d275b28fdf99a2ba4dc88998b785b9ae28ad9d4afe&scene=0&xtrack=1#rd',
    summary: '武汉大学站秋季校园招聘会，面向 2027 届高校毕业生。',
    content: '汇聚英才 众创未来，2026年秋季湖北高校就业促进巡回招聘会武汉大学站。',
    category: '求职',
    tags: ['招聘'],
    hoursAgo: 1,
    sourceLabel: '2026年11月09日 21:43'
  },
  {
    type: 'web',
    title: '研究员（标准化工作） - 国科量子中心',
    url: 'https://q.yingjiesheng.com/jobdetail/165746825.html?jobTitle=%E7%A0%94%E7%A9%B6%E5%91%98%EF%BC%88%E6%A0%87%E5%87%86%E5%8C%96%E5%B7%A5%E4%BD%9C%EF%BC%89',
    summary: '国科量子通信网络有限公司 · 1-2万·16薪 · 武汉',
    content: '研究员（标准化工作），国科量子通信网络有限公司，1-2万·16薪。',
    category: '求职',
    tags: ['招聘', '重要'],
    hoursAgo: 2,
    sourceLabel: '2026年11月09日 16:52'
  },
  {
    type: 'text',
    title: '账号认证说明',
    content: '您好，我是上述账号的持有人，账号认证类型始终为个人认证开发者，未以企业或组织名义注册、运营任何应用。现就近期客服沟通中提及的“个人账号不再提供免费配额”“仅限短期测试”等说法，提交本工单说明实际使用场景，并申请按平台规则正常使用基础服务配额。',
    summary: '个人认证开发者科研学习场景说明与配额申诉。',
    category: '工作',
    tags: ['重要'],
    hoursAgo: 3,
    sourceLabel: '2026年11月09日 17:50'
  },
  {
    type: 'wechat',
    title: '微塑料蓝是什么蓝？| 一周论文新鲜读',
    url: 'http://mp.weixin.qq.com/s?__biz=MzAwNTAyMDY0MQ==&mid=2652747458&idx=1&sn=c7a40842e5e425b7ad6fa1e3bddcf7b3&chksm=80ca184cb7bd915a4c9da9a1d38f2e876149896ad0663ddcf85cb8b1889cf98ebc18ac3ac90d#rd',
    summary: '一周论文新鲜读：微塑料的环境颜色、来源与检测方法。',
    content: '微塑料蓝是什么蓝？本周论文解读。',
    category: '学习',
    tags: ['论文', '待阅读'],
    hoursAgo: 4,
    sourceLabel: '2026年11月09日 21:53'
  },
  {
    type: 'mini',
    title: '【焓姨专属】盐都老味道✅下厨房富顺豆花｜非遗技艺盐卤点制，软嫩好消化，老少都爱的温润大豆蛋白',
    url: '',
    summary: '正宗富顺胆水豆花，蜂巢多孔水嫩款，豆香清甜无豆腥。',
    content: '🥢正宗富顺胆水豆花｜拒绝实心豆腐块！蜂巢多孔水嫩款，豆香清甜无豆腥，火锅豆花饭百搭。',
    category: '生活',
    tags: ['周末'],
    hoursAgo: 5,
    sourceLabel: '2026年11月09日 21:45'
  },
  {
    type: 'file',
    title: '试卷.pdf',
    content: '试卷.pdf',
    summary: '微信文件线索，仅保存文件名，不代表文件已上传。',
    category: '学习',
    tags: ['待阅读'],
    hoursAgo: 6,
    sourceLabel: '2026年11月06日 11:18'
  },
  {
    type: 'image',
    title: '微信图片_20261109151804_236.dat',
    content: '微信图片_20261109151804_236.dat',
    summary: '微信图片线索，仅保存文件名，不读取图片内容。',
    category: '生活',
    tags: [],
    hoursAgo: 7,
    sourceLabel: '2026年11月09日 15:18'
  },
  {
    type: 'text',
    title: '等不到李老师',
    content: '等不到李老师',
    summary: '等不到李老师',
    category: '生活',
    tags: [],
    hoursAgo: 8,
    sourceLabel: '2026年11月09日 16:53'
  },
  {
    type: 'web',
    title: '学生就业服务平台',
    url: 'https://www.91wllm.cn/user/student',
    summary: '91 就业服务平台学生端入口。',
    content: '学生就业服务平台',
    category: '求职',
    tags: [],
    hoursAgo: 9,
    sourceLabel: '2026年11月01日 19:10'
  },
  {
    type: 'wechat',
    title: '网络“翻墙”行为不可为，违纪违法毁前程！',
    url: 'https://mp.weixin.qq.com/s/Nj7vKoC31jbmmXThSw0X3g',
    summary: '网络安全与合规提醒。',
    content: '网络“翻墙”行为不可为，违纪违法毁前程！',
    category: '工作',
    tags: ['重要'],
    hoursAgo: 10,
    sourceLabel: '2026年10月25日 19:42'
  },
  {
    type: 'text',
    title: '记得有事情',
    content: '记得有事情',
    summary: '记得有事情',
    category: '生活',
    tags: ['周末'],
    hoursAgo: 11,
    sourceLabel: '2026年11月09日 21:44'
  },
  {
    type: 'file',
    title: '2026.10.17组会.pptx',
    content: '2026.10.17组会.pptx',
    summary: '组会汇报材料文件线索。',
    category: '学习',
    tags: ['组会'],
    hoursAgo: 12,
    sourceLabel: '2026年10月17日 14:01'
  },
  {
    type: 'wechat',
    title: '新婚夫妇从广州开车去河南拍结婚照，途经服务区时不慎把10克黄金婚戒掉进卫生间下水管道',
    url: 'http://mp.weixin.qq.com/s?__biz=MjM5ODAyNTcwMA==&mid=2653380500&idx=1&sn=8488eb00d5861bd243d7b75d1305d312&chksm=bceb6c54e74a1a05532dd7f091e972087c521bc7a304d5b738401f243a9ab5edf5f2abdbf2f8&scene=0&xtrack=1#rd',
    summary: '工作人员拆除下水管道找了 7 个半小时寻回婚戒。',
    content: '新婚夫妇从广州开车去河南拍结婚照，途经服务区时不慎把10克黄金婚戒掉进卫生间下水管道。',
    category: '生活',
    tags: [],
    hoursAgo: 13,
    sourceLabel: '2026年11月09日 21:53'
  },
  {
    type: 'web',
    title: '【给媒专属】盐都老味道：下厨房复刻富顺豆花',
    url: 'https://www.xiachufang.com/recipe/107000000/',
    summary: '川南盐卤古法点浆，自带糍粑辣椒蘸水。',
    content: '【给媒专属】盐都老味道：下厨房复刻富顺豆花。',
    category: '生活',
    tags: ['周末'],
    hoursAgo: 14,
    sourceLabel: '2026年11月09日 21:45'
  },
  {
    type: 'text',
    title: '北京玻色量子科技股份有限公司',
    content: '北京玻色量子科技股份有限公司',
    summary: '北京玻色量子科技股份有限公司',
    category: '求职',
    tags: ['招聘'],
    hoursAgo: 15,
    sourceLabel: '2026年11月06日 17:35'
  },
  {
    type: 'text',
    title: '中资信息技术应用创新促进中心有限公司',
    content: '中资信息技术应用创新促进中心有限公司',
    summary: '中资信息技术应用创新促进中心有限公司',
    category: '求职',
    tags: [],
    hoursAgo: 16,
    sourceLabel: '2026年11月03日 21:25'
  }
]

function buildSeed(now) {
  const base = now || Date.now()
  const userId = 'u_local_demo'

  const categories = CATEGORY_SEED.map((c, index) => ({
    _id: 'cat_' + (index + 1),
    user_id: userId,
    name: c.name,
    color: c.color,
    sort_order: index,
    created_at: base - 86400000 * 30,
    updated_at: base - 86400000 * 30
  }))

  const tags = TAG_SEED.map((t, index) => ({
    _id: 'tag_' + (index + 1),
    user_id: userId,
    name: t.name,
    color: t.color,
    created_at: base - 86400000 * 30,
    updated_at: base - 86400000 * 30
  }))

  const catMap = {}
  categories.forEach((c) => { catMap[c.name] = c._id })
  const tagMap = {}
  tags.forEach((t) => { tagMap[t.name] = t._id })

  const items = ITEM_SEED.map((def, index) => {
    const savedAt = base - def.hoursAgo * 3600000
    const sourceAt = parseSourceTime(def.sourceLabel)
    const url = def.url || ''
    const body = def.content || def.title
    return {
      _id: 'item_' + (index + 1),
      user_id: userId,
      batch_id: 'seed_batch',
      content_type: def.type,
      title: def.title,
      url,
      domain: url ? getDomain(url) : '',
      summary: def.summary || '',
      content: body,
      source_text: body,
      note: '',
      category_id: def.category ? catMap[def.category] : null,
      tag_ids: (def.tags || []).map((name) => tagMap[name]).filter(Boolean),
      saved_at: savedAt,
      source_message_at: sourceAt,
      source_time_label: def.sourceLabel || '',
      source_sender: 'AAA猪彼得',
      title_initial: firstLetter(def.title),
      dedupe_key: url ? 'u:' + normalizeUrlForKey(url) : 't:' + hashString(def.type + '|' + def.title + '|' + body),
      deleted_at: null
    }
  })

  return {
    version: 1,
    user: {
      _id: userId,
      openid_masked: 'o****local',
      display_name: 'AAA猪彼得',
      avatar_url: '/assets/images/avatar-bear.png',
      login_type: '微信登录',
      plan: '个人版',
      created_at: base - 86400000 * 30,
      last_login_at: base,
      status: 'active'
    },
    categories,
    tags,
    items,
    batches: [{
      _id: 'seed_batch',
      user_id: userId,
      raw_length: 3600,
      total_count: items.length,
      success_count: items.length,
      duplicate_count: 0,
      failed_count: 0,
      created_at: base - 3600000
    }]
  }
}

function parseSourceTime(label) {
  const m = String(label || '').match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

module.exports = { buildSeed, CATEGORY_SEED, TAG_SEED }
