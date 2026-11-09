const layout = require('../../utils/layout')

Component({
  properties: {
    title: { type: String, value: '' },
    showBack: { type: Boolean, value: false },
    brand: { type: Boolean, value: false },
    transparent: { type: Boolean, value: false }
  },

  data: {
    statusBarHeight: 20,
    navBarHeight: 44
  },

  lifetimes: {
    attached() {
      const metrics = layout.getNavMetrics()
      this.setData({
        statusBarHeight: metrics.statusBarHeight,
        navBarHeight: metrics.navBarHeight
      })
    }
  },

  methods: {
    onBack() {
      const pages = getCurrentPages()
      if (pages.length > 1) {
        wx.navigateBack()
      } else {
        wx.switchTab({ url: '/pages/collect/collect' })
      }
      this.triggerEvent('back')
    }
  }
})
