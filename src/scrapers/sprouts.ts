import puppeteer, { Page, Browser } from "puppeteer";
import * as cheerio from "cheerio";
import db from "../server/firebase";

// ----------------------- Types -----------------------

interface SizeObj {
  value: number;
  unit: string;
}

interface Product {
  item: string;
  currentPrice: string;
  quantity: string;
  pricePerQuantity: string;
  deal: string;
  tags: string[];
  image?: string;
}

interface PriceInfo {
  currentPrice: string;
  originalPrice: string;
  percentOff: string;
}

// ----------------------- Helpers -----------------------

function parseSizeUnit(sizeStr: string = ""): SizeObj | null {
  const m = sizeStr.match(/([\d,.]+)\s*(oz|lb|g|kg|ml|l|fl oz|each|ct)/i);
  if (!m) return null;
  return { value: parseFloat(m[1].replace(",", "")), unit: m[2].toLowerCase() };
}

function toPricePerOz(price: number, sizeObj: SizeObj | null): number | null {
  if (!price || !sizeObj) return null;
  const { value, unit } = sizeObj;
  switch (unit) {
    case "oz":
    case "fl oz":
      return price / value;
    case "lb":
      return price / (value * 16);
    case "g":
      return price / (value / 28.3495);
    case "kg":
      return price / ((value * 1000) / 28.3495);
    case "ml":
      return price / (value / 29.5735);
    case "l":
      return price / ((value * 1000) / 29.5735);
    case "each":
      return price;
    case "ct":
      return price / value;
    default:
      return null;
  }
}

function toNumber(dollarStr: string): number {
  return parseFloat(dollarStr.replace(/[$,]/g, ""));
}

async function scrollToLoadAll(page: Page): Promise<void> {
  let previousHeight = 0;
  let scrolls = 0;

  while (scrolls < 50) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === previousHeight) break;

    previousHeight = newHeight;
    scrolls++;
  }
}

function parsePriceInfo(raw: string): PriceInfo {
  const split1 = raw.toLowerCase().split("original price: ");

  const currentPrice = split1[0].split(": ")[1]?.split("$")[1] ?? -1;

  let originalPrice: string = "";
  let percentOff: string = "";

  if (split1[1]) {
    originalPrice = split1[1].split("$")[1] ?? -1;

    if (originalPrice !== "") {
      const leftover = split1[1].replace("$" + originalPrice.toString(), "");
      percentOff = leftover;
    }
  }

  return { currentPrice, originalPrice, percentOff };
}

async function loadMore(page: Page, level: number): Promise<void> {
  console.log("loading more " + level);
  try {
    await page.waitForSelector("span.e-1evx3ij", {
      timeout: 20000,
    });

    await page.evaluate(() => {
      const el = document.querySelector("span.e-1evx3ij");
      (el as HTMLElement | null)?.click();
    });

    await scrollToLoadAll(page);
  } catch (err) {
    console.log(err);
  }
}

function extractNumbers(str: string): number[] {
  const matches = str.match(/\d+(\.\d+)?/g);
  return matches ? matches.map(Number) : [];
}

// ----------------------- Main Scraper -----------------------

