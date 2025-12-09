const scrapeSprouts = require("./scrapers/sprouts");

(async () => {
  const ingredient = process.argv[2] || "garlic";
  try {
    const result = await scrapeSprouts(ingredient);
    console.log("Best match:", result);
  } catch (err) {
    console.error(err);
  }
})();
