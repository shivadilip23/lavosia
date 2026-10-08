/**
 * CLEANER ALTERNATIVES DATABASE (Screen 8)
 */
(function (global) {
  const CATEGORIES = [
    { id: 'cookies', label: 'Biscuits & cookies', keywords: ['cookie', 'cookies', 'biscuit', 'biscuits', 'digestive', 'cream biscuit', 'wafer biscuit'], offTags: ['biscuits', 'cookies'] },
    { id: 'chips', label: 'Chips & savoury snacks', keywords: ['chips', 'chip', 'crisps', 'crisp', 'nachos', 'nacho', 'namkeen', 'bhujia', 'potato wafers', 'puffs', 'corn puffs', 'salted snack'], excludes: ['chocolate chip', 'choc chip', 'chip cookie'], offTags: ['chips-and-crisps', 'crisps', 'salty-snacks', 'tortilla-chips', 'extruded-snacks'] },
    { id: 'fries', label: 'Fried & frozen potato snacks', keywords: ['fries', 'french fries', 'fried chicken', 'nuggets', 'hash brown', 'hash browns', 'potato wedges'], offTags: ['french-fries', 'fried-potatoes', 'chicken-nuggets', 'hash-browns'] },
    { id: 'icecream', label: 'Ice cream & frozen desserts', keywords: ['ice cream', 'icecream', 'gelato', 'sundae', 'kulfi', 'frozen dessert'], offTags: ['ice-creams', 'frozen-desserts'] },
    { id: 'spread', label: 'Spreads', keywords: ['spread', 'peanut butter', 'hazelnut spread', 'chocolate spread', 'nut butter'], offTags: ['spreads', 'peanut-butters', 'nut-butters'] },
    { id: 'bar', label: 'Snack & protein bars', keywords: ['protein bar', 'cereal bar', 'granola bar', 'energy bar', 'snack bar', 'muesli bar', 'nutrition bar'], offTags: ['cereal-bars', 'protein-bars', 'granola-bars', 'energy-bars', 'snack-bars'] },
    { id: 'cereal', label: 'Breakfast cereals', keywords: ['cereal', 'cereals', 'cornflakes', 'corn flakes', 'muesli', 'granola', 'oats', 'flakes'], offTags: ['breakfast-cereals', 'mueslis', 'granolas', 'corn-flakes'] },
    { id: 'soda', label: 'Soft drinks', drink: true, keywords: ['soda', 'cola', 'soft drink', 'fizzy', 'fizzy drink', 'carbonated', 'lemonade'], offTags: ['sodas', 'carbonated-drinks', 'colas'] },
    { id: 'energy', label: 'Energy drinks', drink: true, keywords: ['energy drink', 'energy drinks'], offTags: ['energy-drinks'] },
    { id: 'juice', label: 'Packaged juices & fruit drinks', drink: true, keywords: ['juice', 'nectar', 'fruit drink', 'squash', 'cordial'], offTags: ['fruit-juices', 'juices', 'nectars', 'fruit-based-beverages'] },
    { id: 'candy', label: 'Candy & chocolate', keywords: ['candy', 'candies', 'gummy', 'gummies', 'toffee', 'lollipop', 'chocolate', 'chocolate bar', 'sweets', 'jelly', 'marshmallow', 'fudge'], offTags: ['candies', 'chocolates', 'confectioneries', 'gummies'] },
    { id: 'bread', label: 'Bread', keywords: ['bread', 'loaf', 'bun', 'buns', 'toast', 'sandwich bread', 'white bread', 'pav'], offTags: ['breads', 'sliced-breads'] },
    { id: 'noodles', label: 'Instant noodles & pasta', keywords: ['noodle', 'noodles', 'ramen', 'pasta', 'instant noodle', 'cup noodle'], offTags: ['instant-noodles', 'noodles', 'pastas'] },
    { id: 'pizza', label: 'Pizza', keywords: ['pizza', 'pizzas'], offTags: ['pizzas'] },
    { id: 'sauce', label: 'Ketchup & sauces', keywords: ['ketchup', 'tomato sauce', 'chilli sauce', 'bbq sauce', 'hot sauce'], offTags: ['ketchup', 'tomato-sauces'] },
    { id: 'dressing', label: 'Salad dressings & mayo', keywords: ['mayo', 'mayonnaise', 'ranch', 'dressing', 'caesar dressing', 'vinaigrette'], offTags: ['dressings', 'mayonnaises', 'sauces'] },
    { id: 'dip', label: 'Dips & spreads', keywords: ['hummus', 'guacamole', 'salsa', 'dip', 'cheese dip', 'queso'], offTags: ['dips', 'hummus', 'guacamole'] },
    { id: 'plantmilk', label: 'Plant milks & dairy', drink: true, keywords: ['milk', 'oat milk', 'almond milk', 'soy milk', 'coconut milk', 'dairy', 'flavoured milk'], offTags: ['milks', 'plant-milks', 'almond-milks', 'oat-milks'] },
    { id: 'yogurt', label: 'Yogurt & dairy desserts', keywords: ['yogurt', 'yoghurt', 'curd', 'dahi', 'fruit yogurt', 'flavoured yogurt'], offTags: ['yogurts', 'fermented-milks', 'dairy-desserts'] }
  ];

  const ALTERNATIVES = [
    { id: 'baked-chickpea-crisps', categories: ['chips'], name: 'Baked Chickpea Crisps', ingredients: 'Chickpeas, chickpea flour, olive oil, sea salt, turmeric', nutrition: { kcal: 400, protein: 16, fat: 11, satFat: 1.5, sugars: 2, salt: 1.0, fiber: 9 }, highlights: ['Baked instead of fried'] },
    { id: 'roasted-makhana', categories: ['chips'], name: 'Roasted Makhana with Sea Salt', ingredients: 'Makhana, ghee, sea salt, black pepper', nutrition: { kcal: 370, protein: 9, fat: 5, satFat: 3, sugars: 0.5, salt: 0.8, fiber: 8 }, highlights: ['Puffed whole-food base, no frying'] },
    { id: 'air-popped-popcorn', categories: ['chips'], name: 'Air-Popped Popcorn with Sea Salt', ingredients: 'Popcorn kernels, sunflower oil, sea salt', nutrition: { kcal: 380, protein: 11, fat: 5, satFat: 0.6, sugars: 0.5, salt: 1.0, fiber: 13 }, highlights: ['Whole grain snack popped with hot air'] },

    { id: 'air-fried-potato-wedges', categories: ['fries'], name: 'Air-Fried Herb Potato Wedges', ingredients: 'Potato, olive oil, sea salt, herbs', nutrition: { kcal: 130, protein: 2.5, fat: 4, satFat: 0.6, sugars: 1, salt: 0.6, fiber: 3 }, highlights: ['Air-frying uses a fraction of the oil'] },
    { id: 'baked-sweet-potato-wedges', categories: ['fries'], name: 'Baked Sweet Potato Wedges', ingredients: 'Sweet potato, rice bran oil, sea salt, black pepper', nutrition: { kcal: 120, protein: 2, fat: 3, satFat: 0.5, sugars: 5, salt: 0.5, fiber: 3.5 }, highlights: ['Skin-on wedges keep more fiber'] },

    { id: 'ragi-jaggery-cookies', categories: ['cookies'], name: 'Ragi & Jaggery Cookies', ingredients: 'Ragi flour, whole wheat flour, jaggery, ghee, baking soda', nutrition: { kcal: 430, protein: 7, fat: 17, satFat: 9, sugars: 22, salt: 0.4, fiber: 6 }, highlights: ['Whole-grain millet instead of refined flour'] },
    { id: 'oat-whole-wheat-biscuits', categories: ['cookies'], name: 'Oat & Whole Wheat Biscuits', ingredients: 'Whole wheat flour, oats, jaggery, butter, baking soda', nutrition: { kcal: 440, protein: 8, fat: 16, satFat: 9, sugars: 18, salt: 0.5, fiber: 7 } },
    { id: 'oat-almond-bites', categories: ['cookies', 'bar'], name: 'Oat & Almond Butter Energy Bites', ingredients: 'Oats, almond butter, dates, honey', nutrition: { kcal: 400, protein: 11, fat: 18, satFat: 2.5, sugars: 22, salt: 0.05, fiber: 8 }, highlights: ['No baking, no refined flour or shortening'] },

    { id: 'frozen-yogurt-bark', categories: ['icecream'], name: 'Frozen Greek Yogurt Bark', ingredients: 'Greek yogurt, berries, honey', nutrition: { kcal: 110, protein: 8, fat: 2, satFat: 1.2, sugars: 11, salt: 0.1, fiber: 0.8 }, highlights: ['Live cultures and protein from yogurt'] },
    { id: 'banana-nice-cream', categories: ['icecream'], name: 'Frozen Banana & Cocoa Nice Cream', ingredients: 'Banana, cocoa powder', nutrition: { kcal: 100, protein: 1.3, fat: 0.5, satFat: 0.2, sugars: 14, salt: 0.02, fiber: 2.5 }, highlights: ['Just two ingredients, no dairy fat'] },

    { id: 'natural-peanut-butter', categories: ['spread'], name: 'Natural Peanut Butter', ingredients: 'Roasted peanuts, salt', nutrition: { kcal: 600, protein: 25, fat: 50, satFat: 9, sugars: 5, salt: 0.5, fiber: 7 }, highlights: ['Only peanuts and salt'] },
    { id: 'almond-cocoa-date-spread', categories: ['spread'], name: 'Almond & Cocoa Spread Sweetened with Dates', ingredients: 'Almonds, dates, cocoa powder, sea salt', nutrition: { kcal: 520, protein: 12, fat: 34, satFat: 3, sugars: 24, salt: 0.1, fiber: 9 } },

    { id: 'date-nut-bar', categories: ['bar'], name: 'Date & Nut Bar', ingredients: 'Dates, almonds, cashews', nutrition: { kcal: 420, protein: 9, fat: 20, satFat: 2.5, sugars: 40, salt: 0.03, fiber: 8 }, highlights: ['Three whole-food ingredients'] },
    { id: 'oat-seed-jaggery-bar', categories: ['bar'], name: 'Oat & Seed Bar with Jaggery', ingredients: 'Rolled oats, seeds, jaggery, almonds, ghee', nutrition: { kcal: 450, protein: 10, fat: 20, satFat: 5, sugars: 24, salt: 0.2, fiber: 7 } },

    { id: 'rolled-oats-raisins', categories: ['cereal'], name: 'Plain Rolled Oats with Raisins', ingredients: 'Rolled oats, raisins', nutrition: { kcal: 370, protein: 12, fat: 7, satFat: 1.3, sugars: 5, salt: 0.02, fiber: 9 }, highlights: ['Sweetness comes only from the fruit'] },
    { id: 'unsweetened-muesli', categories: ['cereal'], name: 'Unsweetened Muesli with Nuts & Seeds', ingredients: 'Rolled oats, almonds, seeds, raisins', nutrition: { kcal: 390, protein: 11, fat: 12, satFat: 1.5, sugars: 12, salt: 0.05, fiber: 9 } },

    { id: 'sparkling-citrus-water', categories: ['soda'], name: 'Sparkling Water with Fresh Citrus', ingredients: 'Sparkling water, lemon juice', nutrition: { kcal: 3, protein: 0, fat: 0, satFat: 0, sugars: 0.3, salt: 0.01, fiber: 0 }, highlights: ['Still gives you the fizz'] },
    { id: 'iced-green-tea', categories: ['soda', 'energy'], name: 'Unsweetened Iced Green Tea with Lemon', ingredients: 'Water, green tea, lemon juice', nutrition: { kcal: 2, protein: 0, fat: 0, satFat: 0, sugars: 0.1, salt: 0.01, fiber: 0 }, highlights: ['Gentler caffeine from tea'] },
    { id: 'coconut-water', categories: ['soda', 'juice', 'energy'], name: 'Tender Coconut Water', ingredients: 'Coconut water', nutrition: { kcal: 19, protein: 0.7, fat: 0.2, satFat: 0.2, sugars: 3.7, salt: 0.07, fiber: 1 }, highlights: ['Natural electrolytes, nothing added'] },

    { id: 'cold-brew-coffee', categories: ['energy'], name: 'Unsweetened Cold Brew Coffee', ingredients: 'Water, cold brew coffee', nutrition: { kcal: 2, protein: 0.1, fat: 0, satFat: 0, sugars: 0, salt: 0.01, fiber: 0 }, highlights: ['Caffeine without sugar or additive blends'] },
    { id: 'green-tea-honey', categories: ['energy'], name: 'Green Tea with Lemon and a Little Honey', ingredients: 'Water, green tea, lemon juice, honey', nutrition: { kcal: 12, protein: 0, fat: 0, satFat: 0, sugars: 2.8, salt: 0.01, fiber: 0 } },

    { id: 'infused-fruit-water', categories: ['juice'], name: 'Fruit-Infused Water', ingredients: 'Water, fresh fruit, lemon juice', nutrition: { kcal: 5, protein: 0, fat: 0, satFat: 0, sugars: 1, salt: 0.01, fiber: 0.2 }, highlights: ['Flavour from fruit, no concentrate or syrup'] },
    { id: 'pressed-juice', categories: ['juice'], name: 'Cold-Pressed Juice, No Added Sugar', ingredients: 'Orange juice', nutrition: { kcal: 45, protein: 0.7, fat: 0.2, satFat: 0.2, sugars: 9, salt: 0.01, fiber: 0.2 }, highlights: ['Single ingredient, nothing added'] },

    { id: 'dark-chocolate-almond', categories: ['candy'], name: 'Dark Chocolate & Almond Squares', ingredients: 'Cocoa mass, almonds, coconut sugar, cocoa butter', nutrition: { kcal: 540, protein: 8, fat: 38, satFat: 18, sugars: 20, salt: 0.02, fiber: 9 }, highlights: ['Dark chocolate brings cocoa antioxidants'] },
    { id: 'date-nut-bites', categories: ['candy'], name: 'Date & Nut Energy Bites', ingredients: 'Dates, almonds, cashews, cocoa powder', nutrition: { kcal: 380, protein: 8, fat: 16, satFat: 2.5, sugars: 42, salt: 0.05, fiber: 8 } },
    { id: 'nut-raisin-mix', categories: ['candy'], name: 'Roasted Nut & Raisin Mix', ingredients: 'Almonds, cashews, raisins', nutrition: { kcal: 500, protein: 14, fat: 30, satFat: 4, sugars: 22, salt: 0.05, fiber: 7 } },

    { id: 'sprouted-whole-grain-bread', categories: ['bread'], name: 'Sprouted Whole Grain Bread', ingredients: 'Sprouted whole grain, water, yeast, sea salt', nutrition: { kcal: 250, protein: 11, fat: 2, satFat: 0.4, sugars: 3, salt: 1.0, fiber: 8 } },
    { id: 'whole-wheat-bread', categories: ['bread'], name: '100% Whole Wheat Bread', ingredients: 'Whole wheat flour, water, yeast, salt', nutrition: { kcal: 250, protein: 12, fat: 3, satFat: 0.7, sugars: 4, salt: 1.1, fiber: 7 } },
    { id: 'ragi-multigrain-bread', categories: ['bread'], name: 'Ragi & Multigrain Bread', ingredients: 'Whole wheat flour, ragi flour, seeds, water, yeast, salt', nutrition: { kcal: 245, protein: 10, fat: 4, satFat: 0.8, sugars: 3, salt: 1.0, fiber: 8 } },

    { id: 'whole-wheat-noodles', categories: ['noodles'], name: 'Whole Wheat Noodles with Real Spices', ingredients: 'Whole wheat flour, vegetables, spices, salt', nutrition: { kcal: 350, protein: 12, fat: 3, satFat: 0.6, sugars: 2, salt: 1.2, fiber: 8 }, highlights: ['Seasoned with real spices, not a flavour packet'] },
    { id: 'millet-noodles', categories: ['noodles'], name: 'Millet Noodles', ingredients: 'Millet flour, whole wheat flour, spices, salt', nutrition: { kcal: 340, protein: 10, fat: 3, satFat: 0.5, sugars: 1.5, salt: 1.1, fiber: 9 } },

    { id: 'whole-wheat-veggie-pizza', categories: ['pizza'], name: 'Whole Wheat Veggie Pizza with Real Cheese', ingredients: 'Whole wheat flour, tomato, mozzarella cheese, vegetables, olive oil, yeast, salt', nutrition: { kcal: 230, protein: 11, fat: 8, satFat: 3.5, sugars: 3, salt: 1.0, fiber: 4 } },
    { id: 'cauliflower-crust-pizza', categories: ['pizza'], name: 'Cauliflower Crust Veggie Pizza', ingredients: 'Cauliflower, rice flour, mozzarella cheese, tomato, vegetables, olive oil, salt', nutrition: { kcal: 200, protein: 9, fat: 8, satFat: 3.4, sugars: 3, salt: 0.9, fiber: 3 }, highlights: ['Vegetable-based crust'] },

    { id: 'no-sugar-tomato-ketchup', categories: ['sauce'], name: 'Tomato Ketchup with No Added Refined Sugar', ingredients: 'Tomato puree, vinegar, dates, salt, spices', nutrition: { kcal: 60, protein: 1.5, fat: 0.3, satFat: 0, sugars: 11, salt: 1.1, fiber: 1.5 } },
    { id: 'tomato-onion-chutney', categories: ['sauce'], name: 'Fresh Tomato & Onion Chutney', ingredients: 'Tomato, onion, garlic, rice bran oil, salt, spices', nutrition: { kcal: 70, protein: 1.5, fat: 3, satFat: 0.4, sugars: 6, salt: 1.0, fiber: 2 } },

    { id: 'greek-yogurt-herb-dressing', categories: ['dressing'], name: 'Greek Yogurt Herb & Garlic Dressing', ingredients: 'Greek yogurt, olive oil, lemon juice, garlic, herbs, salt', nutrition: { kcal: 85, protein: 4, fat: 6, satFat: 1.2, sugars: 2, salt: 0.5, fiber: 0.3 }, highlights: ['High protein base, no soybean or canola oil'] },
    { id: 'olive-oil-vinaigrette', categories: ['dressing'], name: 'Extra Virgin Olive Oil & Lemon Vinaigrette', ingredients: 'Extra virgin olive oil, lemon juice, mustard, sea salt, black pepper', nutrition: { kcal: 120, protein: 0.2, fat: 13, satFat: 1.8, sugars: 0.5, salt: 0.4, fiber: 0 }, highlights: ['Heart-healthy polyphenol-rich olive oil'] },

    { id: 'fresh-guacamole', categories: ['dip'], name: 'Fresh Avocado Guacamole', ingredients: 'Avocado, lime juice, tomato, onion, coriander, sea salt', nutrition: { kcal: 150, protein: 2, fat: 14, satFat: 2.1, sugars: 1, salt: 0.4, fiber: 6 }, highlights: ['Whole avocado fats and dietary fiber'] },
    { id: 'classic-chickpea-hummus', categories: ['dip'], name: 'Authentic Olive Oil Chickpea Hummus', ingredients: 'Chickpeas, tahini, olive oil, lemon juice, garlic, sea salt', nutrition: { kcal: 165, protein: 6, fat: 9, satFat: 1.3, sugars: 0.8, salt: 0.6, fiber: 5 }, highlights: ['Rich in plant protein and sesame tahini'] },

    { id: 'unsweetened-almond-milk', categories: ['plantmilk'], name: 'Unsweetened Whole Almond Milk', ingredients: 'Water, almonds, sea salt', nutrition: { kcal: 25, protein: 1.2, fat: 2.5, satFat: 0.2, sugars: 0.1, salt: 0.1, fiber: 1.0 }, highlights: ['Zero gums, carrageenan or added sugar'] },
    { id: 'unsweetened-oat-milk', categories: ['plantmilk'], name: 'Unsweetened Organic Oat Milk', ingredients: 'Water, organic whole oats, sea salt', nutrition: { kcal: 45, protein: 1.5, fat: 1.0, satFat: 0.2, sugars: 3.5, salt: 0.1, fiber: 1.5 }, highlights: ['Naturally creamy without seed oils'] },

    { id: 'plain-greek-yogurt-fruit', categories: ['yogurt'], name: 'Plain Greek Yogurt with Fresh Fruit', ingredients: 'Greek yogurt, fruit', nutrition: { kcal: 80, protein: 8, fat: 2, satFat: 1.2, sugars: 6, salt: 0.1, fiber: 0.5 }, highlights: ['Fruit supplies the sweetness'] },
    { id: 'plain-curd-honey', categories: ['yogurt'], name: 'Plain Curd with a Little Honey', ingredients: 'Curd, honey', nutrition: { kcal: 90, protein: 4, fat: 3, satFat: 2, sugars: 9, salt: 0.1, fiber: 0 } }
  ];

  global.AlternativesDatabase = { categories: CATEGORIES, alternatives: ALTERNATIVES };
})(window);
