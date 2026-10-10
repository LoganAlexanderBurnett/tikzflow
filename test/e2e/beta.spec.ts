// The Beta label and the way to report a problem (D76): in the toolbar at every width, and a plain link
// to a new issue on the repository, with the problem form, that opens in a new tab and sends nothing.
import { expect, test } from "./base.ts";

test("the toolbar says Beta and links to a new issue with the problem form", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("beta-label")).toHaveText("Beta");
  const link = page.getByTestId("report-link");
  await expect(link).toHaveText("Report a problem");
  await expect(link).toHaveAttribute("href", "https://github.com/LoganAlexanderBurnett/tikzflow/issues/new?template=problem.yml");
  await expect(link).toHaveAttribute("target", "_blank");
  // No opener and no referrer to the other site.
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("both stay in view on a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 800 });
  await page.goto("/");
  for (const id of ["beta-label", "report-link"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(box!.x + box!.width, `${id} is inside the window`).toBeLessThanOrEqual(520);
  }
});
