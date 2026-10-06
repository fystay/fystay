import { test, expect, type Page } from "@playwright/test";

// A phone photo is usually bigger than a Vercel function will accept (about
// 4.5MB), so the browser resizes it before uploading. The storage service
// isn't reachable from tests, so the upload endpoint is stood in for here -
// what's checked is what the browser actually sends.

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** A grainy 3200x2400 PNG - grain barely compresses, so like a phone photo it's well over 4.5MB. */
async function largePhoto(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 3200;
    canvas.height = 2400;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < image.data.length; i += 4) {
      const x = (i / 4) % canvas.width;
      const grain = () => (Math.random() - 0.5) * 60;
      image.data[i] = 120 + (x / canvas.width) * 100 + grain();
      image.data[i + 1] = 150 + grain();
      image.data[i + 2] = 200 - (x / canvas.width) * 80 + grain();
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

test("a large phone photo is resized to a JPEG under the upload limit before it's sent", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, "host@fystay.dev", "hostpass123");
  await page.goto("/host/listings/new");

  const original = await largePhoto(page);
  expect(original.length).toBeGreaterThan(4.5 * 1024 * 1024);

  let sent: { bytes: number; body: string } | null = null;
  await page.route("**/api/uploads", async (route) => {
    const body = route.request().postDataBuffer() ?? Buffer.alloc(0);
    sent = { bytes: body.length, body: body.toString("latin1") };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ url: "/images/destinations/cleveleys.jpg" }),
    });
  });

  await page.locator("input[type=file]").first().setInputFiles({
    name: "IMG_2041.png",
    mimeType: "image/png",
    buffer: original,
  });

  await expect(page.locator('img[src*="cleveleys"]').first()).toBeVisible({ timeout: 30_000 });
  expect(sent).not.toBeNull();
  const { bytes, body } = sent!;
  expect(bytes).toBeLessThan(4 * 1024 * 1024);
  expect(body).toContain('filename="IMG_2041.jpg"');
  expect(body).toContain("Content-Type: image/jpeg");
});

test("a failed upload shows a plain message, not the server's error", async ({ page }) => {
  await login(page, "host@fystay.dev", "hostpass123");
  await page.goto("/host/listings/new");
  // The platform's own "too large" page is HTML, not JSON.
  await page.route("**/api/uploads", (route) =>
    route.fulfill({ status: 413, contentType: "text/html", body: "<html>FUNCTION_PAYLOAD_TOO_LARGE</html>" }),
  );

  await page.locator("input[type=file]").first().setInputFiles({
    name: "beach.png",
    mimeType: "image/png",
    // A 1x1 PNG.
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await expect(page.getByText("We couldn't upload beach.png. Please try again.")).toBeVisible();
  await expect(page.getByText("FUNCTION_PAYLOAD_TOO_LARGE")).toHaveCount(0);
});
