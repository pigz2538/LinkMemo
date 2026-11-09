Page({
  data: {
    url: '',
    title: ''
  },

  onLoad(options) {
    const url = options.url ? decodeURIComponent(options.url) : ''
    const title = options.title ? decodeURIComponent(options.title) : ''
    this.setData({ url, title })
    if (title) {
      wx.setNavigationBarTitle({ title })
    }
  },

  onError() {
    wx.showToast({ title: '网页加载失败，已复制链接', icon: 'none' })
    if (this.data.url) {
      wx.setClipboardData({ data: this.data.url })
    }
  }
})
