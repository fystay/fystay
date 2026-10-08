import { chromium } from "playwright";
import fs from "fs";
const OUT = "/tmp/claude-0/-home-user/a208fa37-a229-56c5-bc92-2b089058f6f1/scratchpad/host-audit/";
const BASE = "http://localhost:3000";
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(`[console ${page.url()}] ${m.text()}`); });
page.on("pageerror", (e) => errs.push(`[pageerror ${page.url()}] ${e.message}`));
page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("_next/static")) errs.push(`[http ${r.status()}] ${r.url()} (on ${page.url()})`); });
const shot = (n) => page.screenshot({ path: OUT + n + ".png", fullPage: true });
const scan = async (label) => {
  const t = await page.evaluate(() => document.body.innerText);
  const bad = ["undefined", "NaN", "Invalid Date", "null", "lorem", "TODO", "TBD"].filter((w) => new RegExp(`\\b${w}\\b`, "i").test(t));
  const imgs = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
  log(`SCAN ${label}: url=${page.url()} bad=${JSON.stringify(bad)} brokenImgs=${imgs.length}`);
};
const email = `audithost${Date.now()}@example.com`;
fs.writeFileSync(OUT + "email.txt", email);

await page.goto(BASE + "/register?role=host");
await shot("a01-register");
await page.fill("#name", "Audit Host");
await page.fill("input[type=email]", email);
await page.fill("input[type=password]", "AuditPass!2345");
const cb = page.locator("input[type=checkbox]");
if (await cb.count()) await cb.first().check();
await page.locator("button[type=submit]").click();
await page.waitForTimeout(4000);
log("after register ->", page.url());
await shot("a02-after-register");
await scan("after-register");

await page.goto(BASE + "/host");
await page.waitForTimeout(1500);
log("/host ->", page.url());
await shot("a03-host");
await scan("host");

await page.goto(BASE + "/host/listings/new");
await page.waitForTimeout(1500);
await shot("a04-new-listing");
await scan("new");
// empty submit
await page.locator("form button[type=submit]").last().click();
await page.waitForTimeout(500);
const inv = await page.evaluate(() => { const el = document.querySelector("form :invalid"); return el ? `${el.id}: ${el.validationMessage}` : "none"; });
log("empty submit first invalid:", inv);
// fill minimal invalid-ish data
await page.fill("#title", "ab");
await page.fill("#description", "short");
await page.fill("#city", "Blackpool");
await page.fill("#country", "UK");
await page.fill("#price", "-5");
const priceInv = await page.evaluate(() => document.querySelector("#price").validationMessage);
log("price -5 validation:", priceInv);
await page.fill("#price", "99999999");
// photo upload
await page.setInputFiles("input[type=file]", OUT + "test.png");
await page.waitForTimeout(4000);
await shot("a05-after-upload");
const photoCount = await page.locator("img[alt='']").count();
log("photos after upload imgs:", photoCount);
await page.locator("form button[type=submit]").last().click();
await page.waitForTimeout(2500);
log("after submit w/ short title url:", page.url());
const alertTxt = await page.evaluate(() => [...document.querySelectorAll('[role=alert], [data-sonner-toast], .text-red-600, .text-red-700')].map(e => e.innerText).join(" | "));
log("errors shown:", alertTxt);
await shot("a06-short-title-err");
// fix title/desc
await page.fill("#title", "Audit Test Seaside Flat");
await page.fill("#description", "A lovely seaside flat used purely for an audit. Two minutes from the promenade.");
await page.locator("form button[type=submit]").last().click();
await page.waitForTimeout(3000);
log("after submit absurd price url:", page.url());
log("errors shown:", await page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast]')].map(e => e.innerText).join(" | ")));
await shot("a07-after-save");
await scan("after-save");

fs.writeFileSync(OUT + "errsA.txt", errs.join("\n"));
log("ERRORS:\n" + errs.join("\n"));
await ctx.storageState({ path: OUT + "stateA.json" });
await browser.close();
