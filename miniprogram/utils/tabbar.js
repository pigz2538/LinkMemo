function getBar() {
  try {
    const pages = getCurrentPages()
    const page = pages[pages.length - 1]
    if (page && typeof page.getTabBar === 'function') {
      return page.getTabBar()
    }
  } catch (e) {}
  return null
}

function apply(hidden) {
  try {
    const app = getApp()
    if (app && app.globalData) app.globalData.tabBarHidden = hidden
  } catch (e) {}
  const bar = getBar()
  if (bar && bar.setData) bar.setData({ hidden })
}

function hide() {
  apply(true)
}

function show() {
  apply(false)
}

function setSelected(index) {
  const bar = getBar()
  if (bar && bar.setData) bar.setData({ selected: index })
}

module.exports = { hide, show, setSelected }
