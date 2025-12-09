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

// Scrape Sprouts search page
async function scrapeSprouts(ingredient) {
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
      await page.waitForSelector(".e-17shihj", { timeout: 5000 });
      await page.click(".e-17shihj");
      console.log("Selected");
    } catch {
      console.log("No shopping selection popup.");
    }
    await scrollToLoadAll(page);
    //Expand Item
    const productHTMLList = [];
    try {
      await page.waitForSelector("a.e-nn60uq", { timeout: 5000 });
      // Get all item elements
      const items = await page.$$("a.e-nn60uq");
      console.log(items.length);
      for (let i = 0; i < items.length; i++) {
        await items[i].click();
        await page.waitForSelector("span.e-1q8o1gj", { timeout: 5000 });
        productHTMLList.concat(
          await page.evaluate(() => document.body.innerHTML)
        );
        await page.click("button.e-10bwqtf");
        await page.waitForSelector("a.e-nn60uq", { timeout: 5000 });
      }

      console.log("Item expanded.");
    } catch {
      console.log("Item not expanded");
    }
    // Expand Item
    // try {
    //   await page.waitForSelector(".e-1q8o1gj", { timeout: 5000 });

    //   const html = await page.evaluate(() => document.body.innerHTML);
    //   console.log("HTML extracted");

    //   const $ = cheerio.load(html);

    //   let eventDomElements = $(".e-egal4z").children("li");
    //   eventDomElements = eventDomElements.slice(
    //     0,
    //     Math.min(4, eventDomElements.length)
    //   );

    //   eventDomElements.each((_, element) => {
    //     // get product name
    //     const item = $(element).find("div.e-147kl2c").text();
    //     var deal = $(element).find("div.e-13vobab").text();
    //     // get product price
    //     var priceElement = $(element).find("span.screen-reader-only").text();
    //     var price;
    //     if (priceElement.toLowerCase().includes("original")) {
    //       {
    //         priceElement = priceElement
    //           .toLowerCase()
    //           .replaceAll("original", "")
    //           .split(" ");
    //         price = priceElement[priceElement.length - 3];
    //         deal =
    //           Math.round(
    //             ((toNumber(priceElement[priceElement.length - 1]) -
    //               toNumber(price)) /
    //               toNumber(priceElement[priceElement.length - 1])) *
    //               100
    //           ).toString() +
    //           "% off [Original: " +
    //           priceElement[priceElement.length - 1] +
    //           "]";
    //       }
    //     } else {
    //       priceElement = priceElement.split(" ");
    //       price = priceElement[priceElement.length - 1];
    //     }
    //     console.log(priceElement);

    //     // get product image
    //     const image_srcset = $(element).find("img").attr("srcset") || "";
    //     const imageCandidates = image_srcset.split(",").map((c) => c.trim());
    //     const imageUrls = imageCandidates.map((c) => c.split(" ")[0]);
    //     const imageUrlsCombined = [];
    //     for (let i = 0; i < imageUrls.length; i += 2) {
    //       const combined = imageUrls[i] + "," + (imageUrls[i + 1] || "");
    //       imageUrlsCombined.push(combined);
    //     }

    //     const image = imageUrlsCombined[0];

    //     products.push({ item, price, deal, image });
    //   });

    //   //   console.log(products);
    //   console.log("products extracted:", products.length);
    // } catch (error) {
    //   console.log("Failed to find selector or parse page:", error.message);
    // } finally {
    //   await browser.close();
    // }
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

module.exports = async function (ingredient) {
  const products = await scrapeSprouts(ingredient);

  const best = products; // simple first-product selection
  await saveToFirebase(ingredient, best);
  return best;
};
