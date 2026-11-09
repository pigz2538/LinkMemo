const config = require('../../config')
const api = require('../../utils/api')
const nav = require('../../utils/nav')

Page({
  data: {
    id: '',
    item: null,
    loading: true,
    error: '',
    showSource: false
  },

  onLoad(options) {
    this.setData({ id: options.id || '' })
  },

  onShow() {
    if (this.data.id) this.loadDetail()
  },

  async loadDetail() {
    this.setData({ loading: true, error: '' })
    try {
      const item = await api.getArchiveDetail(this.data.id)
      this.setData({ item, loading: false })
    } catch (e) {
      this.setData({ loading: false, error: e.message || '加载失败' })
    }
  },

  toggleSource() {
    this.setData({ showSource: !this.data.showSource })
  },

  onCopyUrl() {
    if (!this.data.item || !this.data.item.url) {
      wx.showToast({ title: '这条记录没有链接', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: this.data.item.url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' })
    })
  },

  onCopy() {
    const item = this.data.item
    if (!item) return
    const options = []
    const values = []
    if (item.url) {
      options.push('复制链接')
      values.push(item.url)
    }
    options.push('复制标题')
    values.push(item.title)
    const content = item.content || item.source_text
    if (content) {
      options.push('复制正文')
      values.push(content)
    }

    if (options.length === 1) {
      this.copyText(values[0])
      return
    }

    wx.showActionSheet({
      itemList: options,
      success: (res) => {
        const value = values[res.tapIndex]
        if (value) this.copyText(value)
      }
    })
  },

  copyText(text) {
    wx.setClipboardData({
      data: String(text || ''),
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  onOpen() {
    const item = this.data.item
    if (!item || !item.url) {
      wx.showToast({ title: '这条记录没有可打开的链接', icon: 'none' })
      return
    }
    const domain = item.domain || ''
    if (config.webviewDomains.indexOf(domain) !== -1) {
      wx.navigateTo({
        url: '/pages/webview/webview?url=' + encodeURIComponent(item.url) + '&title=' + encodeURIComponent(item.title)
      })
      return
    }
    wx.setClipboardData({
      data: item.url,
      success: () => {
        wx.showModal({
          title: '链接已复制',
          content: '小程序内暂不能直接打开该网页，链接已复制，可在浏览器或微信中打开。',
          showCancel: false,
          confirmText: '知道了'
        })
      }
    })
  },

  onEdit() {
    wx.navigateTo({ url: '/pages/edit/edit?id=' + this.data.id })
  },

  async onDelete() {
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '删除记录',
        content: '删除后将移入回收站，可在一段时间内恢复。',
        confirmText: '删除',
        confirmColor: '#DA5A5A',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return
    try {
      await api.deleteArchive([this.data.id])
      wx.showToast({ title: '已移入回收站', icon: 'success' })
      setTimeout(() => this.goBack(), 350)
    } catch (e) {
      wx.showToast({ title: e.message || '删除失败', icon: 'none' })
    }
  },

  onCategoryTap() {
    const item = this.data.item
    if (!item || !item.category_id) return
    nav.openArchiveWithFilter({ category_id: item.category_id })
  },

  onTagTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    nav.openArchiveWithFilter({ tag_ids: [id] })
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/archive/archive' })
    }
  },

  onBackToArchive() {
    this.goBack()
  },

  onShareAppMessage() {
    const item = this.data.item
    return {
      title: item ? item.title : '拾链 · 归档详情',
      path: '/pages/detail/detail?id=' + this.data.id
    }
  }
})
