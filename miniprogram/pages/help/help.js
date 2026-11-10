const config = require('../../config')
const { getMode, getModeLabel } = require('../../utils/mode')

const MODE = getMode()
const MODE_LABEL = getModeLabel()
const DATA_STORAGE_ANSWER = MODE === 'http'
  ? '当前为自建服务器模式，数据保存在你的云数据库（PostgreSQL）中，并通过登录令牌按账号隔离。'
  : MODE === 'cloud'
    ? '当前为 CloudBase 模式，数据保存在你的 CloudBase 环境中，并按微信用户 openid 隔离。'
    : '当前为本地模式，数据保存在当前设备的微信本地 Storage 中。'

const FAQS = [
  {
    q: '为什么有的网页没有识别到标题？',
    a: '公众号会优先使用聊天分享文本中的标题；普通网页会尝试抓取 og:title 和 HTML title。部分网页需要登录、有反爬限制或请求超时，此时会用域名兜底，你可以在编辑页手动修改标题。'
  },
  {
    q: '网页抓取失败会丢内容吗？',
    a: '不会。抓取失败时仍会保存原始 URL、聊天文本和基础识别结果，只是没有网页标题和摘要。'
  },
  {
    q: '为什么提示「已收录」？',
    a: '同一微信用户重复导入同一链接时，默认会跳过。首页可以切换为「仍然保存」，解析结果页也可以选择再次保存重复内容。'
  },
  {
    q: '读取剪贴板为空怎么办？',
    a: '请先在微信中多选并复制聊天内容，再回到拾链点击「读取剪贴板」；也可以直接长按输入框手动粘贴。'
  },
  {
    q: '为什么链接不能在小程序内打开？',
    a: '小程序的 web-view 只能打开已配置的业务域名。未配置的链接会复制到剪贴板，你可以在浏览器或微信中打开。'
  },
  {
    q: '图片和文件会被上传吗？',
    a: '不会。图片、文件、小程序等分享线索只保存你在聊天中可见的文件名、标题和文本，不读取或上传图片/文件本体。'
  },
  {
    q: '我的数据存在哪里？',
    a: DATA_STORAGE_ANSWER
  }
]

Page({
  data: {
    version: config.version,
    modeLabel: MODE_LABEL,
    feedbackEmail: config.feedbackEmail,
    faqs: FAQS.map((item, index) => Object.assign({}, item, { open: index === 0 })),
    steps: [
      {
        title: '多选复制聊天内容',
        desc: '在微信中长按消息 → 多选 → 复制，支持一次复制多条混合消息。',
        icon: '/assets/icons/copy-gray.png'
      },
      {
        title: '粘贴或读取剪贴板',
        desc: '回到拾链，粘贴到输入框，或点击「读取剪贴板」按钮。',
        icon: '/assets/icons/clipboard-green.png'
      },
      {
        title: '解析后整理',
        desc: '自动拆分消息、识别类型，补充标题、分类和标签，长期归档。',
        icon: '/assets/icons/tag-green.png'
      }
    ],
    examples: [
      { type: '公众号', sample: '[链接] 微塑料蓝是什么蓝？| 一周论文新鲜读 https://mp.weixin.qq.com/s/...' },
      { type: '网页', sample: 'https://q.yingjiesheng.com/jobdetail/165746825.html?jobTitle=...' },
      { type: '文本', sample: '等不到李老师' },
      { type: '文件线索', sample: '[文件] 试卷.pdf' },
      { type: '图片线索', sample: '[图片] 微信图片_20261109151804_236.dat' },
      { type: '小程序', sample: '[小程序] 【焓姨专属】盐都老味道...' }
    ],
    limits: [
      '小程序无法直接读取微信聊天记录，只处理你主动粘贴或读取的剪贴板文本。',
      '文件、图片、小程序线索只保存可见文本，不代表文件本体或图片已上传。',
      '不承诺所有外部网页都能在小程序内打开。',
      '网页抓取只访问你提交的公开 URL，不携带你的微信登录凭证。'
    ]
  },

  toggleFaq(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({
      faqs: this.data.faqs.map((item, i) => (
        i === index ? Object.assign({}, item, { open: !item.open }) : item
      ))
    })
  },

  onCopyExample() {
    const text = 'AAA猪彼得\n2026年11月09日 21:53\n[链接] 微塑料蓝是什么蓝？| 一周论文新鲜读 https://mp.weixin.qq.com/s/example\n\nAAA猪彼得\n2026年11月09日 21:44\n记得有事情\n\nAAA猪彼得\n2026年11月09日 21:45\n[文件] 试卷.pdf'
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '示例格式已复制', icon: 'success' })
    })
  },

  onFeedback() {
    wx.showModal({
      title: '问题反馈',
      content: '可以将反馈模板复制后发送到：' + this.data.feedbackEmail + '\n\n也可以直接把问题和截图发给开发者。',
      confirmText: '复制模板',
      cancelText: '关闭',
      success: (res) => {
        if (res.confirm) this.onCopyFeedback()
      }
    })
  },

  onCopyFeedback() {
    const text = '拾链问题反馈\n小程序版本：v' + this.data.version +
      '\n运行模式：' + this.data.modeLabel +
      '\n问题描述：\n复现步骤：\n补充截图或说明：'
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '反馈模板已复制', icon: 'success' })
    })
  },

  onCopyEmail() {
    wx.setClipboardData({
      data: this.data.feedbackEmail,
      success: () => wx.showToast({ title: '邮箱已复制', icon: 'success' })
    })
  }
})
