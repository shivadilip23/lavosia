// Comprehensive allergen dictionary and validator

interface AllergenRule {
  canonical: string;
  keywords: string[];
}

const ALLERGEN_RULES: AllergenRule[] = [
  {
    canonical: "milk",
    keywords: [
      "milk",
      "dairy",
      "cheese",
      "butter",
      "ghee",
      "yogurt",
      "yoghurt",
      "curd",
      "dahi",
      "paneer",
      "cream",
      "whey",
      "casein",
      "lactose",
      "custard",
      "buttermilk",
    ],
  },
  {
    canonical: "peanuts",
    keywords: [
      "peanut",
      "peanuts",
      "groundnut",
      "groundnuts",
      "peanut butter",
      "peanut oil",
      "arachis oil",
    ],
  },
  {
    canonical: "tree nuts",
    keywords: [
      "tree nut",
      "tree nuts",
      "almond",
      "almonds",
      "cashew",
      "cashews",
      "walnut",
      "walnuts",
      "pistachio",
      "pistachios",
      "hazelnut",
      "hazelnuts",
      "pecan",
      "pecans",
      "macadamia",
      "pine nut",
      "pine nuts",
    ],
  },
  {
    canonical: "eggs",
    keywords: [
      "egg",
      "eggs",
      "egg white",
      "egg yolk",
      "mayo",
      "mayonnaise",
      "albumin",
      "albumen",
      "meringue",
    ],
  },
  {
    canonical: "wheat",
    keywords: [
      "wheat",
      "flour",
      "maida",
      "atta",
      "gluten",
      "semolina",
      "suji",
      "sooji",
      "rava",
      "bread",
      "pasta",
      "noodles",
      "couscous",
      "spelt",
      "kamut",
    ],
  },
  {
    canonical: "soybeans",
    keywords: [
      "soy",
      "soya",
      "soybean",
      "soybeans",
      "tofu",
      "edamame",
      "tempeh",
      "soy sauce",
      "tamari",
      "miso",
      "natto",
    ],
  },
  {
    canonical: "fish",
    keywords: [
      "fish",
      "salmon",
      "tuna",
      "cod",
      "tilapia",
      "trout",
      "halibut",
      "mackerel",
      "anchovy",
      "anchovies",
      "sardine",
      "sardines",
      "fish sauce",
    ],
  },
  {
    canonical: "crustacean shellfish",
    keywords: [
      "shellfish",
      "shrimp",
      "prawn",
      "prawns",
      "crab",
      "crabs",
      "lobster",
      "lobsters",
      "crayfish",
      "crawfish",
      "krill",
      "oyster",
      "clam",
      "mussel",
      "scallop",
      "squid",
      "calamari",
      "octopus",
    ],
  },
  {
    canonical: "sesame",
    keywords: [
      "sesame",
      "sesame seeds",
      "sesame oil",
      "tahini",
      "til",
      "gingelly",
      "halva",
    ],
  },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
}

export function checkIngredientAgainstAllergens(
  ingredientText: string,
  userAllergens: string[]
): { hasAllergen: boolean; matchedAllergen?: string; matchedKeyword?: string } {
  if (!userAllergens || userAllergens.length === 0) {
    return { hasAllergen: false };
  }

  const normalizedIng = ` ${normalize(ingredientText)} `;

  for (const userAllergen of userAllergens) {
    const normUserAllergen = normalize(userAllergen);
    if (!normUserAllergen) continue;

    // Find rule corresponding to user allergen, or treat user allergen directly as keyword
    const matchingRule = ALLERGEN_RULES.find(
      (r) =>
        normalize(r.canonical).includes(normUserAllergen) ||
        normUserAllergen.includes(normalize(r.canonical)) ||
        r.keywords.some((k) => k === normUserAllergen)
    );

    const keywordsToCheck = matchingRule ? matchingRule.keywords : [normUserAllergen];

    for (const kw of keywordsToCheck) {
      const paddedKw = ` ${normalize(kw)} `;
      if (normalizedIng.includes(paddedKw) || normalizedIng.includes(normalize(kw))) {
        return {
          hasAllergen: true,
          matchedAllergen: userAllergen,
          matchedKeyword: kw,
        };
      }
    }
  }

  return { hasAllergen: false };
}

export function validateDishAllergens(
  dish: { name: string; ingredients: Array<{ name: string }> },
  userAllergens: string[]
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const ing of dish.ingredients) {
    const check = checkIngredientAgainstAllergens(ing.name, userAllergens);
    if (check.hasAllergen) {
      violations.push(
        `Dish "${dish.name}" ingredient "${ing.name}" triggers allergen "${check.matchedAllergen}" (matched "${check.matchedKeyword}")`
      );
    }
  }

  const nameCheck = checkIngredientAgainstAllergens(dish.name, userAllergens);
  if (nameCheck.hasAllergen) {
    violations.push(
      `Dish title "${dish.name}" triggers allergen "${nameCheck.matchedAllergen}"`
    );
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
