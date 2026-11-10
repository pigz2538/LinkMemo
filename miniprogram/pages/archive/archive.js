const config = require('../../config')
const api = require('../../utils/api')
const format = require('../../utils/format')
const nav = require('../../utils/nav')
const settings = require('../../utils/settings')
const tabbar = require('../../utils/tabbar')

const SORT_OPTIONS = [
  { key: 'saved_desc', label: '最新收录优先', chip: '按时间' },
  { key: 'saved_asc', label: '最早收录优先', chip: '最早' },
  { key: 'title_asc', label: '标题拼音 A-Z', chip: 'A-Z' },
  { key: 'title_desc', label: '标题拼音 Z-A', chip: 'Z-A' }
]

const DATE_PRESETS = [
  { key: 'all', label: '全部时间' },
  { key: 'today', label: '今天' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: 'custom', label: '自定义' }
]

const TYPE_FILTERS = format.TYPE_ORDER.map((key) => {
  const meta = format.TYPE_META[key]
  return {
    key,
    label: key === 'all' ? '全部' : meta.short
  }
})

function pad(value) {
  return value < 10 ? '0' + value : '' + value
}

function toDateInput(timestamp) {
  const d = new Date(timestamp)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function parseDateInput(value, endOfDay) {
  if (!value) return null
  const parts = value.split('-').map(Number)
  const d = new Date(parts[0], parts[1] - 1, parts[2], endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

Page({
  data: {
    typeFilters: TYPE_FILTERS,
    contentType: 'all',
    keyword: '',
    sort: config.defaultSort || 'saved_desc',
    sortLabel: '按时间',
    sortOptions: SORT_OPTIONS,
    showSortSheet: false,

    datePresets: DATE_PRESETS,
    datePreset: 'all',
    dateLabel: '日期',
    dateFrom: null,
    dateTo: null,
    customFrom: '',
    customTo: '',
    showDateSheet: false,

    categories: [],
    tags: [],
    senders: [],
    categoryOptions: [],
    filterCategoryId: '',
    filterTagIds: [],
    filterTagMatch: config.tagMatchMode || 'and',
    filterSender: '',
    draftCategoryId: '',
    draftTagIds: [],
    draftTagMatch: 'and',
    draftSender: '',
    showFilterSheet: false,

    list: [],
    total: 0,
    page: 1,
    hasMore: true,
    loading: true,
    loadingMore: false,

    activeFilterText: '',
    hasActiveFilter: false,

    batchMode: false,
    selectedIds: [],
    selectedMap: {},
    selectedCount: 0,
    showBatchCategorySheet: false,
    showBatchTagSheet: false,
    batchTags: [],
    batchTagMode: 'add'
  },

  loadSeq: 0,
  keywordTimer: null,

  onLoad() {
    this.sortTouched = false
    const saved = settings.getSettings()
    this.syncSortLabel(saved.default_sort || this.data.sort)
    const sortOption = SORT_OPTIONS.find((item) => item.key === saved.default_sort)
    if (sortOption) {
      this.setData({ sort: sortOption.key, sortLabel: sortOption.chip })
    }
  },

  onShow() {
    const saved = settings.getSettings()
    if (!this.sortTouched && saved.default_sort && saved.default_sort !== this.data.sort) {
      this.syncSortLabel(saved.default_sort)
    }
    this.applyPendingFilter()
    this.syncTabBar()
    this.refresh()
  },

  onHide() {
    tabbar.show()
  },

  onUnload() {
    if (this.keywordTimer) clearTimeout(this.keywordTimer)
    tabbar.show()
  },

  syncTabBar() {
    const shouldHide = this.data.batchMode ||
      this.data.showSortSheet ||
      this.data.showDateSheet ||
      this.data.showFilterSheet ||
      this.data.showBatchCategorySheet ||
      this.data.showBatchTagSheet
    if (shouldHide) tabbar.hide()
    else tabbar.show()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) {
      this.loadList(false)
    }
  },

  applyPendingFilter() {
    const pending = nav.takePendingFilter()
    if (!pending) return
    const patch = {}
    if (pending.category_id !== undefined) patch.filterCategoryId = pending.category_id || ''
    if (pending.tag_ids !== undefined) patch.filterTagIds = pending.tag_ids || []
    if (pending.sender !== undefined) patch.filterSender = pending.sender || ''
    if (pending.content_type !== undefined) patch.contentType = pending.content_type || 'all'
    if (pending.keyword !== undefined) patch.keyword = pending.keyword || ''
    if (pending.date_preset !== undefined) {
      patch.datePreset = pending.date_preset
      patch.dateFrom = pending.date_from || null
      patch.dateTo = pending.date_to || null
      patch.dateLabel = pending.date_label || this.data.dateLabel
    }
    this.setData(patch)
  },

  async refresh() {
    const seq = ++this.loadSeq
    this.setData({ loading: true })
    try {
      const results = await Promise.all([
        api.getCategories(),
        api.getTags(),
        api.getSenders ? api.getSenders().catch(() => []) : Promise.resolve([])
      ])
      if (seq !== this.loadSeq) return
      const categories = results[0] || []
      const tags = results[1] || []
      const senders = results[2] || []
      this.setData({
        categories,
        tags: this.decorateTags(tags),
        senders,
        categoryOptions: [
          { _id: '', name: '全部分类' },
          { _id: 'uncategorized', name: '未分类' }
        ].concat(categories)
      })
      this.updateActiveFilterText()
      await this.loadList(true, seq)
    } catch (e) {
      if (seq !== this.loadSeq) return
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  decorateTags(tags) {
    const selected = this.data.filterTagIds || []
    return (tags || []).map((tag) => Object.assign({}, tag, {
      checked: selected.indexOf(tag._id) !== -1
    }))
  },

  buildQuery(page) {
    return {
      keyword: this.data.keyword,
      content_type: this.data.contentType,
      category_id: this.data.filterCategoryId,
      tag_ids: this.data.filterTagIds,
      tag_match: this.data.filterTagMatch,
      sender: this.data.filterSender,
      date_from: this.data.dateFrom,
      date_to: this.data.dateTo,
      sort: this.data.sort,
      page,
      page_size: config.pageSize
    }
  },

  async loadList(reset, parentSeq) {
    if (!reset && (this.data.loading || this.data.loadingMore)) return
    const seq = parentSeq || ++this.loadSeq
    const page = reset ? 1 : this.data.page + 1
    this.setData(reset ? { loading: true } : { loadingMore: true })

    try {
      const result = await api.getArchiveList(this.buildQuery(page))
      if (seq !== this.loadSeq) return
      const records = result.records || []
      this.setData({
        list: reset ? records : this.data.list.concat(records),
        total: Number(result.total || 0),
        page,
        hasMore: !!result.has_more,
        loading: false,
        loadingMore: false
      })
    } catch (e) {
      if (seq !== this.loadSeq) return
      this.setData({ loading: false, loadingMore: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  updateActiveFilterText() {
    const parts = []
    if (this.data.filterCategoryId) {
      const category = this.data.categories.find((item) => item._id === this.data.filterCategoryId)
      parts.push(category ? category.name : '未分类')
    }
    if (this.data.filterSender) parts.push('发送者：' + this.data.filterSender)
    if (this.data.filterTagIds.length) {
      const names = this.data.filterTagIds.map((id) => {
        const tag = this.data.tags.find((item) => item._id === id)
        return tag ? tag.name : ''
      }).filter(Boolean)
      if (names.length) parts.push(names.join('、'))
    }
    if (this.data.datePreset !== 'all') parts.push(this.data.dateLabel)
    this.setData({
      activeFilterText: parts.join(' · '),
      hasActiveFilter: parts.length > 0
    })
  },

  onKeywordInput(e) {
    const keyword = e.detail.value || ''
    this.setData({ keyword })
    if (this.keywordTimer) clearTimeout(this.keywordTimer)
    this.keywordTimer = setTimeout(() => {
      this.loadList(true)
    }, 320)
  },

  onSearchConfirm() {
    if (this.keywordTimer) clearTimeout(this.keywordTimer)
    this.loadList(true)
  },

  onClearKeyword() {
    if (this.keywordTimer) clearTimeout(this.keywordTimer)
    this.setData({ keyword: '' })
    this.loadList(true)
  },

  onTypeTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.contentType) return
    this.setData({ contentType: key })
    this.loadList(true)
  },

  onOpenSort() {
    this.setData({ showSortSheet: true })
    this.syncTabBar()
  },

  onCloseSort() {
    this.setData({ showSortSheet: false })
    this.syncTabBar()
  },

  syncSortLabel(key) {
    const option = SORT_OPTIONS.find((item) => item.key === key) || SORT_OPTIONS[0]
    this.setData({ sort: option.key, sortLabel: option.chip })
  },

  onSortTap(e) {
    const key = e.currentTarget.dataset.key
    this.sortTouched = true
    this.syncSortLabel(key)
    this.setData({ showSortSheet: false })
    this.syncTabBar()
    this.loadList(true)
  },

  onOpenDate() {
    const now = Date.now()
    this.setData({
      showDateSheet: true,
      customFrom: this.data.dateFrom ? toDateInput(this.data.dateFrom) : toDateInput(now - 6 * 86400000),
      customTo: this.data.dateTo ? toDateInput(this.data.dateTo) : toDateInput(now)
    })
    this.syncTabBar()
  },

  onCloseDate() {
    this.setData({ showDateSheet: false })
    this.syncTabBar()
  },

  onDatePresetTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'custom') {
      this.setData({ datePreset: 'custom' })
      return
    }

    const now = Date.now()
    let from = null
    let to = null
    let label = '日期'
    if (key === 'today') {
      from = format.startOfDay(now)
      to = format.endOfDay(now)
      label = '今天'
    } else if (key === '7d') {
      from = format.startOfDay(now - 6 * 86400000)
      to = format.endOfDay(now)
      label = '近 7 天'
    } else if (key === '30d') {
      from = format.startOfDay(now - 29 * 86400000)
      to = format.endOfDay(now)
      label = '近 30 天'
    }

    this.setData({
      datePreset: key,
      dateFrom: from,
      dateTo: to,
      dateLabel: label,
      showDateSheet: false
    })
    this.syncTabBar()
    this.updateActiveFilterText()
    this.loadList(true)
  },

  onCustomFrom(e) {
    this.setData({ customFrom: e.detail.value, datePreset: 'custom' })
  },

  onCustomTo(e) {
    this.setData({ customTo: e.detail.value, datePreset: 'custom' })
  },

  onApplyCustomDate() {
    let from = parseDateInput(this.data.customFrom, false)
    let to = parseDateInput(this.data.customTo, true)
    if (!from || !to) {
      wx.showToast({ title: '请选择完整日期范围', icon: 'none' })
      return
    }
    let fromLabel = this.data.customFrom
    let toLabel = this.data.customTo
    if (from > to) {
      const tmp = from
      from = parseDateInput(toLabel, false)
      to = parseDateInput(fromLabel, true)
      const swap = fromLabel
      fromLabel = toLabel
      toLabel = swap
    }
    const label = fromLabel.slice(5).replace('-', '.') + ' - ' + toLabel.slice(5).replace('-', '.')
    this.setData({
      customFrom: fromLabel,
      customTo: toLabel,
      datePreset: 'custom',
      dateFrom: from,
      dateTo: to,
      dateLabel: label,
      showDateSheet: false
    })
    this.syncTabBar()
    this.updateActiveFilterText()
    this.loadList(true)
  },

  onClearFilters() {
    const now = Date.now()
    this.setData({
      contentType: 'all',
      filterCategoryId: '',
      filterTagIds: [],
      filterTagMatch: 'and',
      filterSender: '',
      tags: this.decorateTags(this.data.tags),
      datePreset: 'all',
      dateFrom: null,
      dateTo: null,
      dateLabel: '日期',
      keyword: ''
    })
    this.updateActiveFilterText()
    this.loadList(true)
  },

  onOpenFilter() {
    this.setData({
      showFilterSheet: true,
      draftCategoryId: this.data.filterCategoryId,
      draftTagIds: this.data.filterTagIds.slice(),
      draftTagMatch: this.data.filterTagMatch,
      draftSender: this.data.filterSender,
      tags: this.data.tags.map((tag) => Object.assign({}, tag, {
        checked: this.data.filterTagIds.indexOf(tag._id) !== -1
      }))
    })
    this.syncTabBar()
  },

  onCloseFilter() {
    this.setData({ showFilterSheet: false })
    this.syncTabBar()
  },

  onDraftCategoryTap(e) {
    this.setData({ draftCategoryId: e.currentTarget.dataset.id || '' })
  },

  onDraftTagTap(e) {
    const id = e.currentTarget.dataset.id
    const ids = this.data.draftTagIds.slice()
    const index = ids.indexOf(id)
    if (index === -1) ids.push(id)
    else ids.splice(index, 1)
    this.setData({
      draftTagIds: ids,
      tags: this.data.tags.map((tag) => Object.assign({}, tag, {
        checked: ids.indexOf(tag._id) !== -1
      }))
     })
  },

  onDraftSenderTap(e) {
    this.setData({ draftSender: e.currentTarget.dataset.name || '' })
  },

  onDraftTagMatchTap(e) {
    this.setData({ draftTagMatch: e.currentTarget.dataset.mode })
  },

  onResetFilter() {
    this.setData({
      draftCategoryId: '',
      draftTagIds: [],
      draftTagMatch: 'and',
      draftSender: '',
      tags: this.data.tags.map((tag) => Object.assign({}, tag, { checked: false }))
    })
  },

  onApplyFilter() {
    const tagIds = this.data.draftTagIds.slice()
    this.setData({
      filterCategoryId: this.data.draftCategoryId,
      filterTagIds: tagIds,
      filterTagMatch: this.data.draftTagMatch,
      filterSender: this.data.draftSender,
      tags: this.data.tags.map((tag) => Object.assign({}, tag, {
        checked: tagIds.indexOf(tag._id) !== -1
      })),
      showFilterSheet: false
    })
    this.syncTabBar()
    this.updateActiveFilterText()
    this.loadList(true)
  },

  onManageTap() {
    if (this.data.batchMode) {
      this.exitBatch()
    } else {
      this.setData({ batchMode: true })
      this.syncTabBar()
    }
  },

  onCardTap(e) {
    if (this.longPressAt && Date.now() - this.longPressAt < 450) return
    const id = e.currentTarget.dataset.id
    if (this.data.batchMode) {
      this.toggleSelect(id)
      return
    }
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  onCardLongPress(e) {
    this.longPressAt = Date.now()
    const id = e.currentTarget.dataset.id
    if (!this.data.batchMode) {
      this.setData({ batchMode: true })
      this.syncTabBar()
      this.toggleSelect(id)
    }
  },

  toggleSelect(id) {
    const ids = this.data.selectedIds.slice()
    const index = ids.indexOf(id)
    if (index === -1) ids.push(id)
    else ids.splice(index, 1)
    const map = {}
    ids.forEach((item) => { map[item] = true })
    this.setData({
      selectedIds: ids,
      selectedMap: map,
      selectedCount: ids.length
    })
  },

  onSelectAll() {
    const allIds = this.data.list.map((item) => item._id)
    if (this.data.selectedCount === allIds.length && allIds.length > 0) {
      this.setData({ selectedIds: [], selectedMap: {}, selectedCount: 0 })
      return
    }
    const map = {}
    allIds.forEach((id) => { map[id] = true })
    this.setData({ selectedIds: allIds, selectedMap: map, selectedCount: allIds.length })
  },

  exitBatch() {
    this.setData({
      batchMode: false,
      selectedIds: [],
      selectedMap: {},
      selectedCount: 0
    })
    this.syncTabBar()
  },

  async onBatchDelete() {
    if (!this.data.selectedCount) {
      wx.showToast({ title: '请选择记录', icon: 'none' })
      return
    }
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '删除记录',
        content: '将把 ' + this.data.selectedCount + ' 条记录移入回收站，是否继续？',
        confirmText: '删除',
        confirmColor: '#DA5A5A',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return
    try {
      await api.deleteArchive(this.data.selectedIds)
      wx.showToast({ title: '已移入回收站', icon: 'success' })
      this.exitBatch()
      this.refresh()
    } catch (e) {
      wx.showToast({ title: e.message || '删除失败', icon: 'none' })
    }
  },

  onOpenRecycle() {
    wx.navigateTo({ url: '/pages/recycle/recycle' })
  },

  goCollect() {
    wx.switchTab({ url: '/pages/collect/collect' })
  },

  onEmptyAction() {
    if (this.data.hasActiveFilter || this.data.keyword || this.data.contentType !== 'all' || this.data.filterSender) {
      this.onClearFilters()
      return
    }
    this.goCollect()
  },

  onOpenBatchCategory() {
    if (!this.data.selectedCount) {
      wx.showToast({ title: '请选择记录', icon: 'none' })
      return
    }
    this.setData({ showBatchCategorySheet: true })
    this.syncTabBar()
  },

  onCloseBatchCategory() {
    this.setData({ showBatchCategorySheet: false })
    this.syncTabBar()
  },

  async onApplyBatchCategory(e) {
    const categoryId = e.currentTarget.dataset.id || null
    try {
      wx.showLoading({ title: '处理中' })
      if (api.batchUpdateArchive) {
        await api.batchUpdateArchive(this.data.selectedIds, { category_id: categoryId })
      } else {
        await Promise.all(this.data.selectedIds.map((id) => api.updateArchive(id, { category_id: categoryId })))
      }
      wx.hideLoading()
      wx.showToast({ title: '已更新分类', icon: 'success' })
      this.setData({ showBatchCategorySheet: false })
      this.exitBatch()
      this.refresh()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  onOpenBatchTag() {
    if (!this.data.selectedCount) {
      wx.showToast({ title: '请选择记录', icon: 'none' })
      return
    }
    this.setData({
      showBatchTagSheet: true,
      batchTagMode: 'add',
      batchTags: this.data.tags.map((tag) => Object.assign({}, tag, { checked: false }))
    })
    this.syncTabBar()
  },

  onCloseBatchTag() {
    this.setData({ showBatchTagSheet: false })
    this.syncTabBar()
  },

  onBatchTagModeTap(e) {
    this.setData({ batchTagMode: e.currentTarget.dataset.mode })
  },

  onBatchTagTap(e) {
    const id = e.currentTarget.dataset.id
    this.setData({
      batchTags: this.data.batchTags.map((tag) => (
        tag._id === id ? Object.assign({}, tag, { checked: !tag.checked }) : tag
      ))
    })
  },

  async onApplyBatchTags() {
    const tagIds = this.data.batchTags.filter((tag) => tag.checked).map((tag) => tag._id)
    if (!tagIds.length) {
      wx.showToast({ title: '请选择标签', icon: 'none' })
      return
    }
    try {
      wx.showLoading({ title: '处理中' })
      if (api.batchTag) {
        await api.batchTag(this.data.selectedIds, tagIds, this.data.batchTagMode)
      } else {
        const selected = this.data.list.filter((item) => this.data.selectedMap[item._id])
        await Promise.all(selected.map((item) => {
          const current = item.tag_ids || []
          const next = this.data.batchTagMode === 'remove'
            ? current.filter((id) => tagIds.indexOf(id) === -1)
            : current.concat(tagIds.filter((id) => current.indexOf(id) === -1))
          return api.updateArchive(item._id, { tag_ids: next })
        }))
      }
      wx.hideLoading()
      wx.showToast({ title: this.data.batchTagMode === 'remove' ? '已移除标签' : '已添加标签', icon: 'success' })
      this.setData({ showBatchTagSheet: false })
      this.exitBatch()
      this.refresh()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  onShareAppMessage() {
    return {
      title: '拾链 · 我的归档',
      path: '/pages/archive/archive'
    }
  }
})
