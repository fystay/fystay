import { chromium } from "@playwright/test";
const S="/tmp/claude-0/-home-user/a208fa37-a229-56c5-bc92-2b089058f6f1/scratchpad/guest-audit/shots/";
const B="http://localhost:3000";
const EMAIL="audit1791428986739@example.com", PW="Sup3rStrongPass!";
const L="/listings/cmuxrg3uc00247dcmb5qgpmn4";
const D="/bookings/cmuyyoolj000r7d8f499mllwu";
const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium"});
const log=[];
const c=await browser.newContext({viewport:{width:1280,height:900}});
const p=await c.newPage();
p.on("console",m=>{if(m.type()==="error"||m.type()==="warning")log.push(`console.${m.type()} @${p.url()}: ${m.text().slice(0,300)}`)});
p.on("pageerror",e=>log.push(`pageerror @${p.url()}: ${e.message.slice(0,300)}`));
const reqs=[];p.on("request",r=>{if(r.method()!=="GET"&&r.url().includes("/api/"))reqs.push(r.method()+" "+r.url().replace(B,""))});
const step=async(n,full=false,pg=p)=>{await pg.waitForTimeout(900);await pg.screenshot({path:S+n+".png",fullPage:full});console.log("STEP",n,pg.url());};
const T=async(n,f)=>{try{await f()}catch(e){console.log("FAIL",n,e.message.split("\n")[0])}};
const txt=async(sel="main",pg=p)=>(await pg.locator(sel).first().innerText()).replace(/\n+/g," | ");
await p.goto(B+"/login");await p.waitForLoadState("networkidle");
await T("cookie",()=>p.getByRole("button",{name:"Got it"}).click({timeout:3000}));
await p.locator("input[type=email]").fill(EMAIL);await p.locator("input[type=password]").fill(PW);await p.locator("form button[type=submit]").first().click();await p.waitForTimeout(3500);
await p.context().storageState({path:"/tmp/claude-0/-home-user/a208fa37-a229-56c5-bc92-2b089058f6f1/scratchpad/guest-audit/state.json"});
await p.goto(B+D);await p.waitForLoadState("networkidle");
await T("msg",async()=>{await p.locator("main").getByRole("button",{name:"Message host"}).click();await p.waitForTimeout(800);await step("s9-msg");
 const dlg=p.locator("[role=dialog]:visible").last();await dlg.locator("textarea").fill("Hi, what time is check-in? (audit test)");reqs.length=0;
 await dlg.getByRole("button",{name:/^Send/}).dblclick();await p.waitForTimeout(3000);console.log("send reqs",reqs);await step("s9-msg-sent");console.log("after send url",p.url());});
await p.goto(B+"/inbox");await p.waitForLoadState("networkidle");console.log("inbox:",(await txt()).slice(0,400));
const conv=await p.locator("main a[href^='/inbox/']").first().getAttribute("href").catch(()=>null);
if(conv){await p.goto(B+conv);await p.waitForLoadState("networkidle");await step("s9-conv");console.log("conv:",(await txt()).slice(0,600));}
// cancel
await p.goto(B+D);await p.waitForLoadState("networkidle");
await T("cancel",async()=>{await p.locator("main").getByRole("button",{name:"Cancel booking"}).first().click();await p.waitForTimeout(800);
 const dlg=p.locator("[role=dialog]:visible").last();reqs.length=0;const b=dlg.getByRole("button",{name:"Cancel booking"});await b.click();await b.click({timeout:300}).catch(()=>{});await step("s9-cancelling");await p.waitForTimeout(3000);console.log("cancel reqs",reqs);await step("s9-cancelled",true);console.log("after cancel:",(await txt()).slice(0,600));});
await p.goto(B+"/bookings");await p.waitForLoadState("networkidle");console.log("bookings:",(await txt()).slice(0,500));
await T("tab",async()=>{await p.getByRole("tab",{name:/Cancelled/}).or(p.getByRole("button",{name:/Cancelled/})).first().click();await p.waitForTimeout(800);await step("s9-cancelled-tab",true);console.log("cancelled tab:",(await txt()).slice(0,500));});
// mobile
const m=await browser.newContext({viewport:{width:390,height:844},storageState:"/tmp/claude-0/-home-user/a208fa37-a229-56c5-bc92-2b089058f6f1/scratchpad/guest-audit/state.json",isMobile:true,hasTouch:true});
const q=await m.newPage();
q.on("console",x=>{if(x.type()==="error")log.push(`m console.error @${q.url()}: ${x.text().slice(0,300)}`)});q.on("pageerror",e=>log.push(`m pageerror @${q.url()}: ${e.message}`));
for(const u of [L+"?checkIn=2026-12-01&checkOut=2026-12-04","/search?city=Lytham","/search?city=Lytham&view=map","/bookings",D,D+"/receipt","/wishlist","/account","/inbox",...(conv?[conv]:[]),"/login","/register","/forgot-password"]){
 await q.goto(B+u);await q.waitForLoadState("networkidle").catch(()=>{});await q.waitForTimeout(600);
 const sw=await q.evaluate(()=>document.documentElement.scrollWidth);
 const wide=await q.evaluate(()=>[...document.querySelectorAll("body *")].filter(e=>{const r=e.getBoundingClientRect();return r.right>392&&r.width>0&&getComputedStyle(e).position!=="fixed"}).slice(0,4).map(e=>e.tagName+"."+String(e.className).slice(0,60)+" r="+Math.round(e.getBoundingClientRect().right)));
 const t=await q.locator("body").innerText();const bads=["undefined","NaN","null"].filter(b=>new RegExp("\\b"+b+"\\b").test(t));
 console.log("M",u,"sw",sw,bads.length?"BAD "+bads:"",sw>390?JSON.stringify(wide):"");
 await q.screenshot({path:S+"m9"+u.replace(/[\/?=&]/g,"_").slice(0,60)+".png",fullPage:false});}
// mobile gallery swipe
await q.goto(B+L);await q.waitForLoadState("networkidle");
await T("mgallery",async()=>{await q.getByRole("button",{name:/Show all|photos/i}).first().click();await q.waitForTimeout(800);await q.screenshot({path:S+"m9-gallery.png"});
 console.log("gallery counter:",await q.locator("text=/\\d+ \\/ \\d+/").first().innerText().catch(()=>"none"));
 const box={x:300,y:420};await q.touchscreen.tap(box.x,box.y);
 await q.evaluate(async()=>{const el=document.elementFromPoint(300,420);const mk=(t,x)=>new TouchEvent(t,{bubbles:true,cancelable:true,touches:t==="touchend"?[]:[new Touch({identifier:1,target:el,clientX:x,clientY:420})],changedTouches:[new Touch({identifier:1,target:el,clientX:x,clientY:420})]});el.dispatchEvent(mk("touchstart",320));el.dispatchEvent(mk("touchmove",200));el.dispatchEvent(mk("touchmove",60));el.dispatchEvent(mk("touchend",60));});
 await q.waitForTimeout(800);console.log("after swipe counter:",await q.locator("text=/\\d+ \\/ \\d+/").first().innerText().catch(()=>"none"));await q.screenshot({path:S+"m9-gallery-swipe.png"});});
console.log(log.join("\n"));
await browser.close();
