const {chromium} = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
fs.mkdirSync(path.resolve('outputs'), {recursive:true});
const root = path.resolve(__dirname,'../..');
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath:process.env.CHROME_BIN || undefined, headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1240,height:1200}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/preview.html`);
    const first = page.locator('#first nyssetulee-card');
    const second = page.locator('#second nyssetulee-card');
    await first.getByText('Select an origin and destination to see departures.').waitFor();
    assert.equal(await page.evaluate(() => window.requests.length), 0);
    assert.equal(await first.locator('#origin').inputValue(), '');
    assert.equal(await first.getByRole('textbox').count(), 0);
    await page.screenshot({path:path.resolve('outputs/nyssetulee-public-empty.png'), fullPage:true});
    const select = async (section, label, name) => {
      const editor = page.locator(`#${section} nyssetulee-card-editor`);
      await editor.getByRole('textbox', {name:label, exact:true}).fill(name);
      await editor.getByRole('button', {name, exact:true}).click();
    };
    await select('first', 'Origin address', 'Place A');
    assert.equal(await page.evaluate(() => window.requests.filter(m => m.type === 'nyssetulee/journey').length), 0);
    await select('first', 'Destination address', 'Place B');
    await first.getByText('Live prediction', {exact:false}).waitFor();
    assert.equal(await first.locator('h3').innerText(), 'Place A → Place B');
    assert.equal(await second.locator('h3').count(), 0);
    await select('second', 'Origin address', 'Place C');
    await select('second', 'Destination address', 'Place A');
    await second.getByText('Live prediction', {exact:false}).waitFor();
    assert.equal(await second.locator('h3').innerText(), 'Place C → Place A');
    const calls = await page.evaluate(() => window.requests.filter(m => m.type === 'nyssetulee/journey'));
    assert.deepEqual(calls.map(m => [m.origin.name,m.destination.name]), [['Place A','Place B'],['Place C','Place A']]);
    const saved = await page.evaluate(() => window.saved);
    assert.equal(saved.first.origin.name, 'Place A');
    assert.equal(saved.second.origin.name, 'Place C');
    await page.evaluate(() => {
      for (const section of document.querySelectorAll('section')) {
        const card = section.querySelector('nyssetulee-card');
        card.hass = {...card._hass, locale:{language:'fi'}};
        section.querySelector('nyssetulee-card-editor').hass = card._hass;
      }
    });
    await first.getByRole('button', {name:'Päivitä aikataulut'}).waitFor();
    assert.match(await first.locator('.countdown').innerText(), /1 h 5 min kuluttua/);
    assert.equal(await page.evaluate(() => window.requests.filter(m => m.type === 'nyssetulee/journey').length), 2);
    await first.getByRole('button', {name:'Vaihda lähtöpaikka: Place A', exact:true}).click();
    await first.getByRole('textbox', {name:'Lähtöosoite', exact:true}).fill('Place D');
    await first.getByRole('button', {name:'Place D', exact:true}).click();
    await page.waitForFunction(() => !document.querySelector('#first nyssetulee-card')._loading);
    assert.equal(await first.locator('h3').innerText(), 'Place D → Place B');
    assert.equal(await first.getByRole('textbox').count(), 0);
    assert.equal(await second.locator('h3').innerText(), 'Place C → Place A');
    assert.equal(await page.evaluate(() => window.saved.first.origin.name), 'Place A');
    await first.getByRole('button', {name:'Vaihda määränpää: Place B', exact:true}).click();
    await first.getByRole('textbox', {name:'Määränpään osoite', exact:true}).fill('Unselected text');
    await first.getByRole('textbox', {name:'Määränpään osoite', exact:true}).press('Escape');
    assert.equal(await first.getByRole('textbox').count(), 0);
    assert.equal(await first.locator('h3').innerText(), 'Place D → Place B');
    assert.match(await first.locator('footer').innerText(), /Matkatiedot: Digitransit\./);
    await page.screenshot({path:path.resolve('outputs/nyssetulee-public-editor.png'), fullPage:true});
    // Saving/recreating a card uses only the user's selected configuration.
    await page.evaluate(() => {
      const card = document.querySelector('#first nyssetulee-card');
      card.setConfig(window.saved.first);
    });
    await first.getByText('Reaaliaikainen ennuste', {exact:false}).waitFor();
    assert.equal(await first.locator('h3').innerText(), 'Place A → Place B');
    assert.deepEqual(errors, []);
    console.log('Passed: blank startup, editor persistence, independent routes, compact inline editing, Escape cancellation, localized footer, cache flags, and saved-config recreation.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error);process.exitCode=1;});
