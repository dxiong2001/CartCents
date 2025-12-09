const axios = require("axios");
const cheerio = require("cheerio");
const db = require("../server/firebase");
const { allowedFoodCategories } = require("../config/allowedCategories");

const SHOP_ID = "472984";
const ZONE_ID = "1002";
const POSTAL_CODE = "90001";
const CACHE_EXPIRE_HOURS = 48;

// parse size strings like "16 oz", "1 lb"
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

// filter only grocery/food categories
function isAllowedCategory(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return allowedFoodCategories.some((c) => t.includes(c));
}

// Step 1: scrape search page for item IDs
async function getSproutsIDs(query) {
  const url = `https://shop.sprouts.com/search?q=${encodeURIComponent(query)}`;
  const res = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const $ = cheerio.load(res.data);
  const ids = [];
  $(".product-grid__item").each((i, el) => {
    const id = $(el).attr("data-id"); // adjust if different
    if (id) ids.push(id);
  });
  return ids;
}

// Step 2: call GraphQL API with IDs
async function getItemDetails(ids) {
  if (!ids.length) return [];
  const variables = {
    ids,
    shopId: SHOP_ID,
    zoneId: ZONE_ID,
    postalCode: POSTAL_CODE,
  };
  const extensions = {
    persistedQuery: {
      version: 1,
      sha256Hash:
        "c4fb5cd2b49248736ad7f78f71466560a38275b66e05d7b67447e210c74901d4",
    },
  };
  const res = await axios.get("https://shop.sprouts.com/graphql", {
    params: {
      operationName: "Items",
      variables: JSON.stringify(variables),
      extensions: JSON.stringify(extensions),
    },
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  return res.data?.data?.items || [];
}

// Step 3: filter, normalize, and pick best match
function processCandidates(candidates, ingredient) {
  const filtered = candidates.filter((c) => isAllowedCategory(c.category));
  return filtered.map((c) => {
    const sizeObj = parseSizeUnit(c.unitSize || c.size || c.package || "");
    return {
      id: c.id,
      title: c.name,
      price: c.price,
      size: c.unitSize || c.size || c.package || null,
      normalizedPerOz: toPricePerOz(c.price, sizeObj),
      raw: c,
    };
  });
}

// Step 4: save latest and history in Firebase
async function saveToFirebase(ingredient, best) {
  const ingredientKey = ingredient.toLowerCase().replace(/\s+/g, "_");
  const ref = db.collection("items").doc(ingredientKey);
  const now = Date.now();

  await ref.set(
    {
      sprouts: {
        title: best.title,
        price: best.price,
        size: best.size,
        normalizedPerOz: best.normalizedPerOz,
        lastUpdated: now,
        productId: best.id,
      },
    },
    { merge: true }
  );

  // Price history: only append if price/size changed
  const historyRef = ref
    .collection("priceHistory")
    .orderBy("timestamp", "desc")
    .limit(1);
  const lastSnap = await historyRef.get();
  let append = true;
  if (!lastSnap.empty) {
    const lastDoc = lastSnap.docs[0].data();
    if (lastDoc.price === best.price && lastDoc.size === best.size)
      append = false;
  }
  if (append) {
    await ref.collection("priceHistory").add({
      store: "sprouts",
      price: best.price,
      size: best.size,
      normalizedPerOz: best.normalizedPerOz,
      timestamp: now,
    });
  }
}

// Master function: search -> GraphQL -> save
async function searchSprouts(ingredient) {
  // 1) scrape IDs
  const ids = await getSproutsIDs(ingredient);
  if (!ids.length) return { error: "no_results" };

  // 2) fetch details
  const rawItems = await getItemDetails(ids);
  const candidates = processCandidates(rawItems, ingredient);
  if (!candidates.length) return { error: "no_food_results" };

  // 3) pick best match (simple scoring: first item for now)
  const best = candidates[0];

  // 4) save to Firebase
  await saveToFirebase(ingredient, best);

  return best;
}

module.exports = searchSprouts;
