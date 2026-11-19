export const shop = 'Car Craft Auto Body & Towing'
export const inbox = 'carcraftllcauto@gmail.com'
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function estimateEmail(input: {
  kind: 'thanks' | 'estimate', name: string, vehicle?: string, details?: string,
  minAmountCents?: number, maxAmountCents?: number
}) {
  const thanks = input.kind === 'thanks'
  const title = thanks ? 'We received your estimate request' : 'Your repair estimate'
  const vehicle = input.vehicle ? ' for your ' + input.vehicle : ''
  const amount = input.minAmountCents === undefined ? '' : money.format(input.minAmountCents / 100)
  const range = input.maxAmountCents === undefined ? amount : amount + ' – ' + money.format(input.maxAmountCents / 100)
  const paragraphs = [
    'Hi ' + input.name + ',',
    thanks ? 'Thank you for sending your repair request' + vehicle + '. Our team will review the details and email your estimate.' : 'Here is our repair estimate' + vehicle + '.',
    ...(thanks ? [] : ['Estimated repair cost: ' + range, input.details || '']),
    thanks ? 'You can reply to this email if you have questions or would like to add anything.' : 'Reply to this email or call us to discuss the repair and next steps.',
    'The Car Craft team'
  ]
  const address = '8 South St, West Hartford, CT 06110'
  const hours = 'Monday–Friday, 8:30 AM–4:30 PM'
  const footer = [address, hours, '860-953-1966'].join('\n')
  return {
    subject: title + ' | ' + shop,
    textContent: [shop, title, ...paragraphs, footer].join('\n\n'),
    htmlContent: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f1f3f5;font:16px/1.6 Arial,sans-serif;color:#18212b">
<table role="presentation" align="center" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:white"><tr><td style="padding:24px;border-bottom:5px solid #d52b1e"><img width="180" src="https://carcraftautobodytowing.com/assets/images/branding/carcraft-logo.png" alt="Car Craft Auto Body &amp; Towing"></td></tr>
<tr><td style="padding:24px;overflow-wrap:anywhere"><h1 style="font-size:26px;line-height:1.2">${title}</h1>${paragraphs.map(p => '<p>' + escape(p).replace(/\n/g,'<br>') + '</p>').join('')}</td></tr>
<tr><td style="padding:24px;background:#18212b;color:#fff"><strong>${escape(shop)}</strong><br>${address}<br>${hours}<br><a style="color:white" href="tel:8609531966">860-953-1966</a></td></tr></table></body></html>`
  }
}
