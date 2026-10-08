/**
 * INGREDIENT KNOWLEDGE BASE
 * -----------------------------------------------------------------------------
 * Structured knowledge base of food ingredients, whole foods, additives,
 * emulsifiers, preservatives, acidity regulators, and allergens.
 *
 * Each record contains:
 * - name: Display name
 * - synonyms: Comprehensive normalized search keys (including INS/E numbers)
 * - category: Functional or nutritional grouping
 * - is_additive: boolean
 * - effect: 'positive' | 'negative' | 'neutral'
 * - severity: 0 (benign) to 3 (critical concern)
 * - allergen?: Allergen group (if applicable)
 * - note: Nutritional clinical explanation for score synthesis
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const INGREDIENT_DATABASE = [
    // --- WHOLE FOODS & GRAINS ---
    { name: 'Potato', synonyms: ['potato', 'potatoes', 'dehydrated potato', 'potato flakes', 'sweet potato', 'sweet potatoes'], category: 'vegetable', is_additive: false, effect: 'positive', severity: 0, note: 'A whole-food base ingredient rather than a processed filler.' },
    { name: 'Whole Wheat Flour', synonyms: ['whole wheat flour', 'wholemeal flour', 'whole grain wheat flour', 'atta', 'whole wheat atta', 'whole wheat', 'wholemeal', 'wholemeal wheat flour', 'stone ground whole wheat flour'], category: 'whole_grain', is_additive: false, effect: 'positive', severity: 0, allergen: 'Wheat (Gluten)', note: 'Whole grain retains dietary fiber, minerals, and B-vitamins.' },
    { name: 'Oats', synonyms: ['oats', 'oatmeal', 'rolled oats', 'whole oats', 'oat flour'], category: 'fiber', is_additive: false, effect: 'positive', severity: 0, note: 'Rich in beta-glucan soluble fiber that supports healthy cholesterol.' },
    { name: 'Brown Rice', synonyms: ['brown rice', 'whole grain rice'], category: 'whole_grain', is_additive: false, effect: 'positive', severity: 0, note: 'Whole grain with more natural fiber and magnesium than refined white rice.' },
    { name: 'Refined Wheat Flour', synonyms: ['refined wheat flour', 'maida', 'white flour', 'all purpose flour', 'wheat flour', 'enriched wheat flour', 'bleached wheat flour', 'unbleached flour', 'flour'], category: 'refined_grain', is_additive: false, effect: 'negative', severity: 1, allergen: 'Wheat (Gluten)', note: 'Refined grain stripped of natural bran and germ fiber during milling.' },
    { name: 'Rice', synonyms: ['rice', 'white rice', 'rice flour', 'rice flakes', 'poha'], category: 'grain', is_additive: false, effect: 'neutral', severity: 0, note: 'Starchy grain base, easily digestible.' },
    { name: 'Corn / Maize', synonyms: ['corn', 'maize', 'corn flour', 'corn meal', 'corn grits', 'popcorn'], category: 'grain', is_additive: false, effect: 'neutral', severity: 0, note: 'Cereal grain providing carbohydrates.' },

    // --- STARCHES & TEXTURIZERS ---
    { name: 'Corn Starch', synonyms: ['corn starch', 'cornstarch', 'maize starch', 'starch', 'edible starch'], category: 'starch', is_additive: false, effect: 'neutral', severity: 0, note: 'Purified carbohydrate starch used for thickening.' },
    { name: 'Modified Starch', synonyms: ['modified starch', 'modified food starch', 'modified corn starch', 'ins 1422', 'e1422', 'ins 1401', 'e1401', 'ins 1412', 'e1412', 'ins 1442', 'e1442'], category: 'starch', is_additive: true, effect: 'neutral', severity: 1, note: 'Chemically or enzymatically altered starch for shelf stability.' },
    { name: 'Tapioca Starch', synonyms: ['tapioca starch', 'tapioca flour', 'cassava starch'], category: 'starch', is_additive: false, effect: 'neutral', severity: 0, note: 'Gluten-free root starch commonly used as a binder.' },
    { name: 'Maltodextrin', synonyms: ['maltodextrin', 'ins 1400', 'e1400', 'dextrin'], category: 'processed_carb', is_additive: true, effect: 'negative', severity: 1, note: 'Rapidly digested high-glycemic polysaccharide powder.' },

    // --- OILS & FATS ---
    { name: 'Palm Oil (Palmolein)', synonyms: ['palmolein', 'palm oil', 'edible vegetable oil (palmolein)', 'vegetable oil (palmolein)', 'refined palmolein', 'palm kernel oil', 'refined palm oil', 'palm fat', 'palm stearin', 'fractionated palm oil', 'edible vegetable oil (palm)', 'vegetable fat (palm)'], category: 'oil_fat', is_additive: false, effect: 'negative', severity: 1, note: 'High in saturated palmitic fatty acids; common commercial frying fat.' },
    { name: 'Vegetable Oil', synonyms: ['vegetable oil', 'edible vegetable oil', 'edible oil', 'refined vegetable oil', 'blended vegetable oil'], category: 'oil_fat', is_additive: false, effect: 'neutral', severity: 1, note: 'Generic refined vegetable oil; fatty acid profile depends on source.' },
    { name: 'Olive Oil', synonyms: ['olive oil', 'extra virgin olive oil', 'virgin olive oil'], category: 'oil_fat', is_additive: false, effect: 'positive', severity: 0, note: 'Rich in monounsaturated oleic acid and natural polyphenols.' },
    { name: 'Sunflower Oil', synonyms: ['sunflower oil', 'refined sunflower oil', 'high oleic sunflower oil'], category: 'oil_fat', is_additive: false, effect: 'neutral', severity: 0, note: 'Unsaturated seed oil, widely used in packaged foods.' },
    { name: 'Canola Oil', synonyms: ['canola oil', 'rapeseed oil', 'low erucic acid rapeseed oil'], category: 'oil_fat', is_additive: false, effect: 'neutral', severity: 0, note: 'Lower in saturated fat; contains monounsaturated and omega-3 fats.' },
    { name: 'Soybean Oil', synonyms: ['soybean oil', 'soya oil', 'refined soy oil'], category: 'oil_fat', is_additive: false, effect: 'neutral', severity: 0, allergen: 'Soy', note: 'Common polyunsaturated vegetable oil derived from soybeans.' },
    { name: 'Rice Bran Oil', synonyms: ['rice bran oil', 'physically refined rice bran oil'], category: 'oil_fat', is_additive: false, effect: 'neutral', severity: 0, note: 'High smoke-point oil containing antioxidant oryzanol.' },
    { name: 'Coconut Oil', synonyms: ['coconut oil', 'virgin coconut oil'], category: 'oil_fat', is_additive: false, effect: 'neutral', severity: 1, note: 'High in saturated medium-chain fatty acids (lauric acid).' },
    { name: 'Hydrogenated Vegetable Oil', synonyms: ['hydrogenated vegetable oil', 'hydrogenated oil', 'partially hydrogenated oil', 'partially hydrogenated vegetable oil', 'vanaspati', 'shortening', 'margarine'], category: 'trans_fat', is_additive: true, effect: 'negative', severity: 3, note: 'Industrial hydrogenation creates trans-fatty acids linked to cardiovascular risk.' },
    { name: 'Butter', synonyms: ['butter', 'dairy butter', 'butter fat', 'ghee', 'clarified butter'], category: 'dairy_fat', is_additive: false, effect: 'neutral', severity: 1, allergen: 'Milk', note: 'Traditional dairy fat, rich in saturated fat.' },
    { name: 'Cocoa Butter', synonyms: ['cocoa butter', 'cacao butter'], category: 'oil_fat', is_additive: false, effect: 'neutral', severity: 0, note: 'Natural plant fat extracted from cocoa beans.' },

    // --- SUGARS & SWEETENERS ---
    { name: 'Sugar', synonyms: ['sugar', 'sucrose', 'cane sugar', 'refined sugar', 'brown sugar', 'icing sugar', 'powdered sugar', 'castor sugar', 'caster sugar', 'raw sugar', 'invert sugar', 'invert sugar syrup', 'sugar syrup', 'liquid sugar'], category: 'added_sugar', is_additive: false, effect: 'negative', severity: 1, note: 'Concentrated added sucrose; elevates caloric density without micronutrients.' },
    { name: 'High-Fructose Corn Syrup', synonyms: ['high fructose corn syrup', 'hfcs', 'corn syrup', 'glucose-fructose syrup', 'glucose syrup', 'liquid glucose'], category: 'added_sugar', is_additive: true, effect: 'negative', severity: 2, note: 'Rapidly absorbed concentrated liquid fructose-glucose formulation.' },
    { name: 'Dextrose', synonyms: ['dextrose', 'dextrose monohydrate', 'glucose', 'corn sugar'], category: 'added_sugar', is_additive: false, effect: 'negative', severity: 1, note: 'Pure d-glucose with a very high glycemic index.' },
    { name: 'Honey', synonyms: ['honey', 'pure honey', 'raw honey'], category: 'sweetener', is_additive: false, effect: 'neutral', severity: 1, note: 'Natural sweetener containing fructose, glucose, and trace enzymes.' },
    { name: 'Aspartame', synonyms: ['aspartame', 'ins 951', 'e951', 'ins951'], category: 'sweetener', is_additive: true, effect: 'neutral', severity: 1, note: 'Synthetic non-nutritive dipeptide sweetener.' },
    { name: 'Sucralose', synonyms: ['sucralose', 'ins 955', 'e955', 'ins955'], category: 'sweetener', is_additive: true, effect: 'neutral', severity: 1, note: 'Zero-calorie chlorinated sucrose derivative.' },
    { name: 'Saccharin', synonyms: ['saccharin', 'ins 954', 'e954', 'ins954'], category: 'sweetener', is_additive: true, effect: 'neutral', severity: 1, note: 'High-intensity artificial sweetener.' },
    { name: 'Acesulfame Potassium', synonyms: ['acesulfame potassium', 'acesulfame k', 'ace-k', 'ins 950', 'e950', 'ins950'], category: 'sweetener', is_additive: true, effect: 'neutral', severity: 1, note: 'Heat-stable calorie-free synthetic sweetener.' },
    { name: 'Steviol Glycosides', synonyms: ['stevia', 'steviol glycosides', 'reb a', 'ins 960', 'e960', 'ins960'], category: 'sweetener', is_additive: true, effect: 'positive', severity: 0, note: 'Plant-derived zero-calorie sweetener from Stevia rebaudiana.' },
    { name: 'Sugar Alcohols (Polyols)', synonyms: ['sorbitol', 'ins 420', 'e420', 'maltitol', 'ins 965', 'e965', 'xylitol', 'ins 967', 'e967', 'erythritol', 'ins 968', 'e968', 'isomalt', 'ins 953'], category: 'sweetener', is_additive: true, effect: 'neutral', severity: 1, note: 'Low-calorie sugar alcohol; excessive consumption may cause laxative effects.' },

    // --- SALT / SODIUM ---
    { name: 'Salt', synonyms: ['salt', 'edible common salt', 'sodium chloride', 'iodized salt', 'iodised salt', 'sea salt', 'rock salt', 'black salt', 'pink salt', 'himalayan salt', 'himalayan pink salt', 'sendha namak', 'kala namak', 'table salt'], category: 'sodium', is_additive: false, effect: 'negative', severity: 1, note: 'Primary source of dietary sodium; excessive intake impacts blood pressure.' },

    // --- FLAVOUR ENHANCERS ---
    { name: 'Monosodium Glutamate', synonyms: ['msg', 'monosodium glutamate', 'ins 621', 'e621', 'ins621', 'flavour enhancer (ins 621)', 'flavor enhancer 621', 'flavour enhancer (621)', 'flavour enhancer 621'], category: 'flavour_enhancer', is_additive: true, effect: 'negative', severity: 1, note: 'Glutamate-based savory umami booster indicating a processed formulation.' },
    { name: 'Disodium Inosinate', synonyms: ['disodium inosinate', 'ins 631', 'e631', 'ins631', 'flavour enhancer (ins 631)', 'flavour enhancer (631)'], category: 'flavour_enhancer', is_additive: true, effect: 'negative', severity: 1, note: 'Inosinate purine ester paired with MSG for savory synergy.' },
    { name: 'Disodium Guanylate', synonyms: ['disodium guanylate', 'ins 627', 'e627', 'ins627', 'flavour enhancer (ins 627)', 'flavour enhancer (627)'], category: 'flavour_enhancer', is_additive: true, effect: 'negative', severity: 1, note: 'Nucleotide flavor enhancer used to amplify savory intensity.' },
    { name: 'Yeast Extract', synonyms: ['yeast extract', 'autolyzed yeast extract', 'hydrolyzed yeast'], category: 'flavour_enhancer', is_additive: false, effect: 'neutral', severity: 0, note: 'Natural source of free glutamates providing savory umami notes.' },

    // --- ARTIFICIAL & NATURAL COLOURS ---
    { name: 'Tartrazine', synonyms: ['tartrazine', 'ins 102', 'e102', 'ins102', 'yellow 5', 'colour (ins 102)', 'colour (102)'], category: 'artificial_colour', is_additive: true, effect: 'negative', severity: 2, note: 'Synthetic azo yellow dye linked in clinical trials to pediatric hyperactivity.' },
    { name: 'Sunset Yellow', synonyms: ['sunset yellow', 'sunset yellow fcf', 'ins 110', 'e110', 'ins110', 'yellow 6', 'colour (ins 110)', 'colour (110)'], category: 'artificial_colour', is_additive: true, effect: 'negative', severity: 2, note: 'Synthetic petroleum-derived orange-yellow food coloring.' },
    { name: 'Allura Red', synonyms: ['allura red', 'ins 129', 'e129', 'ins129', 'red 40', 'colour (ins 129)', 'colour (129)'], category: 'artificial_colour', is_additive: true, effect: 'negative', severity: 2, note: 'Synthetic red dye used cosmetically in ultra-processed snacks.' },
    { name: 'Brilliant Blue', synonyms: ['brilliant blue', 'brilliant blue fcf', 'ins 133', 'e133', 'ins133', 'blue 1'], category: 'artificial_colour', is_additive: true, effect: 'negative', severity: 2, note: 'Synthetic triarylmethane blue colorant.' },
    { name: 'Caramel Colour', synonyms: ['caramel colour', 'caramel color', 'caramel', 'ins 150', 'e150', 'ins 150a', 'ins 150c', 'ins 150d', 'e150d', 'ins150d', 'colour (150d)', 'colour (ins 150d)'], category: 'colour', is_additive: true, effect: 'negative', severity: 1, note: 'Class III/IV ammonia-sulfite caramel color contains 4-MEI processing byproducts.' },
    { name: 'Titanium Dioxide', synonyms: ['titanium dioxide', 'ins 171', 'e171', 'ins171'], category: 'artificial_colour', is_additive: true, effect: 'negative', severity: 2, note: 'Inorganic whitening pigment; banned in the European Union due to genotoxicity concerns.' },
    { name: 'Natural Food Colour', synonyms: ['curcumin', 'ins 100', 'e100', 'paprika oleoresin', 'paprika extract', 'ins 160c', 'e160c', 'beta-carotene', 'ins 160a', 'e160a', 'annatto', 'ins 160b', 'beetroot red', 'ins 162'], category: 'colour', is_additive: true, effect: 'positive', severity: 0, note: 'Plant-derived botanical pigment with natural antioxidant properties.' },

    // --- PRESERVATIVES ---
    { name: 'Sodium Benzoate', synonyms: ['sodium benzoate', 'ins 211', 'e211', 'ins211', 'preservative (ins 211)', 'preservative (211)'], category: 'preservative', is_additive: true, effect: 'negative', severity: 2, note: 'Aromatic preservative; can react with ascorbic acid (vitamin C) to form benzene.' },
    { name: 'Potassium Sorbate', synonyms: ['potassium sorbate', 'ins 202', 'e202', 'ins202', 'sorbic acid', 'ins 200', 'preservative (ins 202)', 'preservative (202)'], category: 'preservative', is_additive: true, effect: 'negative', severity: 1, note: 'Widely used antifungal preservative considered moderate risk.' },
    { name: 'Sulphur Dioxide / Sulphites', synonyms: ['sulphur dioxide', 'sulfur dioxide', 'ins 220', 'e220', 'ins220', 'sulphites', 'sulfites', 'sodium metabisulphite', 'ins 223', 'e223', 'ins223'], category: 'preservative', is_additive: true, effect: 'negative', severity: 2, allergen: 'Sulphites', note: 'Preservative and antioxidant known to provoke severe asthma reactions.' },
    { name: 'Calcium Propionate', synonyms: ['calcium propionate', 'ins 282', 'e282', 'ins282', 'sodium propionate', 'ins 281'], category: 'preservative', is_additive: true, effect: 'negative', severity: 1, note: 'Anti-mold preservative commonly baked into commercial breads.' },
    { name: 'Sodium Nitrite / Nitrate', synonyms: ['sodium nitrite', 'ins 250', 'e250', 'sodium nitrate', 'ins 251', 'e251'], category: 'preservative', is_additive: true, effect: 'negative', severity: 3, note: 'Curing agent that can form carcinogenic nitrosamines at high cooking heat.' },

    // --- ANTIOXIDANTS ---
    { name: 'TBHQ (Tertiary Butylhydroquinone)', synonyms: ['tbhq', 'ins 319', 'e319', 'ins319', 'antioxidant (ins 319)', 'antioxidant (319)'], category: 'antioxidant', is_additive: true, effect: 'negative', severity: 2, note: 'Synthetic phenolic antioxidant used to prevent rancidity in vegetable frying oils.' },
    { name: 'BHA / BHT', synonyms: ['bha', 'ins 320', 'e320', 'ins320', 'bht', 'ins 321', 'e321', 'ins321'], category: 'antioxidant', is_additive: true, effect: 'negative', severity: 2, note: 'Synthetic preservative antioxidants under scrutiny for endocrine disruption.' },
    { name: 'Ascorbic Acid (Vitamin C)', synonyms: ['ascorbic acid', 'vitamin c', 'ins 300', 'e300', 'ins300', 'sodium ascorbate', 'ins 301', 'e301'], category: 'antioxidant', is_additive: true, effect: 'positive', severity: 0, note: 'Nutritive antioxidant and dough conditioner.' },
    { name: 'Tocopherols (Vitamin E)', synonyms: ['tocopherols', 'vitamin e', 'mixed tocopherols', 'ins 307', 'e307', 'ins307'], category: 'antioxidant', is_additive: true, effect: 'positive', severity: 0, note: 'Natural lipid antioxidant that shields polyunsaturated fats from oxidation.' },

    // --- EMULSIFIERS, GUMS & STABILIZERS ---
    { name: 'Soy Lecithin', synonyms: ['soy lecithin', 'lecithin', 'ins 322', 'e322', 'ins322', 'ins 322(i)', 'e322(i)', 'emulsifier (ins 322)', 'emulsifier (322)'], category: 'emulsifier', is_additive: true, effect: 'neutral', severity: 1, allergen: 'Soy', note: 'Phospholipid emulsifier that blends fat and water phases.' },
    { name: 'Mono- and Diglycerides', synonyms: ['mono- and diglycerides of fatty acids', 'mono and diglycerides', 'ins 471', 'e471', 'ins471', 'emulsifier (ins 471)', 'emulsifier (471)'], category: 'emulsifier', is_additive: true, effect: 'negative', severity: 1, note: 'Glyceride emulsifier commonly made from hydrogenated fats.' },
    { name: 'Polysorbate 80', synonyms: ['polysorbate 80', 'ins 433', 'e433', 'ins433', 'polysorbate 60', 'ins 435'], category: 'emulsifier', is_additive: true, effect: 'negative', severity: 2, note: 'Synthetic detergent-like emulsifier associated in preclinical models with gut barrier degradation.' },
    { name: 'Guar Gum', synonyms: ['guar gum', 'ins 412', 'e412', 'ins412', 'thickener (ins 412)', 'thickener (412)'], category: 'thickener', is_additive: true, effect: 'neutral', severity: 0, note: 'Natural legume seed soluble galactomannan polysaccharide.' },
    { name: 'Xanthan Gum', synonyms: ['xanthan gum', 'ins 415', 'e415', 'ins415', 'thickener (ins 415)', 'thickener (415)'], category: 'thickener', is_additive: true, effect: 'neutral', severity: 0, note: 'Bacterial fermentation polysaccharide providing viscosity.' },
    { name: 'Carrageenan', synonyms: ['carrageenan', 'ins 407', 'e407', 'ins407'], category: 'thickener', is_additive: true, effect: 'negative', severity: 2, note: 'Red seaweed sulfated polysaccharide linked to mucosal gut inflammation.' },
    { name: 'Pectin', synonyms: ['pectin', 'ins 440', 'e440', 'ins440'], category: 'thickener', is_additive: true, effect: 'positive', severity: 0, note: 'Natural soluble dietary fiber found in citrus peel and apple pomace.' },
    { name: 'Gum Arabic (Acacia Gum)', synonyms: ['gum arabic', 'acacia gum', 'ins 414', 'e414', 'ins414'], category: 'thickener', is_additive: true, effect: 'positive', severity: 0, note: 'Natural prebiotic soluble tree exudate fiber.' },

    // --- ACIDITY REGULATORS & LEAVENING AGENTS ---
    { name: 'Citric Acid', synonyms: ['citric acid', 'ins 330', 'e330', 'ins330', 'acidity regulator (ins 330)', 'acidity regulator (330)'], category: 'acidity_regulator', is_additive: true, effect: 'neutral', severity: 0, note: 'Natural fruit organic acid utilized for tartness and pH buffering.' },
    { name: 'Malic Acid', synonyms: ['malic acid', 'ins 296', 'e296', 'ins296'], category: 'acidity_regulator', is_additive: true, effect: 'neutral', severity: 0, note: 'Apple acid used for crisp, persistent sourness.' },
    { name: 'Lactic Acid', synonyms: ['lactic acid', 'ins 270', 'e270', 'ins270'], category: 'acidity_regulator', is_additive: true, effect: 'neutral', severity: 0, note: 'Organic fermentation acid used for pH regulation.' },
    { name: 'Sodium Citrate', synonyms: ['sodium citrate', 'trisodium citrate', 'ins 331', 'e331', 'ins331', 'acidity regulator (ins 331)'], category: 'acidity_regulator', is_additive: true, effect: 'neutral', severity: 0, note: 'Citric acid sodium salt used for pH buffering.' },
    { name: 'Sodium Bicarbonate', synonyms: ['sodium bicarbonate', 'baking soda', 'ins 500', 'ins 500(ii)', 'ins 500ii', 'e500', 'e500(ii)', 'raising agent (ins 500ii)', 'raising agent (500ii)'], category: 'raising_agent', is_additive: true, effect: 'neutral', severity: 0, note: 'Mineral leavening agent releasing carbon dioxide upon heating.' },
    { name: 'Ammonium Bicarbonate', synonyms: ['ammonium bicarbonate', 'baker\'s ammonia', 'ins 503', 'ins 503(ii)', 'e503', 'raising agent (ins 503ii)'], category: 'raising_agent', is_additive: true, effect: 'neutral', severity: 0, note: 'Traditional thermal leavening agent for crisp cookies and crackers.' },

    // --- DAIRY, PROTEIN & ALLERGENS ---
    { name: 'Milk Solids', synonyms: ['milk solids', 'milk powder', 'skimmed milk powder', 'whole milk powder', 'dairy solids', 'milk', 'cow milk', 'skim milk', 'pasteurized milk'], category: 'dairy', is_additive: false, effect: 'neutral', severity: 0, allergen: 'Milk', note: 'Dairy protein and lactose source.' },
    { name: 'Whey Protein', synonyms: ['whey', 'whey protein', 'whey powder', 'whey permeate', 'demineralized whey', 'whey protein concentrate', 'whey protein isolate'], category: 'protein', is_additive: false, effect: 'positive', severity: 0, allergen: 'Milk', note: 'High biological value dairy protein rich in essential branched-chain amino acids.' },
    { name: 'Egg', synonyms: ['egg', 'eggs', 'whole egg', 'egg powder', 'dried egg', 'egg white', 'egg yolk', 'albumen'], category: 'protein', is_additive: false, effect: 'neutral', severity: 0, allergen: 'Eggs', note: 'High quality complete protein; significant allergen.' },
    { name: 'Peanut', synonyms: ['peanut', 'peanuts', 'groundnut', 'groundnuts', 'peanut butter', 'roasted peanuts', 'peanut flour', 'defatted peanut flour'], category: 'nuts', is_additive: false, effect: 'neutral', severity: 0, allergen: 'Peanuts', note: 'Major anaphylactic food allergen; otherwise nutritious legume protein and lipid.' },
    { name: 'Tree Nuts (Almonds, Cashews, Walnuts)', synonyms: ['almond', 'almonds', 'cashew', 'cashews', 'walnut', 'walnuts', 'pistachio', 'pistachios', 'hazelnut', 'hazelnuts'], category: 'nuts', is_additive: false, effect: 'positive', severity: 0, allergen: 'Tree Nuts', note: 'Nutrient-dense tree nuts rich in monounsaturated fats and vitamin E.' },
    { name: 'Soy / Soya', synonyms: ['soy', 'soya', 'soybean', 'soybeans', 'soy protein', 'soy protein isolate', 'soya chunks', 'textured soy protein', 'defatted soy flour', 'tofu'], category: 'protein', is_additive: false, effect: 'neutral', severity: 0, allergen: 'Soy', note: 'Plant protein derived from soybeans; major allergen.' },
    { name: 'Sesame', synonyms: ['sesame', 'sesame seeds', 'til', 'tahini', 'sesame oil'], category: 'seeds', is_additive: false, effect: 'positive', severity: 0, allergen: 'Sesame', note: 'Mineral-rich oilseed; regulated food allergen.' },

    // --- SPICES, HERBS, BOTANICALS & COCOA ---
    { name: 'Spices and Condiments', synonyms: ['spices and condiments', 'spices', 'mixed spices', 'condiments', 'herbs and spices', 'herbs', 'mixed herbs', 'spice extracts', 'garam masala', 'masala', 'seasoning'], category: 'seasoning', is_additive: false, effect: 'neutral', severity: 0, note: 'Natural botanical seasonings and culinary spice blends.' },
    { name: 'Turmeric', synonyms: ['turmeric', 'turmeric powder', 'haldi'], category: 'seasoning', is_additive: false, effect: 'positive', severity: 0, note: 'Natural rhizome spice containing antioxidant curcumin.' },
    { name: 'Black Pepper / Chili', synonyms: ['black pepper', 'pepper', 'white pepper', 'chili', 'chilli', 'chili powder', 'red chili powder', 'paprika', 'cayenne pepper'], category: 'seasoning', is_additive: false, effect: 'neutral', severity: 0, note: 'Culinary pungent spices providing piperine and capsaicin.' },
    { name: 'Garlic & Onion', synonyms: ['garlic', 'garlic powder', 'dehydrated garlic', 'onion', 'onion powder', 'dehydrated onion', 'shallot'], category: 'seasoning', is_additive: false, effect: 'positive', severity: 0, note: 'Allium vegetables containing organosulfur compounds and allicin.' },
    { name: 'Ginger', synonyms: ['ginger', 'ginger powder', 'adrak'], category: 'seasoning', is_additive: false, effect: 'positive', severity: 0, note: 'Natural rhizome containing bioactive gingerols.' },
    { name: 'Cocoa Solids', synonyms: ['cocoa solids', 'cocoa powder', 'cacao powder', 'cocoa mass', 'chocolate liquor', 'chocolate', 'dark chocolate'], category: 'cocoa', is_additive: false, effect: 'positive', severity: 0, note: 'Cocoa seed solids packed with heart-healthy flavanol antioxidants.' },
    { name: 'Flavouring Substances', synonyms: ['natural flavours', 'natural flavors', 'nature identical flavouring substances', 'nature identical flavour', 'artificial flavours', 'artificial flavors', 'flavour', 'flavor', 'flavours', 'vanillin', 'ethyl vanillin'], category: 'flavour', is_additive: true, effect: 'neutral', severity: 1, note: 'Aromatic compounds added to simulate or standardize packaging taste.' },
    { name: 'Water', synonyms: ['water', 'purified water', 'carbonated water', 'mineral water'], category: 'beverage', is_additive: false, effect: 'positive', severity: 0, note: 'Essential hydration liquid.' }
  ];

  function normalizeKey(str) {
    return String(str)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function buildIndex(database) {
    const exactIndex = new Map();
    const synonymList = [];

    database.forEach(record => {
      // Index primary name
      const primeKey = normalizeKey(record.name);
      if (primeKey && !exactIndex.has(primeKey)) {
        exactIndex.set(primeKey, record);
      }
      synonymList.push({ key: primeKey, raw: record.name, record });

      // Index all synonyms
      record.synonyms.forEach(syn => {
        const key = normalizeKey(syn);
        if (key && !exactIndex.has(key)) {
          exactIndex.set(key, record);
        }
        synonymList.push({ key, raw: syn, record });
      });
    });

    return { exactIndex, synonymList };
  }

  global.IngredientDatabase = {
    records: INGREDIENT_DATABASE,
    normalizeKey,
    index: buildIndex(INGREDIENT_DATABASE)
  };
})(window);
