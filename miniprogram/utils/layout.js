let cached = null

function getNavMetrics() {
  if (cached) return cached

  let sys = {}
  try {
    sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  } catch (e) {
    sys = {}
  }

  const statusBarHeight = sys.statusBarHeight || 20
  const windowWidth = sys.windowWidth || 375
  let navBarHeight = 44
  let capsule = null

  try {
    capsule = wx.getMenuButtonBoundingClientRect()
    if (capsule && capsule.height && capsule.top) {
      const gap = Math.max(capsule.top - statusBarHeight, 4)
      navBarHeight = gap * 2 + capsule.height
    }
  } catch (e) {
    capsule = null
  }

  const safeAreaBottom = sys.safeArea && sys.screenHeight
    ? Math.max(sys.screenHeight - sys.safeArea.bottom, 0)
    : 0

  cached = {
    statusBarHeight,
    navBarHeight,
    totalHeight: statusBarHeight + navBarHeight,
    windowWidth,
    safeAreaBottom,
    capsule
  }
  return cached
}

module.exports = { getNavMetrics }
