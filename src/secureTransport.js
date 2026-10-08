// Transport encryption is provided by HTTPS/TLS. Never send customer data over HTTP.
;(function (root) {
  function requireSecurePage(location = root.location) {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location?.hostname)
    if (location?.protocol !== 'https:' && !(local && location?.protocol === 'http:')) {
      throw new Error('For your privacy, open this page using HTTPS before submitting information.')
    }
  }

  function requireHttpsUrl(value) {
    let url
    try { url = new URL(value) } catch { throw new Error('A secure server connection is not configured.') }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('An insecure connection was blocked. Your information was not sent.')
    }
    return url.href
  }

  root.CarCraftTransport = { requireSecurePage, requireHttpsUrl }
})(globalThis)
