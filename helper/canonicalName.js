/**
 * Normalize a raw product name into canonical name and extract metadata
 * @param {string} rawName - Raw scraped product name
 * @returns {Object} { canonicalName, tags, sizeValue, sizeUnit, preparation }
 */
function getCanonicalName(rawName) {
  if (!rawName)
    return {
      canonicalName: "",
      tags: [],
      sizeValue: null,
      sizeUnit: null,
      preparation: [],
    };

  let name = rawName.toLowerCase();
  const tags = [];
  const preparation = [];
  let sizeValue = null;
  let sizeUnit = null;

  // 1. Extract numeric sizes (10-inch, 9", 28 oz, 2-pack)
  const inchRegex = /(\d+(\.\d+)?)\s?(-inch|inch|")/i;
  const ozRegex = /(\d+(\.\d+)?)\s?(oz|ounce|ounces)/i;
  const packRegex = /pack of (\d+)/i;

  const inchMatch = name.match(inchRegex);
  if (inchMatch) {
    sizeValue = parseFloat(inchMatch[1]);
    sizeUnit = "inch";
    tags.push("size:" + sizeValue + sizeUnit);
    name = name.replace(inchMatch[0], "");
  }

  const ozMatch = name.match(ozRegex);
  if (ozMatch) {
    sizeValue = parseFloat(ozMatch[1]);
    sizeUnit = "oz";
    tags.push("size:" + sizeValue + sizeUnit);
    name = name.replace(ozMatch[0], "");
  }

  const packMatch = name.match(packRegex);
  if (packMatch) {
    tags.push("pack:" + packMatch[1]);
    name = name.replace(packMatch[0], "");
  }

  // 2. Remove parentheses and content inside
  name = name.replace(/\([^)]*\)/g, "");

  // 3. Extract preparation words (optional, useful for tags)
  const prepWords = [
    "diced",
    "sliced",
    "shredded",
    "minced",
    "chopped",
    "grated",
    "drained",
    "peeled",
    "crushed",
    "rinsed",
    "halved",
    "cubed",
  ];
  prepWords.forEach((word) => {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    if (regex.test(name)) {
      preparation.push(word);
      name = name.replace(regex, "");
    }
  });

  // 4. Remove comprehensive adjectives / extra descriptors
  const removeWords = [
    "sprouts",
    "real",
    "enjoy life",
    "enjoy",
    "hu",
    "guittard",
    "baking",
  ];

  const regex = new RegExp("\\b(" + removeWords.join("|") + ")\\b", "gi");
  name = name.replace(regex, "");

  // 5. Remove extra numbers and whitespace
  name = name.replace(/\d+/g, "");
  name = name.replace(/\s+/g, " ").trim();

  // 6. Keep meaningful distinctions
  const synonyms = {
    "pie shell": "pie crust",
    "pie shells": "pie crust",
    "chili pepper": "chili pepper",
    "bell pepper": "bell pepper",
    "green bell pepper": "bell pepper",
    "red bell pepper": "bell pepper",
  };
  if (synonyms[name]) name = synonyms[name];

  // Return structured object
  return {
    canonicalName: name,
    tags,
    sizeValue,
    sizeUnit,
    preparation,
  };
}

module.exports = async function (name) {
  return getCanonicalName(name);
};
