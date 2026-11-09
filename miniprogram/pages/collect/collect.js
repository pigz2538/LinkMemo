const config = require('../../config')
const api = require('../../utils/api')
const tabbar = require('../../utils/tabbar')

Page({
  data: {
    text: '',
    charCount: 0,
    maxLength: config.maxInputLength,
    allowDuplicates: false,
    parsing: false,
    showResult: false,
    result: null,
    resultTitle: '解析完成',
    parseError: ''
  },

  parseToken: 0,

  onInput(e) {
    const value = e.detail.value || ''
    this.setData({ text: value, charCount: value.length, parseError: '' })
  },

  async onReadClipboard() {
    try {
      const res = await new Promise((resolve, reject) => {
        wx.getClipboardData({ success: resolve, fail: reject })
      })
      const data = String(res.data || '')
      if (!data.trim()) {
        wx.showToast({ title: '剪贴板是空的', icon: 'none' })
        return
      }
      const text = data.length > config.maxInputLength
        ? data.slice(0, config.maxInputLength)
        : data
      this.setData({ text, charCount: text.length, parseError: '' })
      if (data.length > config.maxInputLength) {
        wx.showToast({ title: '内容过长，已截取前 ' + config.maxInputLength + ' 字', icon: 'none' })
      } else {
        wx.showToast({ title: '已读取剪贴板', icon: 'success' })
      }
    } catch (e) {
      wx.showToast({ title: '无法读取剪贴板，请手动粘贴', icon: 'none' })
    }
  },

  onToggleDuplicates() {
    this.setData({ allowDuplicates: !this.data.allowDuplicates })
  },

  async onParse() {
    if (this.data.parsing) return
    const text = this.data.text.trim()
    if (!text) {
      wx.showToast({ title: '请先粘贴微信聊天内容', icon: 'none' })
      return
    }
    if (text.length > config.maxInputLength) {
      wx.showToast({ title: '内容不能超过 ' + config.maxInputLength + ' 字', icon: 'none' })
      return
    }

    const token = ++this.parseToken
    this.setData({ parsing: true, parseError: '' })

    try {
      await new Promise((resolve) => setTimeout(resolve, 220))
      const result = await api.parseAndSave(text, {
        allowDuplicates: this.data.allowDuplicates
      })
      if (token !== this.parseToken) return

      const successCount = Number(result.success_count || 0)
      const duplicateCount = Number(result.duplicate_count || 0)
      const failedCount = Number(result.failed_count || 0)
      const resultTitle = successCount > 0
        ? '解析完成'
        : duplicateCount > 0
          ? '内容已收录'
          : '没有识别到内容'

      if (result.pending_enrich_ids && result.pending_enrich_ids.length && api.enrichArchive) {
        api.enrichArchive(result.pending_enrich_ids).catch(() => {})
      }

      tabbar.hide()
      this.setData({
        parsing: false,
        showResult: true,
        result: Object.assign({}, result, {
          items: result.items || [],
          duplicates: result.duplicates || [],
          failures: result.failures || [],
          success_count: successCount,
          duplicate_count: duplicateCount,
          failed_count: failedCount
        }),
        resultTitle,
        text: successCount > 0 ? '' : this.data.text,
        charCount: successCount > 0 ? 0 : this.data.charCount
      })
    } catch (e) {
      if (token !== this.parseToken) return
      this.setData({
        parsing: false,
        parseError: e.message || '解析失败，请稍后重试'
      })
      wx.showToast({ title: e.message || '解析失败', icon: 'none' })
    }
  },

  onCancelParse() {
    this.parseToken++
    this.setData({ parsing: false })
    wx.showToast({ title: '已取消本次解析', icon: 'none' })
  },

  onCloseResult() {
    tabbar.show()
    this.setData({ showResult: false })
  },

  onViewArchive() {
    tabbar.show()
    this.setData({ showResult: false })
    wx.switchTab({ url: '/pages/archive/archive' })
  },

  onHide() {
    this.parseToken++
    if (this.data.parsing) this.setData({ parsing: false })
    tabbar.show()
  },

  onUnload() {
    this.parseToken++
    tabbar.show()
  },

  onShareAppMessage() {
    return {
      title: '拾链 · 把微信聊天里的有用内容收集起来',
      path: '/pages/collect/collect'
    }
  }
})