async function scrapeSprouts(
  ingredient: string,
  loadAll: boolean = false,
  topReturnN: number = 5
): Promise<Product[]> {
  const PAGE_URL = `https://shop.sprouts.com/store/sprouts/s?k=${encodeURIComponent(
    ingredient
  )}`;

  const products: Product[] = [];
  console.log(PAGE_URL);

  const browser: Browser = await puppeteer.launch({ headless: false });
  const page: Page = await browser.newPage();

  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(PAGE_URL);
  await page.browserContext().overridePermissions(PAGE_URL, []);

  // Close Cookies
  try {
    await page.waitForSelector(".trustarc-banner-close", { timeout: 5000 });
    await page.click(".trustarc-banner-close");
    console.log("Cookie popup dismissed.");
  } catch {
    console.log("No cookie popup found.");
  }

  // Switch location
  try {
    await page.waitForFunction(
      () =>
        document.querySelectorAll("button.e-w2av07[aria-haspopup='dialog']")
          .length >= 3,
      { timeout: 20000 }
    );

    const buttons = await page.$$("button.e-w2av07[aria-haspopup='dialog']");

    await buttons[buttons.length - 1].evaluate((b) => b.click());
    await page.waitForSelector("button.e-1wlht9u", { timeout: 5000 });
    await page.click("button.e-1wlht9u");

    // enter zip code
    await page.waitForSelector("input.e-t267xt");
    await page.type("input.e-t267xt", "10024", { delay: 10 });

    // select applicable location
    await page.waitForSelector("button.e-616lx5", { timeout: 5000 });
    await page.click("button.e-616lx5");

    // select applicable store
    await page.waitForSelector("button.e-17shihj", { timeout: 5000 });
    await page.click("button.e-17shihj");

    console.log("Location switched");
  } catch (err) {
    console.log("Error switching location: " + err);
  }

  // Load all items if needed
  if (loadAll) {
    await scrollToLoadAll(page);
    await loadMore(page, 0);
  }

  const productHTMLList: string[] = [];

  try {
    await page.waitForSelector("a.e-nn60uq", {
      timeout: loadAll ? 5000 : 10000,
    });

    const items = await page.$$("a.e-nn60uq");

    for (
      let i = 0;
      i < (loadAll ? items.length : Math.min(items.length, topReturnN));
      i++
    ) {
      await items[i].click();

      await page.waitForSelector("span.e-1q8o1gj");

      productHTMLList.push(await page.evaluate(() => document.body.innerHTML));

      await page.click("button.e-10bwqtf");

      await page.waitForSelector("a.e-nn60uq");
    }
  } catch (err) {
    console.log("Item expand error", err);
  }

  // Parse results
  for (const html of productHTMLList) {
    const $ = cheerio.load(html);

    const eventDomElement = $(".e-l0tco0");

    const item = eventDomElement.find("span.e-1q8o1gj").text();
    let deal = eventDomElement.find("div.e-10j5a5k").text() || "";

    // Price
    const priceElement = eventDomElement.find("span.e-ceqez7").text();
    const { currentPrice, originalPrice, percentOff } =
      parsePriceInfo(priceElement);

    if (percentOff !== "") {
      deal = `${percentOff}% [Original Price: ${originalPrice}]`;
    }

    // Quantity
    const qtyRaw = eventDomElement.find("div.e-k008qs").text();
    const [quantity, pricePerQuantity] = qtyRaw
      .split(")")[1]
      .split(" • ")
      .map((s: string) => s.trim());

    // Tags
    const tags: string[] = [];
    $("div.e-13d259n").each((_, el) => {
      const tag = $(el).find("span").text().toLowerCase();
      if (tag !== "sprouts brand" && tag !== "new") tags.push(tag);
    });

    const image = eventDomElement.find("div.ic-image-zoomer > img").attr("src");

    products.push({
      item,
      currentPrice,
      quantity,
      pricePerQuantity,
      deal,
      tags,
      image,
    });
  }

  await browser.close();
  return products;
}

// ----------------------- Firebase Store -----------------------

async function saveToFirebase(
  ingredient: string,
  best: Product[] | Product | null
): Promise<void> {
  if (!best) return;

  const ingredientKey = ingredient.toLowerCase().replace(/\s+/g, "_");
  const ref = db.collection("items").doc(ingredientKey);
  const now = Date.now();

  await ref.set({ sprouts: { ...best, lastUpdated: now } }, { merge: true });
}

// ----------------------- Exported Function -----------------------

export default async function runSproutsScraper(
  ingredient: string,
  loadMore: boolean = false
): Promise<Product[] | null> {
  const products = await scrapeSprouts(ingredient, loadMore, 5);
  await saveToFirebase(ingredient, products);
  return products;
}
