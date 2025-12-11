// src/index.ts
import scrapeSprouts from "./scrapers/sprouts";

const main = async () => {
  // Grab ingredient from command line arguments
  const ingredient: string = process.argv[2] || "garlic";

  try {
    const result = await scrapeSprouts(ingredient);
    console.log("Best match:", result);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(err.message);
    } else {
      console.error(err);
    }
  }
};

// Run the main function
main();
