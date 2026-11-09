const assert = require('assert')

let fetcher
try {
  fetcher = require('../cloudfunctions/api/lib/fetcher')
} catch (e) {
  console.log('cloud security tests skipped (run npm install --prefix cloudfunctions/api first)')
  process.exit(0)
}

async function run() {
  console.log('cloud security tests')

  const blockedIps = [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1'
  ]
  blockedIps.forEach((ip) => {
    assert.strictEqual(fetcher.isBlockedIp(ip), true, ip + ' should be blocked')
  })

  const publicIps = ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888']
  publicIps.forEach((ip) => {
    assert.strictEqual(fetcher.isBlockedIp(ip), false, ip + ' should be allowed')
  })

  const blockedUrls = [
    'http://127.0.0.1/',
    'http://localhost/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.1.2.3/',
    'http://192.168.0.1/',
    'file:///etc/passwd',
    'http://user:pass@example.com/'
  ]
  for (const url of blockedUrls) {
    let rejected = false
    try {
      await fetcher.assertSafeUrl(url)
    } catch (e) {
      rejected = true
    }
    assert.strictEqual(rejected, true, url + ' should be rejected')
  }

  const safe = await fetcher.assertSafeUrl('https://example.com/article?id=1')
  assert.strictEqual(safe.hostname, 'example.com')

  const meta = fetcher.extractMeta(
    '<html><head><title>HTML Title</title>' +
    '<meta property="og:title" content="OG Title">' +
    '<meta name="description" content="A description"></head>' +
    '<body><p>hello</p></body></html>',
    'https://example.com/'
  )
  assert.strictEqual(meta.title, 'OG Title')
  assert.strictEqual(meta.description, 'A description')

  console.log('cloud security tests passed')
}

run().catch((e) => {
  console.error(e.stack || e)
  process.exit(1)
})
