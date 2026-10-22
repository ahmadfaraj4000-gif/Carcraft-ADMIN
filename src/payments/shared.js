export const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
export const dateTime = value => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value))
export const statusLabel = status => ({ pending: 'Awaiting payment', creating_checkout: 'Preparing checkout', checkout_started: 'Checkout started', processing: 'Verifying payment', review: 'Needs verification', paid: 'Paid', declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired' }[status] || status)
export function parseAmount(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null
  const [whole, fraction = ''] = value.trim().split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100000000 ? cents : null
}
export function paymentError(error, fallback) {
  return typeof error?.data === 'string' ? error.data : fallback
}
