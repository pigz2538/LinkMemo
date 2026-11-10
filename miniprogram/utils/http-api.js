const config = require('../config')

const TOKEN_KEY = 'linkmemo_http_token'
const USER_KEY = 'linkmemo_http_user'

function baseUrl() {
  return String(config.apiBaseUrl || '').replace(/\/+$/, '')
}

function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || ''
  } catch (e) {
    return ''
  }
}

function getStoredUser() {
  try {
    return wx.getStorageSync(USER_KEY) || null
  } catch (e) {
    return null
  }
}

function saveSession(token, user) {
  try {
    if (token) wx.setStorageSync(TOKEN_KEY, token)
    if (user) wx.setStorageSync(USER_KEY, user)
  } catch (e) {}
}

function clearSession() {
  try {
    wx.removeStorageSync(TOKEN_KEY)
    wx.removeStorageSync(USER_KEY)
  } catch (e) {}
}

function request(action, payload, needAuth) {
  return new Promise((resolve, reject) => {
    const token = getToken()
    const header = { 'Content-Type': 'application/json' }
    if (needAuth !== false && token) header.Authorization = 'Bearer ' + token

    wx.request({
      url: baseUrl() + '/api',
      method: 'POST',
      data: { action, payload: payload || {} },
      header,
      timeout: 20000,
      success(res) {
        const body = res.data || {}
        if (res.statusCode === 401) {
          clearSession()
          reject(new Error(body.message || '登录已过期，请重新登录'))
          return
        }
        if (body.code !== 0) {
          reject(new Error(body.message || '请求失败'))
          return
        }
        resolve(body.data)
      },
      fail() {
        reject(new Error('网络请求失败，请检查服务器地址和域名配置'))
      }
    })
  })
}

const httpApi = {
  async init() {
    return this.getSession()
  },

  async getSession() {
    const token = getToken()
    if (!token) return { user: null, loggedIn: false, cloudMode: false }
    try {
      const data = await request('getSession')
      saveSession(token, data.user)
      return { user: data.user, loggedIn: true, cloudMode: false }
    } catch (e) {
      clearSession()
      return { user: null, loggedIn: false, cloudMode: false }
    }
  },

  async login() {
    const code = await new Promise((resolve, reject) => {
      wx.login({
        success(res) {
          if (res.code) resolve(res.code)
          else reject(new Error('微信登录失败'))
        },
        fail() {
          reject(new Error('微信登录失败'))
        }
      })
    })
    const data = await request('login', { code }, false)
    saveSession(data.token, data.user)
    return {
      user: data.user,
      loggedIn: true,
      cloudMode: false
    }
  },

  async logout() {
    try {
      await request('logout')
    } catch (e) {}
    clearSession()
    return { loggedIn: false }
  },

  parseAndSave(rawText, options) {
    return request('parseAndSave', Object.assign({ raw_text: rawText }, options || {}))
  },

  enrichArchive(ids) {
    return request('enrichArchive', {
      archive_ids: Array.isArray(ids) ? ids : [ids]
    })
  },

  getArchiveList(params) {
    return request('getArchiveList', params || {})
  },

  getArchiveDetail(id) {
    return request('getArchiveDetail', { archive_id: id })
  },

  updateArchive(id, patch) {
    return request('updateArchive', Object.assign({ archive_id: id }, patch || {}))
  },

  batchUpdateArchive(ids, patch) {
    return request('batchUpdateArchive', {
      archive_ids: Array.isArray(ids) ? ids : [ids],
      patch: patch || {}
    })
  },

  batchTag(ids, tagIds, mode) {
    return request('batchTag', {
      archive_ids: Array.isArray(ids) ? ids : [ids],
      tag_ids: Array.isArray(tagIds) ? tagIds : [],
      mode: mode === 'remove' ? 'remove' : 'add'
    })
  },

  deleteArchive(ids) {
    return request('deleteArchive', {
      archive_ids: Array.isArray(ids) ? ids : [ids]
    })
  },

  permanentDelete(ids) {
    return request('deleteArchive', {
      archive_ids: Array.isArray(ids) ? ids : [ids],
      permanent: true
    })
  },

  restoreArchive(ids) {
    return request('restoreArchive', {
      archive_ids: Array.isArray(ids) ? ids : [ids]
    })
  },

  emptyRecycleBin() {
    return request('emptyRecycleBin')
  },

  getCategories() {
    return request('getCategories')
  },

  getTags() {
    return request('getTags')
  },

  getSenders() {
    return request('getSenders')
  },

  manageCategory(payload) {
    return request('manageCategory', payload)
  },

  manageTag(payload) {
    return request('manageTag', payload)
  },

  getProfileStats() {
    return request('getProfileStats')
  },

  exportData() {
    return request('exportData')
  },

  clearUserData() {
    return request('clearUserData')
  }
}

module.exports = httpApi
