export const shop = 'Car Craft Auto Body & Towing'
export const inbox = 'carcraftllcauto@gmail.com'
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function estimateEmail(input: {
  kind: 'thanks' | 'estimate', name: string, vehicle?: string, details?: string,
}) {
  const thanks = input.kind === 'thanks'
  const title = thanks ? 'We received your estimate request' : 'Your repair estimate'
  const vehicle = input.vehicle ? ' for your ' + input.vehicle : ''
  const paragraphs = [
    'Hi ' + input.name + ',',
    thanks ? 'Thank you for sending your repair request' + vehicle + '. Our team will review the details and email your estimate.' : 'Here is our repair estimate' + vehicle + '.',
    ...(thanks ? [] : [input.details || '']),
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
<table role="presentation" align="center" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:white"><tr><td align="center" bgcolor="#18212b" style="padding:12px 24px;background-color:#18212b;border-bottom:5px solid #d52b1e;text-align:center"><img width="220" style="display:inline-block;width:220px;max-width:100%;height:auto;vertical-align:middle;color:#fff" src="https://carcraftautobodytowing.com/assets/images/branding/carcraft-logo.png" alt="Car Craft Auto Body &amp; Towing"></td></tr>
<tr><td style="padding:24px;overflow-wrap:anywhere"><h1 style="font-size:26px;line-height:1.2">${title}</h1>${paragraphs.map(p => '<p>' + escape(p).replace(/\n/g,'<br>') + '</p>').join('')}</td></tr>
<tr><td style="padding:24px;background:#18212b;color:#fff"><strong>${escape(shop)}</strong><br>${address}<br>${hours}<br><a style="color:white" href="tel:8609531966">860-953-1966</a></td></tr></table></body></html>`
  }
}
