const TABS = [
  {
    pagePath: '/pages/collect/collect',
    text: '收集',
    icon: '/assets/tab/collect.png',
    selectedIcon: '/assets/tab/collect-active.png'
  },
  {
    pagePath: '/pages/archive/archive',
    text: '归档',
    icon: '/assets/tab/archive.png',
    selectedIcon: '/assets/tab/archive-active.png'
  },
  {
    pagePath: '/pages/mine/mine',
    text: '我的',
    icon: '/assets/tab/mine.png',
    selectedIcon: '/assets/tab/mine-active.png'
  }
]

Component({
  data: {
    selected: 0,
    hidden: false,
    list: TABS
  },

  lifetimes: {
    attached() {
      this.syncState()
    }
  },

  pageLifetimes: {
    show() {
      this.syncState()
    }
  },

  methods: {
    syncState() {
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      const route = current ? current.route : ''
      let selected = this.data.selected
      TABS.forEach((item, index) => {
        if (item.pagePath.replace(/^\//, '') === route) selected = index
      })

      let hidden = false
      try {
        const app = getApp()
        hidden = !!(app && app.globalData && app.globalData.tabBarHidden)
      } catch (e) {}

      this.setData({ selected, hidden })
    },

    onTap(e) {
      const index = Number(e.currentTarget.dataset.index)
      const item = TABS[index]
      if (!item) return
      wx.switchTab({ url: item.pagePath })
    }
  }
})
