const api = require('../../utils/api')
const nav = require('../../utils/nav')

const COLOR_PALETTE = ['#2E9E5B', '#4C8DFF', '#7B61FF', '#F0A03C', '#DA5A5A', '#3FBFB0', '#E0A54C', '#8A7CFF', '#5FA8D9']

Page({
  data: {
    tab: 'category',
    categories: [],
    tags: [],
    loading: true,
    showEditor: false,
    editorMode: 'create',
    editorType: 'category',
    editorId: '',
    editorName: '',
    editorColor: '#2E9E5B',
    colorPalette: COLOR_PALETTE,
    saving: false
  },

  onLoad(options) {
    if (options && (options.tab === 'tag' || options.tab === 'category')) {
      this.setData({ tab: options.tab })
    }
  },

  onShow() {
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const results = await Promise.all([api.getCategories(), api.getTags()])
      this.setData({
        categories: results[0] || [],
        tags: results[1] || [],
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.tab) return
    this.setData({ tab })
  },

  openCreate() {
    this.setData({
      showEditor: true,
      editorMode: 'create',
      editorType: this.data.tab,
      editorId: '',
      editorName: '',
      editorColor: COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)]
    })
  },

  openEdit(e) {
    const d = e.currentTarget.dataset
    this.setData({
      showEditor: true,
      editorMode: 'edit',
      editorType: d.type,
      editorId: d.id,
      editorName: d.name,
      editorColor: d.color || '#2E9E5B'
    })
  },

  closeEditor() {
    if (this.data.saving) return
    this.setData({ showEditor: false })
  },

  onNameInput(e) {
    this.setData({ editorName: e.detail.value })
  },

  onColorTap(e) {
    this.setData({ editorColor: e.currentTarget.dataset.color })
  },

  async onSaveEditor() {
    if (this.data.saving) return
    const name = this.data.editorName.trim()
    if (!name) {
      wx.showToast({ title: '请输入名称', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    const isCategory = this.data.editorType === 'category'
    try {
      await (isCategory ? api.manageCategory : api.manageTag)({
        action: this.data.editorMode === 'create' ? 'create' : 'update',
        id: this.data.editorId || undefined,
        name,
        color: this.data.editorColor
      })
      this.setData({ saving: false, showEditor: false })
      wx.showToast({ title: this.data.editorMode === 'create' ? '已创建' : '已保存', icon: 'success' })
      this.load()
    } catch (e) {
      this.setData({ saving: false })
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    }
  },

  async onDelete(e) {
    const d = e.currentTarget.dataset
    const isCategory = d.type === 'category'
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: isCategory ? '删除分类' : '删除标签',
        content: isCategory
          ? '删除「' + d.name + '」后，其中的记录会变为未分类，记录本身不会删除。'
          : '删除「' + d.name + '」后，只会解除记录与该标签的关联。',
        confirmText: '删除',
        confirmColor: '#DA5A5A',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return
    try {
      await (isCategory ? api.manageCategory : api.manageTag)({ action: 'delete', id: d.id })
      wx.showToast({ title: '已删除', icon: 'success' })
      this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '删除失败', icon: 'none' })
    }
  },

  onRowTap(e) {
    const d = e.currentTarget.dataset
    if (d.type === 'category') {
      nav.openArchiveWithFilter({ category_id: d.id })
    } else {
      nav.openArchiveWithFilter({ tag_ids: [d.id] })
    }
  }
})
