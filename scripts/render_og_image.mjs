// Перерисовать src/og/og-image.jpg из src/og/og-image.html (картинка превью ссылок, 1200×630).
//
//     node scripts/render_og_image.mjs
//
// Запускается вручную после правки исходника, в сборку и CI не входит: нужны Google Chrome,
// npm ci и сеть (шрифты), а картинка меняется редко. Готовый jpg коммитится.
import { chromium } from 'playwright-core';
import { statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = fileURLToPath(new URL('../src/og/og-image.html', import.meta.url));
const TARGET = fileURLToPath(new URL('../src/og/og-image.jpg', import.meta.url));

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(SOURCE).href, { waitUntil: 'networkidle' });
  // Кайшу режется по unicode-range: куски с нужными знаками грузятся только по запросу.
  const loaded = await page.evaluate(async () => {
    await document.fonts.load('112px "LXGW WenKai Screen"', '语法');
    await document.fonts.ready;
    return document.fonts.check('112px "LXGW WenKai Screen"', '语法')
      && document.fonts.check('800 88px Alegreya', 'Лексика')
      && document.fonts.check('24px "Golos Text"', 'Лексика');
  });
  if (!loaded) throw new Error('шрифты не загрузились — нужна сеть');
  await page.screenshot({ path: TARGET, type: 'jpeg', quality: 88 });
} finally {
  await browser.close();
}
console.log(`готово: ${TARGET} (${Math.round(statSync(TARGET).size / 1024)} КБ)`);
