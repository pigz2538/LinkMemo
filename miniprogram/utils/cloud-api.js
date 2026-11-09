const config = require('../config')

const SESSION_KEY = 'linkmemo_cloud_user'

function call(action, payload) {
  return wx.cloud.callFunction({
    name: 'api',
    data: { action, payload: payload || {} }
  }).then((res) => {
    const result = res.result || {}
    if (result.code !== 0) {
      throw new Error(result.message || '请求失败')
    }
    return result.data
  })
}

function getStoredUser() {
  try {
    return wx.getStorageSync(SESSION_KEY) || null
  } catch (e) {
    return null
  }
}

const cloudApi = {
  async init() {
    if (!wx.cloud) throw new Error('当前基础库不支持云开发')
    wx.cloud.init({ env: config.cloudEnv || undefined, traceUser: true })
    try {
      const data = await this.login()
      return data
    } catch (e) {
      const cached = getStoredUser()
      if (cached) return { user: cached, loggedIn: true, cloudMode: true }
      throw e
    }
  },

  async login() {
    await new Promise((resolve) => {
      wx.login({
        success: resolve,
        fail: resolve
      })
    })
    const data = await call('login')
    if (data && data.user) {
      try {
        wx.setStorageSync(SESSION_KEY, data.user)
      } catch (e) {}
    }
    return Object.assign({ loggedIn: true, cloudMode: true }, data)
  },

  async logout() {
    try {
      wx.removeStorageSync(SESSION_KEY)
    } catch (e) {}
    return { loggedIn: false }
  },

  async getSession() {
    const user = getStoredUser()
    return { user, loggedIn: !!user }
  },

  getArchiveList(params) {
    return call('getArchiveList', params)
  },

  getArchiveDetail(id) {
    return call('getArchiveDetail', { archive_id: id })
  },

  parseAndSave(rawText, options) {
    return call('parseAndSave', Object.assign({ raw_text: rawText }, options || {}))
  },

  enrichArchive(ids) {
    return call('enrichArchive', {
      archive_ids: Array.isArray(ids) ? ids : [ids]
    })
  },

  updateArchive(id, patch) {
    return call('updateArchive', Object.assign({ archive_id: id }, patch || {}))
  },

  batchUpdateArchive(ids, patch) {
    return call('batchUpdateArchive', {
      archive_ids: Array.isArray(ids) ? ids : [ids],
      patch: patch || {}
    })
  },

  batchTag(ids, tagIds, mode) {
    return call('batchTag', {
      archive_ids: Array.isArray(ids) ? ids : [ids],
      tag_ids: Array.isArray(tagIds) ? tagIds : [],
      mode: mode === 'remove' ? 'remove' : 'add'
    })
  },

  deleteArchive(ids) {
    return call('deleteArchive', { archive_ids: Array.isArray(ids) ? ids : [ids] })
  },

  restoreArchive(ids) {
    return call('restoreArchive', { archive_ids: Array.isArray(ids) ? ids : [ids] })
  },

  permanentDelete(ids) {
    return call('deleteArchive', {
      archive_ids: Array.isArray(ids) ? ids : [ids],
      permanent: true
    })
  },

  emptyRecycleBin() {
    return call('emptyRecycleBin')
  },

  getCategories() {
    return call('getCategories')
  },

  getTags() {
    return call('getTags')
  },

  manageCategory(payload) {
    return call('manageCategory', payload)
  },

  manageTag(payload) {
    return call('manageTag', payload)
  },

  getProfileStats() {
    return call('getProfileStats')
  },

  exportData() {
    return call('exportData')
  },

  clearUserData() {
    return call('clearUserData')
  },

  async resetDemoData() {
    throw new Error('云端模式不支持重置演示数据')
  }
}

module.exports = cloudApi
