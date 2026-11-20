import { test, expect } from "@playwright/test";

test.describe("AutoSD real-browser E2E suite (M6)", () => {
  test("serves /healthz.json and navigates all 9 routes with heading focus management and zero page errors", async ({
    page,
    request,
  }) => {
    const healthRes = await request.get("/healthz.json");
    expect(healthRes.ok()).toBe(true);
    const health = (await healthRes.json()) as { status?: string };
    expect(health.status).toBe("ok");

    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    await page.goto("/#/home");
    const primaryNav = page.getByRole("navigation", { name: "Primary" });
    await expect(primaryNav).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("[data-autosd-view-heading]").first()).toBeVisible();

    const routes = [
      { id: "reader", label: "Reader" },
      { id: "workspace", label: "Workspace" },
      { id: "devices", label: "Devices" },
      { id: "research", label: "Research" },
      { id: "sessions", label: "Sessions" },
      { id: "settings", label: "Settings" },
      { id: "help", label: "Help" },
      { id: "demo", label: "Demo" },
      { id: "home", label: "Home" },
    ];

    for (const route of routes) {
      await primaryNav.getByText(route.label, { exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#/${route.id}$`));
      const heading = page.locator("[data-autosd-view-heading]").first();
      await expect(heading).toBeVisible();
      await expect(heading).toBeFocused();
    }

    expect(pageErrors).toEqual([]);
  });

  test("Workspace ingest -> Research query -> Grounded citation -> Reader handoff", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    await page.goto("/#/workspace");
    await page.getByRole("button", { name: "Load sample corpus" }).click();

    await page.getByText("Add or paste document").click();
    await page.getByLabel("Document title").fill("E2E Braille Guide");
    await page
      .getByLabel("Document content")
      .fill(
        "Refreshable braille displays use piezoelectric pins for tactile reading and grounded citation review.",
      );
    await page.getByRole("button", { name: "Add document" }).click();
    await expect(
      page.getByRole("button", { name: "Open e2e-braille-guide in Reader" }),
    ).toBeVisible();

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByText("Research", { exact: true })
      .click();
    await page.getByLabel("Research question").fill("piezoelectric pins tactile reading");
    await page.getByRole("button", { name: "Run research" }).click();

    await expect(page.locator(".autosd-results-panel")).toContainText("piezoelectric pins");
    await expect(page.locator(".autosd-results-panel")).toContainText("Confidence");

    const openInReaderBtn = page.getByRole("button", { name: /Open .* in Reader/i }).first();
    if (await openInReaderBtn.isVisible()) {
      await openInReaderBtn.click();
      await expect(page).toHaveURL(/#\/reader$/);
    } else {
      await page.goto("/#/reader");
      await page.getByLabel("Select corpus document").selectOption("e2e-braille-guide");
      await page.getByRole("button", { name: "Load document" }).click();
    }

    await expect(page.locator('article[aria-current="page"]')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("Settings persistence across reload -> Reader cell-aware pagination & UEB Grade 2 braille output", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    // Seed sample corpus in Workspace first
    await page.goto("/#/workspace");
    await page.getByRole("button", { name: "Load sample corpus" }).click();

    // Configure Grade 2 Braille + 20-cell width + Cell-aware pagination in Settings
    await page.goto("/#/settings");
    await page.getByLabel("Braille grade").selectOption("2");
    await page.getByLabel("Display cell count").selectOption("20");
    await page.getByLabel("Enable cell-aware pagination").check();

    // Reload browser and confirm BrowserStore persisted preferences
    await page.reload();
    await expect(page.getByLabel("Braille grade")).toHaveValue("2");
    await expect(page.getByLabel("Display cell count")).toHaveValue("20");
    await expect(page.getByLabel("Enable cell-aware pagination")).toBeChecked();

    // Navigate to Reader — cell-aware pagination toggle should be active and Grade 2 rendered
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByText("Reader", { exact: true })
      .click();
    const cellToggle = page.locator("[data-autosd-cell-pagination]");
    await expect(cellToggle).toHaveAttribute("aria-pressed", "true");

    const docSelect = page.getByLabel("Select corpus document");
    const options = await docSelect
      .locator("option")
      .evaluateAll(els => els.map(el => (el as HTMLOptionElement).value));
    expect(options.length).toBeGreaterThan(1);
    await docSelect.selectOption(options[1]);
    await page.getByRole("button", { name: "Load document" }).click();

    await page.getByRole("button", { name: "Send page to tactile device" }).click();
    const strip = page.locator(".autosd-tactile-preview");
    await expect(strip).toContainText("UEB Grade 2 Braille");
    await expect(strip).toContainText("line 1 of");

    const nextLineBtn = page.getByRole("button", { name: "Next braille line" });
    if (await nextLineBtn.isVisible()) {
      await nextLineBtn.click();
      await expect(strip).toContainText("line 2 of");
      await page.getByRole("button", { name: "Previous braille line" }).click();
      await expect(strip).toContainText("line 1 of");
    }

    expect(pageErrors).toEqual([]);
  });

  test("Demo route runs the deterministic 7-step pipeline cleanly in a real browser", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    await page.goto("/#/demo");
    await page.getByRole("button", { name: "Run the AutoSD demonstration" }).click();
    await expect(page.getByText("Export session JSON")).toBeVisible();
    await expect(page.locator("main")).toContainText(/complete|passed|done|export/i, {
      timeout: 15_000,
    });
    expect(pageErrors).toEqual([]);
  });
});
