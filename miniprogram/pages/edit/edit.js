const api = require('../../utils/api')
const format = require('../../utils/format')

const TYPE_OPTIONS = format.TYPE_ORDER
  .filter((key) => key !== 'all')
  .map((key) => ({ key, label: format.TYPE_META[key].label }))

const COLOR_PALETTE = ['#2E9E5B', '#4C8DFF', '#7B61FF', '#F0A03C', '#DA5A5A', '#3FBFB0', '#E0A54C']

Page({
  data: {
    id: '',
    item: null,
    loading: true,
    saving: false,
    typeOptions: TYPE_OPTIONS,
    typeIndex: 0,
    title: '',
    url: '',
    note: '',
    contentType: 'text',
    categoryOptions: [],
    categoryId: '',
    tags: [],
    tagIds: []
  },

  onLoad(options) {
    this.setData({ id: options.id || '' })
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const results = await Promise.all([
        api.getArchiveDetail(this.data.id),
        api.getCategories(),
        api.getTags()
      ])
      const item = results[0]
      const categories = results[1] || []
      const tags = results[2] || []
      let typeIndex = TYPE_OPTIONS.findIndex((option) => option.key === item.content_type)
      if (typeIndex < 0) typeIndex = 0

      this.setData({
        item,
        loading: false,
        title: item.title || '',
        url: item.url || '',
        note: item.note || '',
        contentType: item.content_type,
        typeIndex,
        categoryOptions: [{ _id: '', name: '未分类' }].concat(categories),
        categoryId: item.category_id || '',
        tags: tags.map((tag) => Object.assign({}, tag, {
          checked: (item.tag_ids || []).indexOf(tag._id) !== -1
        })),
        tagIds: (item.tag_ids || []).slice()
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  onUrlInput(e) {
    this.setData({ url: e.detail.value })
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value })
  },

  onTypeChange(e) {
    const index = Number(e.detail.value)
    this.setData({
      typeIndex: index,
      contentType: TYPE_OPTIONS[index] ? TYPE_OPTIONS[index].key : 'text'
    })
  },

  onCategoryTap(e) {
    this.setData({ categoryId: e.currentTarget.dataset.id || '' })
  },

  onTagTap(e) {
    const id = e.currentTarget.dataset.id
    const ids = this.data.tagIds.slice()
    const index = ids.indexOf(id)
    if (index === -1) ids.push(id)
    else ids.splice(index, 1)
    this.setData({
      tagIds: ids,
      tags: this.data.tags.map((tag) => Object.assign({}, tag, {
        checked: ids.indexOf(tag._id) !== -1
      }))
    })
  },

  onCreateCategory() {
    const color = COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)]
    wx.showModal({
      title: '新建分类',
      editable: true,
      placeholderText: '例如：论文、旅行、求职',
      confirmText: '创建',
      success: async (res) => {
        if (!res.confirm) return
        const name = String(res.content || '').trim()
        if (!name) {
          wx.showToast({ title: '请输入分类名称', icon: 'none' })
          return
        }
        try {
          const created = await api.manageCategory({ action: 'create', name, color })
          const categories = await api.getCategories()
          const newId = created && created.category ? created.category._id : ''
          this.setData({
            categoryOptions: [{ _id: '', name: '未分类' }].concat(categories),
            categoryId: newId
          })
          wx.showToast({ title: '分类已创建', icon: 'success' })
        } catch (e) {
          wx.showToast({ title: e.message || '创建失败', icon: 'none' })
        }
      }
    })
  },

  onCreateTag() {
    const color = COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)]
    wx.showModal({
      title: '新建标签',
      editable: true,
      placeholderText: '例如：待阅读、重要',
      confirmText: '创建',
      success: async (res) => {
        if (!res.confirm) return
        const name = String(res.content || '').trim()
        if (!name) {
          wx.showToast({ title: '请输入标签名称', icon: 'none' })
          return
        }
        try {
          const created = await api.manageTag({ action: 'create', name, color })
          const tags = await api.getTags()
          const newId = created && created.tag ? created.tag._id : ''
          const ids = this.data.tagIds.slice()
          if (newId && ids.indexOf(newId) === -1) ids.push(newId)
          this.setData({
            tagIds: ids,
            tags: tags.map((tag) => Object.assign({}, tag, {
              checked: ids.indexOf(tag._id) !== -1
            }))
          })
          wx.showToast({ title: '标签已创建', icon: 'success' })
        } catch (e) {
          wx.showToast({ title: e.message || '创建失败', icon: 'none' })
        }
      }
    })
  },

  async onSave() {
    if (this.data.saving) return
    const title = this.data.title.trim()
    const url = this.data.url.trim()
    if (!title) {
      wx.showToast({ title: '标题不能为空', icon: 'none' })
      return
    }
    if (url && !/^https?:\/\//i.test(url)) {
      wx.showToast({ title: '链接需以 http:// 或 https:// 开头', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    try {
      await api.updateArchive(this.data.id, {
        title,
        url,
        note: this.data.note,
        content_type: this.data.contentType,
        category_id: this.data.categoryId || null,
        tag_ids: this.data.tagIds
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 320)
    } catch (e) {
      this.setData({ saving: false })
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    }
  },

  onCancel() {
    wx.navigateBack()
  }
})
