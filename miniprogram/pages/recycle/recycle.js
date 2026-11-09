const api = require('../../utils/api')
const format = require('../../utils/format')

Page({
  data: {
    list: [],
    loading: true,
    total: 0
  },

  onShow() {
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const result = await api.getArchiveList({
        recycle: true,
        sort: 'deleted_desc',
        page: 1,
        page_size: 100
      })
      const list = (result.records || []).map((item) => Object.assign({}, item, {
        deleted_text: item.deleted_at ? format.formatDateTime(item.deleted_at) : ''
      }))
      this.setData({ list, total: result.total || list.length, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  async onRestore(e) {
    const id = e.currentTarget.dataset.id
    try {
      await api.restoreArchive([id])
      wx.showToast({ title: '已恢复', icon: 'success' })
      this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '恢复失败', icon: 'none' })
    }
  },

  async onPermanentDelete(e) {
    const id = e.currentTarget.dataset.id
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '永久删除',
        content: '删除后将无法恢复，确定继续吗？',
        confirmText: '永久删除',
        confirmColor: '#DA5A5A',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return
    try {
      await api.permanentDelete([id])
      wx.showToast({ title: '已永久删除', icon: 'success' })
      this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '删除失败', icon: 'none' })
    }
  },

  async onEmpty() {
    if (!this.data.total) {
      wx.showToast({ title: '回收站已经是空的', icon: 'none' })
      return
    }
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '清空回收站',
        content: '回收站中的 ' + this.data.total + ' 条记录将被永久删除，无法恢复。',
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

  goArchive() {
    wx.switchTab({ url: '/pages/archive/archive' })
  }
})
