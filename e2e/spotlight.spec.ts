import { test, expect, type Page } from "@playwright/test";

// Without a Stripe key (CI, local development) a Spotlight purchase is
// activated straight away - the same dev-mode fallback every checkout uses -
// so the whole journey can run here.

async function logInAsHost(page: Page) {
  await page.goto("/login");
  await page.fill("#email", "host@fystay.dev");
  await page.fill("#password", "hostpass123");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Features the host's nth listing for 7 days and returns its title. */
async function featureListing(page: Page, nth: number): Promise<string> {
  await page.goto("/host/promote");
  // Scoped to rows that offer a Spotlight purchase - the hosting menu is a list too.
  const listing = page
    .locator("main ul > li")
    .filter({ has: page.getByRole("button", { name: /(Feature for|Add) 7 days/ }) })
    .nth(nth);
  const title = (await listing.locator("p.font-semibold").first().textContent())!.trim();
  // A listing that's already featured (from an earlier run) offers "Add"
  // instead of "Feature for" - either buys another 7 days.
  await listing.getByRole("button", { name: /(Feature for|Add) 7 days/ }).click();
  await expect(page.getByText(`${title} is in Spotlight`)).toBeVisible();
  await expect(listing.getByText(/Live until/)).toBeVisible();
  return title;
}

function showcase(page: Page) {
  return page.locator("section", { has: page.getByRole("heading", { name: "Spotlight stays" }) });
}

function featuredTitle(page: Page) {
  return showcase(page).getByRole("group").getByRole("link");
}

test("a featured listing shows in the Spotlight showcase, labelled Promoted, and its host sees views and clicks", async ({
  page,
}) => {
  await logInAsHost(page);
  const title = await featureListing(page, 0);
  // A second live placement, so the showcase has its list and pause button
  // whatever else this run has featured (the seed features nothing).
  await featureListing(page, 1);

  // Listening from before the page loads: the showcase reports whichever
  // stay it opens on (chosen at random) as soon as it's on screen, which can
  // be before any later step of this test.
  const impression = page.waitForRequest(
    (request) => request.url().endsWith("/api/spotlight/events") && request.postData()?.includes('"impression"') === true,
  );
  await page.goto("/");
  const spotlight = showcase(page);
  await spotlight.scrollIntoViewIfNeeded();
  await expect(spotlight.getByText("Featured by local hosts.")).toBeVisible();
  await expect(spotlight.getByText("Promoted", { exact: true })).toBeVisible();
  await impression;

  // Paused, so it can't move on by itself mid-test, then this stay brought to
  // the front from the list beside the showcase (desktop).
  await spotlight.getByRole("button", { name: "Pause Spotlight stays" }).click();
  await spotlight.getByRole("button", { name: new RegExp(title) }).click();
  await expect(featuredTitle(page)).toHaveText(title);

  // Clicking through opens the listing and is reported as a click.
  const click = page.waitForRequest(
    (request) => request.url().endsWith("/api/spotlight/events") && request.postData()?.includes('"click"') === true,
  );
  await featuredTitle(page).click();
  await click;
  await expect(page).toHaveURL(/\/listings\//);

  // The host sees it on their Spotlight page (counts may already include
  // earlier visits in this run - each visitor is counted once in a while).
  await page.goto("/host/promote");
  const card = page.locator("main ul > li").filter({ hasText: title });
  await expect(async () => {
    await page.reload();
    await expect(card.getByText(/Seen [1-9][\d,]* times?/)).toBeVisible({ timeout: 1000 });
    await expect(card.getByText(/[1-9][\d,]* clicks? to your listing/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
});

test("the showcase moves on by itself, stops when paused, and never moves under reduced motion", async ({
  page,
  browser,
}) => {
  test.slow();
  await logInAsHost(page);
  await featureListing(page, 0);
  await featureListing(page, 1);

  await page.goto("/");
  await showcase(page).scrollIntoViewIfNeeded();
  // Keep the pointer off it - resting on it pauses it.
  await page.mouse.move(0, 0);
  const first = await featuredTitle(page).textContent();
  await expect(featuredTitle(page)).not.toHaveText(first!, { timeout: 9000 });

  await showcase(page).getByRole("button", { name: "Pause Spotlight stays" }).click();
  await page.mouse.move(0, 0);
  const paused = await featuredTitle(page).textContent();
  await page.waitForTimeout(7500);
  await expect(featuredTitle(page)).toHaveText(paused!);
  await expect(showcase(page).getByRole("button", { name: "Play Spotlight stays" })).toBeVisible();

  const reduced = await browser.newPage({ reducedMotion: "reduce" });
  await reduced.goto("/");
  await showcase(reduced).scrollIntoViewIfNeeded();
  await reduced.mouse.move(0, 0);
  const still = await featuredTitle(reduced).textContent();
  await reduced.waitForTimeout(7500);
  await expect(featuredTitle(reduced)).toHaveText(still!);
  // Nothing to pause - but the arrows still move it on request.
  await expect(showcase(reduced).getByRole("button", { name: /Pause|Play/ })).toHaveCount(0);
  await showcase(reduced).getByRole("button", { name: "Next Spotlight stay" }).click();
  await expect(featuredTitle(reduced)).not.toHaveText(still!);
  await reduced.close();
});
