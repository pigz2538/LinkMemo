const config = require('./config')
const api = require('./utils/api')
const layout = require('./utils/layout')

App({
  globalData: {
    user: null,
    loggedIn: false,
    nav: null,
    cloudEnabled: config.cloudEnabled,
    bootReady: null
  },

  onLaunch() {
    this.globalData.nav = layout.getNavMetrics()
    if (config.cloudEnabled && wx.cloud) {
      try {
        wx.cloud.init({ env: config.cloudEnv || undefined, traceUser: true })
      } catch (e) {
        console.error('cloud init failed', e)
      }
    }
    this.globalData.bootReady = this.boot()
  },

  async boot() {
    try {
      const session = await api.init()
      this.globalData.user = session.user || null
      this.globalData.loggedIn = session.loggedIn !== false
    } catch (e) {
      console.error('boot failed', e)
    }
  }
})
