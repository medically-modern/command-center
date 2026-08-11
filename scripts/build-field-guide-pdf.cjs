const { chromium } = require('playwright');
const SRC = process.argv[2], OUT = process.argv[3];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file://' + SRC, { waitUntil: 'networkidle' });
  const docTitle = (await p.title()) || 'Command Center';
  await p.emulateMedia({ media: 'print', colorScheme: 'light' });
  await p.pdf({
    path: OUT, format: 'A4', printBackground: true,
    margin: { top: '15mm', bottom: '16mm', left: '14mm', right: '14mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-family:-apple-system,Segoe UI,sans-serif;font-size:7.5pt;color:#77828F;padding:0 14mm;display:flex;justify-content:space-between;">' +
      '<span>' + docTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>' +
      '<span class="pageNumber"></span></div>',
  });
  await b.close();
  console.log(errs.length ? 'ISSUES:\n' + errs.join('\n') : 'no console/page errors');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
