// Browser fixtures served entirely by loopback HTTP servers. No account access.
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, "lms-agent/.playwright-browsers");
const { chromium } = await import("../lms-agent/node_modules/playwright/index.mjs");
const { ensureAuthenticated } = await import("../lms-agent/src/browser/login.js");
const { openMoodlePage } = await import("../lms-agent/src/browser/navigation.js");
const { readCoursesFromPage } = await import("../lms-agent/src/browser/courses.js");
const { safeMoodleError } = await import("../lms-agent/src/browser/errors.js");
const { requestMoodleFile } = await import("../lms-agent/src/browser/files.js");
const browser = await chromium.launch({ headless: true });
const form = '<main id="region-main"><form action="/login/index.php" method="post"><input name="username"><input name="password" type="password"><button type="submit">Log in</button></form></main>';
let mode = 'normal', signedIn = false, overviewRequests = 0, downloadRequests = 0;
const external = http.createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end(form)});
await new Promise(resolve=>external.listen(0,'127.0.0.1',resolve));
const server = http.createServer((request,response)=>{
  const url = new URL(request.url,'http://localhost');
  response.setHeader('Content-Type','text/html');
  if (url.pathname === '/file') {
    downloadRequests++;
    assert.equal(request.headers['accept-encoding'], 'identity');
    if (mode === 'download-stall' || downloadRequests === 1) { response.writeHead(200); response.write('partial'); return; }
    response.end('complete fixture');return;
  }
  if (url.pathname === '/slow-image.png') return;
  if (mode === 'server-error') {response.writeHead(503);response.end('private diagnostic');return;}
  if (mode === 'external') {response.writeHead(303,{location:'http://127.0.0.1:'+external.address().port+'/login'});response.end();return;}
  if (mode === 'delayed') {response.end(`<main id="region-main"><div class="block_myoverview"><div data-region="course-content"><div data-region="empty-message" hidden>No courses</div></div></div></main><script>setTimeout(()=>document.querySelector("[data-region=course-content]").insertAdjacentHTML("beforeend",'<a href="https://ucasaslms.org/course/view.php?id=11">Late-loaded course</a>'),250)</script>`);return;}
  if (url.pathname === '/login/index.php') {
    if(request.method === 'POST' && mode !== 'reject') {signedIn=true;response.writeHead(303,{location:'/my/courses.php'});response.end();return;}
    response.end(form+(request.method === 'POST'?'<div id="loginerrormessage">Invalid login</div>':''));return;
  }
  overviewRequests++;
  if(!signedIn) {response.writeHead(303,{location:'/login/index.php'});response.end();return;}
  response.end('<main id="region-main"><div class="block_myoverview"><div data-region="course-content"><a href="https://ucasaslms.org/course/view.php?id=10">Discrete Mathematics</a></div></div></main><img src="/slow-image.png">');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const destination='http://127.0.0.1:'+server.address().port+'/my/courses.php';
try {
 const page=await browser.newPage();page.setDefaultTimeout(3000);
 const credential={username:'fixture-user',password:'fixture-password'};
 const started=Date.now();
 await ensureAuthenticated(page,destination,{getCredential:async()=>credential,loginTimeout:2000});
 assert.ok(Date.now()-started<10000,'Login must not wait for an unrelated image to load');
 assert.equal(overviewRequests,2,'Do not reload a destination already reached after login');
 assert.equal(credential.password,'');
 assert.equal((await readCoursesFromPage(page))[0].name,'Discrete Mathematics');
 mode='delayed';await openMoodlePage(page,destination);
 assert.equal((await readCoursesFromPage(page))[0].id,'11','Hidden empty-state templates must not bypass course loading');
 mode='server-error';await assert.rejects(openMoodlePage(page,destination),error=>error.code==='server-unavailable'&&safeMoodleError(error).retryable&&!error.message.includes('private'));
 mode='reject';await assert.rejects(ensureAuthenticated(page,destination.replace('/my/courses.php','/login/index.php'),{getCredential:async()=>({username:'fixture',password:'fixture'}),loginTimeout:2000}),error=>error.code==='login-rejected');
 mode='external';let credentialReads=0;
 await assert.rejects(ensureAuthenticated(page,destination,{getCredential:async()=>{credentialReads++;return{}},loginTimeout:2000}),error=>error.code==='login-external');
 assert.equal(credentialReads,0);
 const downloadContext=await browser.newContext();
 try {
   const fileUrl=new URL('/file',destination).href;
   const downloaded=await requestMoodleFile(downloadContext,fileUrl,{timeout:200});
   assert.equal(await downloaded.text(),'complete fixture');
   await downloaded.dispose();
   assert.equal(downloadRequests,2,'Retry a stalled file transfer exactly once');
   mode='download-stall';downloadRequests=0;
   await assert.rejects(requestMoodleFile(downloadContext,fileUrl,{timeout:200}),error=>error.code==='download-timeout'&&!error.message.includes('Call log'));
   assert.equal(downloadRequests,2,'Stop after the second failed transfer');
 } finally { await downloadContext.close(); }
 console.log('Moodle navigation fixtures passed: stalled resources, redirects, rejected login, delayed courses, HTTP errors and external sign-in boundaries.');
} finally {
 await browser.close();server.closeAllConnections();external.closeAllConnections();
 await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>external.close(resolve))]);
}
