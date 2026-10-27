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

function spotlight(page: Page) {
  return page.locator("section", { has: page.getByRole("heading", { name: "Spotlight stays" }) });
}

// Spotlight auto-advances; hold it still so the first card stays put.
test.use({ contextOptions: { reducedMotion: "reduce" } });

test("a featured listing leads the Spotlight carousel, labelled Promoted, and its host sees views and clicks", async ({
  page,
}) => {
  await logInAsHost(page);
  const title = await featureListing(page, 0);

  // Listening from before the page loads: a promoted card reports its view
  // as soon as it's on screen.
  const impression = page.waitForRequest(
    (request) => request.url().endsWith("/api/spotlight/events") && request.postData()?.includes('"impression"') === true,
  );
  await page.goto("/");
  const row = spotlight(page);
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByText("Stays marked Promoted are featured by their hosts.")).toBeVisible();
  // :visible - the rail also renders a hidden sizing copy of its first card.
  const card = row.locator("ul > li:visible", { has: page.getByRole("link", { name: title }) }).first();
  await expect(card.getByText("Promoted", { exact: true })).toBeVisible();
  // Paid placements come before the unpaid favourites.
  await expect(row.locator("ul > li:visible").first().getByText("Promoted", { exact: true })).toBeVisible();
  await impression;

  // Opening it is reported as a click.
  const click = page.waitForRequest(
    (request) => request.url().endsWith("/api/spotlight/events") && request.postData()?.includes('"click"') === true,
  );
  await card.getByTestId("listing-card-title").click();
  await click;
  await expect(page).toHaveURL(/\/listings\//);

  // The host sees it on their Spotlight page (counts may already include
  // earlier visits in this run - each visitor is counted once in a while).
  await page.goto("/host/promote");
  const hostCard = page.locator("main ul > li").filter({ hasText: title });
  await expect(async () => {
    await page.reload();
    await expect(hostCard.getByText(/Seen [1-9][\d,]* times?/)).toBeVisible({ timeout: 1000 });
    await expect(hostCard.getByText(/[1-9][\d,]* clicks? to your listing/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
});
