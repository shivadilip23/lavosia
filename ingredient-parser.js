/**
 * INGREDIENT TEXT PARSER MODULE
 * -----------------------------------------------------------------------------
 * Cleans raw OCR text, isolates ingredient lists from packaging copy/disclaimers,
 * repairs common OCR character/digit confusion, and splits into atomic items.
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /**
   * Fixes additive codes misread by OCR (e.g. 1NS 62l, IMS 621, E 3Z2, INS-500(ii)).
   */
  function fixAdditiveCodeOcr(text) {
    if (!text) return '';
    // 1. Standardize INS / E codes with OCR prefix confusion
    let out = text.replace(/\b(INS|1NS|IMS|1MS|IN5|E)[\s.\-:no]{0,4}([0-9OIlZSB]{2,5}[A-Za-z(ii)]{0,4})\b/gi, (match, prefix, num) => {
      const p = prefix.toUpperCase().startsWith('E') ? 'E' : 'INS';
      const fixedNum = num
        .replace(/O/gi, '0')
        .replace(/[Il]/g, '1')
        .replace(/Z/gi, '2')
        .replace(/S/gi, '5')
        .replace(/B/gi, '8');
      return `${p} ${fixedNum}`;
    });

    // 2. Fix isolated numeric codes in parentheses like (621) or (500ii, 503ii)
    out = out.replace(/\(([^)]+)\)/g, (full, inner) => {
      const fixedInner = inner.replace(/\b([1-9][0-9]{2,3}(?:\([a-z0-9]+\)|[a-z]{0,2}))\b/gi, (m) => {
        if (/^ins|^e/i.test(m)) return m;
        return `INS ${m}`;
      });
      return `(${fixedInner})`;
    });

    return out;
  }

  /**
   * Replaces hyphenated line breaks (e.g. "vege- \n table" -> "vegetable").
   */
  function dehyphenateLineBreaks(text) {
    return text.replace(/-\s*[\r\n]+\s*/g, '');
  }

  /**
   * Normalizes OCR brackets, quotes, and punctuation artifacts.
   */
  function normalizeBracketsAndPunctuation(text) {
    return text
      .replace(/[\[\{<]/g, '(')
      .replace(/[\]\}>]/g, ')')
      .replace(/[“”"']/g, '')
      .replace(/[|`~_^®™]+/g, ' ');
  }

  /**
   * Isolates the true ingredients section from packaging text.
   * Strips marketing slogans / brand names before "INGREDIENTS:",
   * and disclaimers (e.g. "STORE IN COOL DRY PLACE") after the list.
   */
  function isolateIngredientSection(text) {
    let t = text;

    // Detect "INGREDIENTS:" or "INGREDIENT LIST:" heading
    const labelMatch = t.match(/\b(?:INGREDIENTS?|INGREDIENT\s+LIST|INGRÉDIENTS?)\b\s*[:\-–.]?\s*/i);
    if (labelMatch && labelMatch.index !== undefined) {
      // Keep everything after the label
      t = t.slice(labelMatch.index + labelMatch[0].length);
    }

    // Strip trailing disclaimers/storage warnings/customer service lines
    const trailingRegex = /\b(?:MANUFACTURED\s+IN\s+(?:A\s+)?FACILITY|STORE\s+IN\s+(?:A\s+)?COOL|KEEP\s+REFRIGERATED|NUTRITION\s+FACTS|NUTRITIONAL\s+INFORMATION|BEST\s+BEFORE|MFG\s+DATE|EXPIRY\s+DATE|NET\s+WT|NET\s+WEIGHT|BATCH\s+NO|FOR\s+FEEDBACK|CUSTOMER\s+CARE|FSSAI|REG\s+NO|CONTAINS\s+ADDED\s+FLAVOU?R)\b.*$/is;
    t = t.replace(trailingRegex, '');

    return t.trim();
  }

  /**
   * Cleans raw OCR text through the complete normalization pipeline.
   */
  function cleanText(rawText) {
    if (!rawText) return '';
    let text = String(rawText);
    text = dehyphenateLineBreaks(text);
    text = normalizeBracketsAndPunctuation(text);
    text = isolateIngredientSection(text);
    text = fixAdditiveCodeOcr(text);
    text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
    return text.trim();
  }

  /**
   * Strips percentage specifications and quantitative parentheticals.
   */
  function stripQuantities(text) {
    return text
      .replace(/\(\s*(?:min\.?|max\.?|approx\.?|about|contains)?\s*[\d.,]+\s*%[^)]*\)/gi, '')
      .replace(/[\d.,]+\s*%/g, '')
      .replace(/\(\s*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Splits cleaned ingredient text into individual ingredients.
   * Handles commas, semicolons, bullet points (•, ·, *), and periods between words,
   * while strictly respecting parentheses depth so nested compounds stay grouped.
   */
  function splitIngredients(cleanedText) {
    if (!cleanedText) return [];

    const items = [];
    let current = '';
    let depth = 0;

    for (let i = 0; i < cleanedText.length; i++) {
      const ch = cleanedText[i];
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);

      // Check if delimiter at top-level (depth === 0)
      const isCommaOrSemi = (ch === ',' || ch === ';');
      const isBullet = (ch === '•' || ch === '·' || ch === '▪' || ch === '*');

      // Check for period used as delimiter (e.g. "Salt. Spices. Sugar.")
      // Only treat period as delimiter if not part of a decimal number (e.g. 1.5)
      let isPeriodDelimiter = false;
      if (ch === '.' && depth === 0) {
        const prevChar = i > 0 ? cleanedText[i - 1] : '';
        const nextChar = i < cleanedText.length - 1 ? cleanedText[i + 1] : '';
        const isDecimal = /\d/.test(prevChar) && /\d/.test(nextChar);
        const isAbbrev = /(?:ins|e|no|approx|min|max)/i.test(current.trim());
        if (!isDecimal && !isAbbrev && nextChar === ' ') {
          isPeriodDelimiter = true;
        }
      }

      if ((isCommaOrSemi || isBullet || isPeriodDelimiter) && depth === 0) {
        if (current.trim()) items.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) items.push(current.trim());

    return items
      .map(item => item.replace(/^\s*(?:and|&)\s+/i, '').trim())
      // Strip bullet points or numbered list indicators (e.g. "1. " or "• ") without stripping additive codes
      .map(item => item.replace(/^(?:[•·*▪\-–—]+|\d+[\.\)\-–—]\s*)/, '').trim())
      .map(item => item.replace(/[.:\-–—]+$/, '').trim())
      .filter(item => item.length > 0 && !/^\d+$/.test(item));
  }

  const GROUP_LABEL = /^(?:emulsifiers?|stabili[sz]ers?|thickeners?|gelling agents?|acidity regulators?|acids?|preservatives?|antioxidants?|colou?rs?|colou?rings?|added colou?rs?|flavou?rs?|flavou?rings?|flavour enhancers?|flavor enhancers?|raising agents?|leavening agents?|sweeteners?|humectants?|anti-?caking agents?|firming agents?|bulking agents?|seasoning|seasonings|spice mix|vitamins?|minerals?)$/i;

  function outerParen(item) {
    const open = item.indexOf('(');
    if (open === -1) return null;
    let depth = 0;
    for (let i = open; i < item.length; i++) {
      if (item[i] === '(') depth++;
      else if (item[i] === ')') {
        depth--;
        if (depth === 0) {
          return {
            base: item.slice(0, open).trim(),
            inner: item.slice(open + 1, i),
            rest: item.slice(i + 1).trim()
          };
        }
      }
    }
    return null;
  }

  function normalizeColon(item) {
    if (item.indexOf(':') === -1 || item.indexOf('(') !== -1) return item;
    const idx = item.indexOf(':');
    const left = item.slice(0, idx).trim();
    const right = item.slice(idx + 1).trim();
    if (!left || !right || left.split(/\s+/).length > 4) return item;
    return `${left} (${right})`;
  }

  function flattenNested(items, out) {
    const result = out || [];
    items.forEach(raw => {
      const item = normalizeColon(raw);
      const parts = outerParen(item);
      if (parts) {
        const innerItems = splitIngredients(parts.inner);
        if (innerItems.length > 1) {
          if (parts.base && !GROUP_LABEL.test(parts.base)) {
            result.push(parts.base);
          }
          const mappedInner = innerItems.map(inItem => {
            if (parts.base && GROUP_LABEL.test(parts.base) && !inItem.toLowerCase().includes(parts.base.toLowerCase())) {
              return `${parts.base} (${inItem})`;
            }
            return inItem;
          });
          flattenNested(mappedInner, result);
          return;
        }
      }
      result.push(item);
    });
    return result;
  }

  function parse(rawText) {
    const cleaned = cleanText(rawText);
    const list = flattenNested(splitIngredients(stripQuantities(cleaned)));
    return { cleaned, list };
  }

  global.IngredientParser = {
    cleanText,
    fixAdditiveCodeOcr,
    isolateIngredientSection,
    splitIngredients,
    stripQuantities,
    flattenNested,
    parse
  };
})(window);
