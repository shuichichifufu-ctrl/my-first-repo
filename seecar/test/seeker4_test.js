const { openPage } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
const fs = require('fs');
const dir = 'C:/Users/s9h0u/.claude/my-first-repo/seecar/test/';
const save = (name, url) => fs.writeFileSync(dir + 'shots/' + name, Buffer.from(url.split(',')[1], 'base64'));
(async () => {
  const { browser, page, errors } = await openPage(dir + 'seeker4_test.html');
  const pal = await page.evaluate(() => SeekerModel.PALETTES);
  console.log(JSON.stringify(pal));
  console.log(JSON.stringify(await page.evaluate(() => apiCheck())));
  save('p4_palettes_2d.png', await page.evaluate(() => sheet(220)));
  save('p4_palettes_small.png', await page.evaluate(() => sheet(64)));
  save('p4_palettes_3d.png', await page.evaluate(() => sheet3d()));
  console.log('errors', JSON.stringify(errors));
  await browser.close(); process.exit(0);
})();
