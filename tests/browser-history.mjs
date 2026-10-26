import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Fully mocked local UI check: no production API, Auth or Realtime connections.
const api = 'https://history-test.supabase.test';
const host = '00000000-0000-4000-8000-000000000001';
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:host,role:'authenticated',exp})).toString('base64url')}.test`;
const server = await createServer({
  server: {host:'127.0.0.1',port:0},
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(api),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('browser-test-only'),
  },
});
let browser;
try {
  await server.listen();
  const url = server.resolvedUrls.local[0];
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined, headless: true});
  await mkdir('test-results', {recursive: true});
  for (const viewport of [{width:1280,height:900},{width:360,height:780}]) {
    const context = await browser.newContext({viewport});
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let historyCalls = 0, failHistory = false, emptyHistory = false;
    let revision = 1;
    const room = () => ({
      id:'1234',protocol:2,hostId:host,status:'waiting',pot:0,ante:1,roundCount:revision,revision,createdAt:Date.now(),
      players: Object.fromEntries(Array.from({length:6}, (_,i) => {
        const id = i === 0 ? host : `friend-${i}`;
        return [id,{id,nickname:`成员 ${i + 1}`,avatar:'',balance:0,status:'active',cardStatus:'blind',isOnline:true,isHost:i === 0}];
      })),
      logs:[{id:`event-${revision}`,timestamp:Date.now(),userId:host,userName:'成员 1',type:'system',action:`本轮记录 ${revision}`}],
    });
    await page.addInitScript(({host,jwt,exp}) => {
      localStorage.setItem('zjh_session', JSON.stringify({roomId:'1234',userId:host}));
      localStorage.setItem('sb-history-test-auth-token', JSON.stringify({access_token:jwt,refresh_token:'test',token_type:'bearer',expires_at:exp,expires_in:3600,user:{id:host,aud:'authenticated',role:'authenticated',is_anonymous:true}}));
    }, {host,jwt,exp});
    await page.routeWebSocket(/history-test\.supabase\.test/, () => {});
    await page.route('**/*', async route => {
      const requestUrl = route.request().url();
      if (requestUrl.startsWith(url)) return route.continue();
      if (!requestUrl.startsWith(api)) return route.abort();
      if (requestUrl.includes('/rest/v1/rooms')) return route.fulfill({json:{content:room()}});
      if (requestUrl.includes('/rest/v1/rpc/room_history')) {
        historyCalls++;
        await new Promise(resolve => setTimeout(resolve, 100));
        if (failHistory) return route.fulfill({status:503,json:{message:'测试读取失败'}});
        const {p_before,p_limit} = route.request().postDataJSON();
        assert.equal(p_limit,50);
        const newest = p_before ? Number(p_before)-1 : 1600;
        const entries = emptyHistory ? [] : Array.from({length:Math.min(50,newest)},(_,i) => ({
          cursor:String(newest-i),event:{
            id:String(newest-i),timestamp:1700000000000+newest-i,
            userId:newest-i===1599 ? 'friend-1' : host,
            userName:newest-i===1599 ? '成员 2' : '成员 1',
            type:newest-i===1599 ? 'transfer' : newest-i===1598 ? 'system' : 'bet',
            action:newest-i===1599 ? '成员 2 转给 成员 3 20' : newest-i===1598 ? '第 200 轮开始，已扣底注' : `历史操作 ${newest-i}：成员 1 下注 2`,
          },
        }));
        return route.fulfill({json:{entries,nextCursor:!emptyHistory && newest>50 ? entries.at(-1).cursor : null}});
      }
      return route.abort();
    });
    await page.goto(url);
    await page.getByRole('button',{name:'房间记录',exact:true}).waitFor();
    assert.equal(historyCalls,0);
    const domBefore = await page.locator('*').count();
    // Repeated compact updates must not accumulate historical DOM nodes.
    for (let i=2;i<=200;i++) {
      revision=i;
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.getByText(`本轮记录 ${i}`,{exact:false}).waitFor();
    }
    assert.equal(historyCalls,0);
    const domAfter = await page.locator('*').count();
    assert.ok(domAfter <= domBefore+5);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({path:`test-results/room-${viewport.width}.png`,fullPage:true});
    const announcement = page.getByRole('button',{name:'查看最近50条房间动态'});
    await announcement.click();
    const dialog = page.getByRole('dialog',{name:'房间记录'});
    await dialog.getByText('历史操作 1600：成员 1 下注 2',{exact:true}).waitFor();
    assert.equal(await dialog.locator('li').count(),50);
    await dialog.getByText('成员 2 转给 成员 3 20',{exact:true}).waitFor();
    const transfer = dialog.locator('li').filter({hasText:'成员 2 转给 成员 3 20'});
    assert.equal(await transfer.getByText('操作人：成员 2',{exact:true}).count(),1);
    const roundStart = dialog.locator('li').filter({hasText:'第 200 轮开始，已扣底注'});
    assert.equal(await roundStart.getByText('操作人：成员 1',{exact:true}).count(),1);
    await dialog.getByRole('button',{name:'更早记录'}).click();
    await dialog.getByText('历史操作 1550：成员 1 下注 2',{exact:true}).waitFor();
    assert.equal(await dialog.locator('li').count(),50);
    assert.equal(await dialog.getByText('历史操作 1600：成员 1 下注 2',{exact:true}).count(),0);
    await dialog.getByRole('button',{name:'上一页'}).click();
    await dialog.getByText('历史操作 1600：成员 1 下注 2',{exact:true}).waitFor();
    const box = await dialog.boundingBox();
    assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=viewport.width && box.y+box.height<=viewport.height);
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.screenshot({path:`test-results/history-${viewport.width}.png`});
    failHistory=true;
    await dialog.getByRole('button',{name:'刷新最新记录'}).click();
    await dialog.getByRole('alert').waitFor();
    failHistory=false;
    await dialog.getByRole('button',{name:'重试',exact:true}).click();
    await dialog.getByText('历史操作 1600：成员 1 下注 2',{exact:true}).waitFor();
    emptyHistory=true;
    await dialog.getByRole('button',{name:'刷新最新记录'}).click();
    await dialog.getByText('暂无记录').waitFor();
    assert.equal(await dialog.getByRole('button',{name:'更早记录'}).isDisabled(),true);
    await dialog.getByRole('button',{name:'关闭对话框'}).click();
    assert.equal(await page.locator('[role="dialog"]').count(),0);
    emptyHistory=false;
    await announcement.focus();
    await announcement.press('Enter');
    await dialog.getByText('历史操作 1600：成员 1 下注 2',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'关闭对话框'}).click();
    await page.getByRole('button',{name:'房间记录',exact:true}).click();
    await dialog.getByText('历史操作 1600：成员 1 下注 2',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'关闭对话框'}).click();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({viewport,updates:200,domBefore,domAfter,historyCalls,result:'passed'}));
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
