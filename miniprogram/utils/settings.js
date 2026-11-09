const config = require('../config')

const KEY = 'linkmemo_settings_v1'

const DEFAULTS = {
  default_sort: config.defaultSort || 'saved_desc',
  tag_match: config.tagMatchMode || 'and'
}

function getSettings() {
  try {
    const stored = wx.getStorageSync(KEY)
    return Object.assign({}, DEFAULTS, stored || {})
  } catch (e) {
    return Object.assign({}, DEFAULTS)
  }
}

function saveSettings(patch) {
  const next = Object.assign({}, getSettings(), patch || {})
  try {
    wx.setStorageSync(KEY, next)
  } catch (e) {}
  return next
}

module.exports = { getSettings, saveSettings }
