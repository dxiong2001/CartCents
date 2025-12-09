const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const db = require("../server/firebase"); // Firebase config
const { allowedFoodCategories } = require("../config/allowedCategories");

function isAllowedCategory(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return allowedFoodCategories.some((c) => t.includes(c));
}

function parseSizeUnit(sizeStr = "") {
  const m = sizeStr.match(/([\d,.]+)\s*(oz|lb|g|kg|ml|l|fl oz|each|ct)/i);
  if (!m) return null;
  return { value: parseFloat(m[1].replace(",", "")), unit: m[2].toLowerCase() };
}

function toPricePerOz(price, sizeObj) {
  if (!price || !sizeObj) return null;
  const { value, unit } = sizeObj;
  switch (unit) {
    case "oz":
      return price / value;
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
function toNumber(dollarStr) {
  return parseFloat(dollarStr.replace(/[$,]/g, ""));
}

async function scrollToLoadAll(page) {
  let previousHeight = 0;
  let maxScrolls = 50; // safety limit
  let scrolls = 0;

  while (scrolls < maxScrolls) {
    // Scroll to bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    // Wait for 1 second
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if new content loaded
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === previousHeight) {
      break; // no more content
    }

    previousHeight = newHeight;
    scrolls++;
  }
}

function parsePriceInfo(raw) {
  const split1 = raw.toLowerCase().split("original price: ");
  const currentPrice = split1[0].split(": ")[1].split("$")[1];
  var originalPrice = split1[1];
  var percentOff;
  if (originalPrice != null) {
    originalPrice = originalPrice.split("$")[1];
    percentOff = split1[1].replaceAll("$" + originalPrice.toString(), "");
  }

  return { currentPrice, originalPrice, percentOff };
}

async function loadMore(page, level) {
  console.log("loading more " + level);
  try {
    await page.waitForSelector("span.e-1evx3ij", {
      timeout: 20000,
    });
    await page.evaluate(() => {
      document.querySelector("span.e-1evx3ij")?.click();
    });

    await scrollToLoadAll(page);
  } catch (err) {
    console.log(err);
    return;
  }
}

// Scrape Sprouts search page
async function scrapeSprouts(ingredient, loadAll = false, topReturnN = 5) {
  const PAGE_URL = `https://shop.sprouts.com/store/sprouts/s?k=${encodeURIComponent(
    ingredient
  )}`;
  const products = [];
  console.log(PAGE_URL);
  await (async () => {
    const browser = await puppeteer.launch({
      headless: false,
    });
    const page = await browser.newPage();
    await page.setViewport({
      width: 1280,
      height: 900, // adjust height here
    });
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    // Close Cookie Popup
    try {
      await page.waitForSelector(".trustarc-banner-close", { timeout: 5000 });
      await page.click(".trustarc-banner-close");
      console.log("Cookie popup dismissed.");
    } catch {
      console.log("No cookie popup found.");
    }
    // Select Location
    try {
      await page.waitForSelector("button.e-17shihj", { timeout: 5000 });

      await page.evaluate(() => {
        document.querySelector("button.e-17shihj")?.click();
      });

      console.log("Selected");
    } catch (err) {
      console.log("No shopping selection popup: " + err);
    }
    await scrollToLoadAll(page);
    console.log(loadAll);
    if (loadAll) {
      await loadMore(page, 0);
    }
    //Expand Item
    const productHTMLList = [];
    try {
      await page.waitForSelector("a.e-nn60uq", {
        timeout: loadAll ? 5000 : 10000,
      });
      // Get all item elements
      const items = await page.$$("a.e-nn60uq");
      for (
        let i = 0;
        i < (loadAll ? items.length : Math.min(items.length, topReturnN));
        i++
      ) {
        await items[i].click();
        await page.waitForSelector("span.e-1q8o1gj", {
          timeout: loadAll ? 5000 : 10000,
        });
        await productHTMLList.push(
          await page.evaluate(() => document.body.innerHTML)
        );
        await page.click("button.e-10bwqtf");
        await page.waitForSelector("a.e-nn60uq", {
          timeout: loadAll ? 5000 : 10000,
        });
      }

      console.log("Item expanded.");
    } catch (err) {
      console.log("Item not expanded: " + err);
    }

    try {
      console.log(productHTMLList.length);
      for (let i = 0; i < productHTMLList.length; i++) {
        const html = productHTMLList[i];
        const $ = cheerio.load(html);

        let eventDomElement = $(".e-l0tco0");

        // get product name
        const item = eventDomElement.find("span.e-1q8o1gj").text();
        var deal = eventDomElement.find("div.e-10j5a5k").text();
        if (deal.length == 0) {
          deal = eventDomElement.find("span.e-1nxcnt6").text();
          try {
            deal = deal.toLowerCase().includes("buy")
              ? deal.split(")")[1].slice(0, -1)
              : "";
          } catch {
            deal = "";
          }
        }

        // get product price
        const priceElement = eventDomElement.find("span.e-ceqez7").text();
        const { currentPrice, originalPrice, percentOff } =
          parsePriceInfo(priceElement);
        if (percentOff) {
          deal =
            percentOff.toString() +
            "% [Original Price: " +
            originalPrice.toString() +
            "]";
        }
        // get product quantity
        const priceQuantity = eventDomElement.find("div.e-k008qs").text();
        const priceQuantitySplit = priceQuantity.split(")")[1].split(" • ");
        console.log(priceQuantitySplit);
        const quantity = priceQuantitySplit[0];
        const pricePerQuantity = priceQuantitySplit[1];

        // get product tags
        const tags = [];
        const tagElements = $("div.e-13d259n");
        tagElements.each((_, element) => {
          const tag = $(element).find("span").text().toLowerCase();

          if (tag != "sprouts brand" && tag != "new") {
            tags.push(tag);
          }
        });

        // get product image
        const image = eventDomElement
          .find("div.ic-image-zoomer > img")
          .attr("src");

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
    } catch (error) {
      console.log("Failed to find selector or parse page:", error.message);
    } finally {
      await browser.close();
    }
  })();
  console.log(products);
}

// Save best match to Firebase
async function saveToFirebase(ingredient, best) {
  if (!best) return;

  const ingredientKey = ingredient.toLowerCase().replace(/\s+/g, "_");
  const ref = db.collection("items").doc(ingredientKey);
  const now = Date.now();

  await ref.set({ sprouts: { ...best, lastUpdated: now } }, { merge: true });
}

module.exports = async function (ingredient, loadMore = false) {
  const products = await scrapeSprouts(ingredient, loadMore, 10);

  const best = products; // simple first-product selection
  await saveToFirebase(ingredient, best);
  return best;
};
