import { test, expect } from "@playwright/test";

test("every footer link leads to a real page, not a dead '#' link or 404", async ({ page }) => {
  await page.goto("/");

  const footer = page.locator("footer");
  const links = await footer.getByRole("link").all();
  expect(links.length).toBeGreaterThan(0);

  const hrefs = new Set<string>();
  for (const link of links) {
    const href = await link.getAttribute("href");
    expect(href, "footer link must not be a dead '#' anchor").not.toBe("#");
    expect(href).not.toBeNull();
    if (href) hrefs.add(href);
  }

  for (const href of hrefs) {
    await page.goto(href);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The catch-all not-found page renders its own distinct heading, so
    // visiting it directly would fail this assertion instead of silently
    // passing.
    await expect(page.getByText("We can't find that page")).toHaveCount(0);
  }
});

test("Terms, Privacy, and Cookie policy pages render real content", async ({ page }) => {
  await page.goto("/legal/terms");
  await expect(page.getByRole("heading", { name: "Terms and Conditions" })).toBeVisible();
  await expect(page.getByText(/Cancellations and refunds/)).toBeVisible();

  await page.goto("/legal/privacy");
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByText(/Your rights/)).toBeVisible();

  await page.goto("/legal/cookies");
  await expect(page.getByRole("heading", { name: "Cookie Policy" })).toBeVisible();
  // Scoped to <main>: the site-wide cookie consent banner (rendered as a
  // sibling of <main>, on every page) uses near-identical wording ("...
  // strictly necessary cookies...") to this page's own paragraph, so an
  // unscoped match is ambiguous the moment the banner has had time to
  // reveal itself post-hydration - a pre-existing race, not new to this
  // page. Scoping to the page's own content avoids the ambiguity outright
  // rather than depending on the banner's timing at all.
  await expect(page.locator("main").getByText(/strictly necessary/)).toBeVisible();
});

test("cookie notice shows on first visit, and dismissing it persists across reloads", async ({
  page,
}) => {
  await page.goto("/");

  const notice = page.getByRole("region", { name: "Cookie notice" });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: "Cookie Policy" })).toHaveAttribute(
    "href",
    "/legal/cookies",
  );

  await notice.getByRole("button", { name: "Got it" }).click();
  await expect(notice).toBeHidden();

  await page.reload();
  await expect(page.getByRole("region", { name: "Cookie notice" })).toBeHidden();
});

test("the short /privacy, /terms and /cookies addresses open the legal pages", async ({ page }) => {
  for (const [short, heading] of [
    ["/privacy", "Privacy Policy"],
    ["/terms", "Terms and Conditions"],
    ["/cookies", "Cookie Policy"],
  ]) {
    await page.goto(short);
    await expect(page).toHaveURL(new RegExp(`/legal${short}$`));
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  }
});
