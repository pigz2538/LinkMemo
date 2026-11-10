const config = require('../../config')
const api = require('../../utils/api')
const settings = require('../../utils/settings')
const tabbar = require('../../utils/tabbar')
const { getModeLabel } = require('../../utils/mode')

const SORT_OPTIONS = [
  { key: 'saved_desc', label: '最新收录优先', chip: '最新优先', desc: '默认按收录时间从新到旧' },
  { key: 'saved_asc', label: '最早收录优先', chip: '最早优先', desc: '按收录时间从旧到新' },
  { key: 'title_asc', label: '标题拼音 A-Z', chip: '标题 A-Z', desc: '数字与特殊字符归入 #' },
  { key: 'title_desc', label: '标题拼音 Z-A', chip: '标题 Z-A', desc: '数字与特殊字符归入 #' }
]

Page({
  data: {
    user: null,
    displayName: '未登录',
    avatar: '/assets/images/avatar-bear.png',
    loggedIn: false,
    loginText: '点击登录 · 微信小程序',
    stats: {
      total_count: 0,
      category_count: 0,
      tag_count: 0,
      recycle_count: 0
    },
    loading: true,
    version: config.version,
    modeLabel: getModeLabel(),
    sortOptions: SORT_OPTIONS,
    currentSort: config.defaultSort,
    currentSortLabel: '最新优先',
    showSortSheet: false,
    showDataSheet: false,
    showPrivacySheet: false,
    showAboutSheet: false
  },

  onShow() {
    tabbar.setSelected(2)
    this.syncTabBar()
    this.load()
  },

  onHide() {
    tabbar.show()
  },

  onUnload() {
    tabbar.show()
  },

  syncTabBar() {
    const shouldHide = this.data.showSortSheet ||
      this.data.showDataSheet ||
      this.data.showPrivacySheet ||
      this.data.showAboutSheet
    if (shouldHide) tabbar.hide()
    else tabbar.show()
  },

  async load() {
    try {
      const app = getApp()
      if (app && app.globalData && app.globalData.bootReady) {
        try {
          await app.globalData.bootReady
        } catch (e) {}
      }
      const session = await api.getSession() || {}
      const user = session.user || null
      const currentSort = settings.getSettings().default_sort || config.defaultSort
      const sortOption = SORT_OPTIONS.find((item) => item.key === currentSort) || SORT_OPTIONS[0]

      if (!session.loggedIn) {
        this.setData({
          user,
          loggedIn: false,
          displayName: '未登录',
          avatar: user && user.avatar_url ? user.avatar_url : '/assets/images/avatar-bear.png',
          loginText: '点击登录 · 微信小程序',
          stats: { total_count: 0, category_count: 0, tag_count: 0, recycle_count: 0, type_counts: {} },
          currentSort,
          currentSortLabel: sortOption.chip || sortOption.label,
          loading: false
        })
        return
      }

      const stats = await api.getProfileStats()
      this.setData({
        user,
        loggedIn: true,
        displayName: user && user.display_name ? user.display_name : '微信用户',
        avatar: user && user.avatar_url ? user.avatar_url : '/assets/images/avatar-bear.png',
        loginText: '微信登录 · 个人版',
        stats: Object.assign({}, this.data.stats, stats),
        currentSort,
        currentSortLabel: sortOption.chip || sortOption.label,
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  async onAvatarTap() {
    if (!this.data.loggedIn) {
      await this.onLogin()
      return
    }
    const user = this.data.user || {}
    wx.showModal({
      title: '账号信息',
      content: '昵称：' + (user.display_name || '微信用户') +
        '\n登录方式：' + (user.login_type || '微信登录') +
        '\n账号标识：' + (user.openid_masked || '已脱敏') +
        '\n数据空间：仅当前微信用户可见',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  async onLogin() {
    try {
      const result = await api.login()
      if (result && result.user) {
        this.setData({
          user: result.user,
          loggedIn: true,
          displayName: result.user.display_name || '微信用户',
          avatar: result.user.avatar_url || '/assets/images/avatar-bear.png',
          loginText: '微信登录 · 个人版'
        })
      }
      wx.showToast({ title: '登录成功', icon: 'success' })
      this.load()
    } catch (e) {
      wx.showToast({ title: e.message || '登录失败', icon: 'none' })
    }
  },

  async onLogout() {
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '退出登录',
        content: '退出后本机将不再显示登录状态，归档数据仍保存在你的账号下。',
        confirmText: '退出',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return
    try {
      await api.logout()
      this.setData({
        loggedIn: false,
        displayName: '未登录',
        loginText: '点击登录 · 微信小程序',
        stats: { total_count: 0, category_count: 0, tag_count: 0, recycle_count: 0, type_counts: {} }
      })
      wx.showToast({ title: '已退出登录', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: e.message || '退出失败', icon: 'none' })
    }
  },

  onStatsTap(e) {
    const type = e.currentTarget.dataset.type
    if (type === 'total') {
      wx.switchTab({ url: '/pages/archive/archive' })
    } else if (type === 'category') {
      wx.navigateTo({ url: '/pages/category/category?tab=category' })
    } else if (type === 'tag') {
      wx.navigateTo({ url: '/pages/category/category?tab=tag' })
    }
  },

  onOpenCategory() {
    wx.navigateTo({ url: '/pages/category/category?tab=category' })
  },

  onOpenHelp() {
    wx.navigateTo({ url: '/pages/help/help' })
  },

  onOpenRecycle() {
    this.setData({ showDataSheet: false })
    this.syncTabBar()
    wx.navigateTo({ url: '/pages/recycle/recycle' })
  },

  onOpenSort() {
    this.setData({ showSortSheet: true })
    this.syncTabBar()
  },

  onCloseSort() {
    this.setData({ showSortSheet: false })
    this.syncTabBar()
  },

  onSortTap(e) {
    const key = e.currentTarget.dataset.key
    settings.saveSettings({ default_sort: key })
    const option = SORT_OPTIONS.find((item) => item.key === key) || SORT_OPTIONS[0]
    this.setData({
      currentSort: key,
      currentSortLabel: option.chip || option.label,
      showSortSheet: false
    })
    this.syncTabBar()
    wx.showToast({ title: '默认排序已更新', icon: 'success' })
  },

  onOpenData() {
    this.setData({ showDataSheet: true })
    this.syncTabBar()
  },

  onCloseData() {
    this.setData({ showDataSheet: false })
    this.syncTabBar()
  },

  async onExportData() {
    this.setData({ showDataSheet: false })
    this.syncTabBar()
    try {
      wx.showLoading({ title: '正在导出' })
      const data = await api.exportData()
      const text = JSON.stringify(data, null, 2)
      wx.hideLoading()
      wx.setClipboardData({
        data: text,
        success: () => {
          wx.showModal({
            title: '导出完成',
            content: '已复制 ' + ((data.items && data.items.length) || 0) + ' 条记录及分类标签数据（JSON）到剪贴板。',
            showCancel: false,
            confirmText: '知道了'
          })
        },
        fail: () => {
          wx.showToast({ title: '复制失败，请重试', icon: 'none' })
        }
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '导出失败', icon: 'none' })
    }
  },

  async onEmptyRecycle() {
    this.setData({ showDataSheet: false })
    this.syncTabBar()
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '清空回收站',
        content: '回收站中的记录将被永久删除，无法恢复。',
        confirmText: '清空',
        confirmColor: '#DA5A5A',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return
    try {
      await api.emptyRecycleBin()
      wx.showToast({ title: '回收站已清空', icon: 'success' })
      this.load()
    } catch (e) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    }
  },

  async onDeleteAccountData() {
    this.setData({ showDataSheet: false })
    this.syncTabBar()
    const first = await new Promise((resolve) => {
      wx.showModal({
        title: '删除账号数据',
        content: '将删除当前账号下的全部归档、分类和标签，操作不可恢复。',
        confirmText: '继续',
        confirmColor: '#DA5A5A',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!first) return
    const second = await new Promise((resolve) => {
      wx.showModal({
        title: '再次确认',
        content: '确定要删除全部数据吗？此操作无法撤销。',
        confirmText: '删除全部',
        confirmColor: '#DA5A5A',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!second) return
    try {
      await api.clearUserData()
      wx.showToast({ title: '数据已删除', icon: 'success' })
      this.load()
    } catch (e) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' })
    }
  },

  onOpenPrivacy() {
    this.setData({ showPrivacySheet: true })
    this.syncTabBar()
  },

  onClosePrivacy() {
    this.setData({ showPrivacySheet: false })
    this.syncTabBar()
  },

  onOpenAbout() {
    this.setData({ showAboutSheet: true })
    this.syncTabBar()
  },

  onCloseAbout() {
    this.setData({ showAboutSheet: false })
    this.syncTabBar()
  },

  onShareAppMessage() {
    return {
      title: '拾链 · 把微信聊天里的有用内容收集起来',
      path: '/pages/collect/collect'
    }
  }
})
