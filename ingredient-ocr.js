/**
 * INGREDIENT LABEL OCR  (rewrite)
 * -----------------------------------------------------------------------------
 * Why the old version produced bad text, and what changed:
 *
 *  1. It hard-binarized the photo (Bradley-Roth, tiny window) BEFORE Tesseract.
 *     Tesseract's LSTM engine does its own thresholding and reads grayscale far
 *     better; a bad black/white image breaks letters and fills holes.
 *     -> We now feed clean GRAYSCALE. Binary is only a last-resort variant.
 *  2. The "dark packaging" check looked at the image border, so a white label on
 *     a dark table got inverted wrongly.  -> Polarity is now decided from the
 *     centre of the image (text is always the minority colour).
 *  3. The grayscale fallback ran on the already-binarized image, so it did
 *     nothing.  -> Every variant is rebuilt from the ORIGINAL photo.
 *  4. Illumination leveling blurred the text into the background estimate.
 *     -> Background is now estimated with a morphological closing (text removed).
 *  5. No deskew, fixed resolution, a new Tesseract worker for every call.
 *     -> Deskew, adaptive resolution (re-scales from measured word height),
 *        one reusable worker, and a multi-pass best-result picker.
 *  6. Raw OCR text went straight to the parser.
 *     -> Light clean-up + conservative spell-fix of LOW-confidence words
 *        against an ingredient vocabulary.
 *
 * Public API is unchanged:
 *   ImagePreprocessor.loadFileToCanvas(file) / .preprocess(canvas) / .preprocessGrayscale(canvas)
 *   IngredientOCR.recognize(canvas, onProgress(0-100)) -> Promise<string>
 * recognize() accepts either the raw canvas or the canvas returned by preprocess().
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var PSM_AUTO = '3';
  var PSM_BLOCK = '6';

  /* ======================================================================
     Canvas / gray helpers
     ====================================================================== */
  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }

  function cloneCanvas(canvas) {
    var out = newCanvas(canvas.width, canvas.height);
    ctx2d(out).drawImage(canvas, 0, 0);
    return out;
  }

  async function loadFileToCanvas(file) {
    var bitmap = null, url = null;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      url = URL.createObjectURL(file);
      bitmap = await new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = reject;
        img.src = url;
      });
    }
    var w = bitmap.width || bitmap.naturalWidth || 1280;
    var h = bitmap.height || bitmap.naturalHeight || 720;
    var k = Math.min(1, 4096 / Math.max(w, h)); // keep memory sane on phones
    var canvas = newCanvas(w * k, h * k);
    var ctx = ctx2d(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    if (url) URL.revokeObjectURL(url);
    return canvas;
  }

  /** Scale to a target width; halves repeatedly when shrinking a lot (sharper). */
  function scaleToWidth(canvas, targetW) {
    targetW = Math.round(targetW);
    if (Math.abs(targetW - canvas.width) < 2) return cloneCanvas(canvas);
    var cur = canvas;
    while (cur.width / 2 >= targetW) {
      var half = newCanvas(cur.width / 2, cur.height / 2);
      var hc = ctx2d(half);
      hc.imageSmoothingEnabled = true; hc.imageSmoothingQuality = 'high';
      hc.drawImage(cur, 0, 0, half.width, half.height);
      cur = half;
    }
    var scale = targetW / cur.width;
    var out = newCanvas(targetW, cur.height * scale);
    var oc = ctx2d(out);
    oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = 'high';
    oc.drawImage(cur, 0, 0, out.width, out.height);
    return out;
  }

  function canvasToGray(canvas) {
    var w = canvas.width, h = canvas.height;
    var d = ctx2d(canvas).getImageData(0, 0, w, h).data;
    var g = new Uint8Array(w * h);
    for (var i = 0, j = 0; j < g.length; i += 4, j++) {
      g[j] = (77 * d[i] + 150 * d[i + 1] + 29 * d[i + 2]) >> 8;
    }
    return { w: w, h: h, g: g };
  }

  function grayToCanvas(img) {
    var c = newCanvas(img.w, img.h);
    var ctx = ctx2d(c);
    var id = ctx.createImageData(img.w, img.h);
    var d = id.data, g = img.g;
    for (var j = 0, i = 0; j < g.length; j++, i += 4) {
      d[i] = d[i + 1] = d[i + 2] = g[j];
      d[i + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  function histogramOf(g, step) {
    var hist = new Array(256).fill(0);
    for (var i = 0; i < g.length; i += (step || 1)) hist[g[i]]++;
    return hist;
  }

  function otsuFromHist(hist, total) {
    var sum = 0, t;
    for (t = 0; t < 256; t++) sum += t * hist[t];
    var sumB = 0, wB = 0, best = -1, thr = 127;
    for (t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    return thr;
  }

  /* ======================================================================
     Enhancement steps (all operate on {w,h,g} gray images)
     ====================================================================== */

  /** Text is always the minority colour. Look at the centre only. */
  function shouldInvert(img) {
    var w = img.w, h = img.h, g = img.g;
    var x0 = Math.floor(w * 0.15), x1 = Math.floor(w * 0.85);
    var y0 = Math.floor(h * 0.15), y1 = Math.floor(h * 0.85);
    var hist = new Array(256).fill(0), n = 0, x, y;
    for (y = y0; y < y1; y += 3) {
      for (x = x0; x < x1; x += 3) { hist[g[y * w + x]]++; n++; }
    }
    if (!n) return false;
    var t = otsuFromHist(hist, n);
    var nd = 0, sd = 0, nb = 0, sb = 0, i;
    for (i = 0; i < 256; i++) {
      if (i <= t) { nd += hist[i]; sd += i * hist[i]; }
      else { nb += hist[i]; sb += i * hist[i]; }
    }
    if (!nd || !nb) return false;
    if ((sb / nb) - (sd / nd) < 35) return false; // no clear text/background split
    return nd / n > 0.58;                           // dark majority => light text
  }

  function invertGray(img) {
    var g = img.g;
    for (var i = 0; i < g.length; i++) g[i] = 255 - g[i];
  }

  function maxFilter(src, w, h, r) {
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, k, m, v;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        m = -1;
        for (k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { v = src[y * w + k]; if (v > m) m = v; }
        tmp[y * w + x] = m;
      }
    }
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) {
        m = -1;
        for (k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { v = tmp[k * w + x]; if (v > m) m = v; }
        out[y * w + x] = m;
      }
    }
    return out;
  }

  function boxBlurF(src, w, h, r) {
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, k, s, c;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        s = 0; c = 0;
        for (k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { s += src[y * w + k]; c++; }
        tmp[y * w + x] = s / c;
      }
    }
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) {
        s = 0; c = 0;
        for (k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { s += tmp[k * w + x]; c++; }
        out[y * w + x] = s / c;
      }
    }
    return out;
  }

  /**
   * Divide out the lighting. Background is estimated by a morphological
   * closing at 1/8 resolution (a max filter wider than any letter erases the
   * text, leaving only the paper/pack colour and its shadows).
   */
  function flattenIllumination(img) {
    var w = img.w, h = img.h, g = img.g, f = 8;
    var sw = Math.max(4, Math.ceil(w / f)), sh = Math.max(4, Math.ceil(h / f));
    var small = new Float32Array(sw * sh), sx, sy, x, y;
    for (sy = 0; sy < sh; sy++) {
      var ya = sy * f, yb = Math.min(h, ya + f);
      for (sx = 0; sx < sw; sx++) {
        var xa = sx * f, xb = Math.min(w, xa + f), s = 0, c = 0;
        for (y = ya; y < yb; y++) { var row = y * w; for (x = xa; x < xb; x++) { s += g[row + x]; c++; } }
        small[sy * sw + sx] = c ? s / c : 255;
      }
    }
    var bg = maxFilter(small, sw, sh, 5);
    bg = boxBlurF(bg, sw, sh, 2);
    bg = boxBlurF(bg, sw, sh, 2);

    var out = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      var fy = (y + 0.5) / f - 0.5;
      var y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
      var y1 = Math.min(sh - 1, y0 + 1);
      var ty = Math.max(0, Math.min(1, fy - y0));
      for (x = 0; x < w; x++) {
        var fx = (x + 0.5) / f - 0.5;
        var x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
        var x1 = Math.min(sw - 1, x0 + 1);
        var tx = Math.max(0, Math.min(1, fx - x0));
        var top = bg[y0 * sw + x0] * (1 - tx) + bg[y0 * sw + x1] * tx;
        var bot = bg[y1 * sw + x0] * (1 - tx) + bg[y1 * sw + x1] * tx;
        var b = top * (1 - ty) + bot * ty;
        var v = g[y * w + x] * 235 / Math.max(b, 40);
        out[y * w + x] = v > 255 ? 255 : v;
      }
    }
    return { w: w, h: h, g: out };
  }

  /** Projection-profile skew estimate (degrees, text sloping down-right = +). */
  function estimateSkew(img) {
    var w = img.w, h = img.h, g = img.g;
    var step = Math.max(1, Math.round(w / 700));
    var sw = Math.floor(w / step), sh = Math.floor(h / step);
    if (sw < 50 || sh < 50) return 0;
    var small = new Uint8Array(sw * sh), x, y, i, j;
    for (y = 0; y < sh; y++) {
      for (x = 0; x < sw; x++) {
        var m = 255;
        for (j = 0; j < step; j++) {
          var row = (y * step + j) * w + x * step;
          for (i = 0; i < step; i++) { var v = g[row + i]; if (v < m) m = v; }
        }
        small[y * sw + x] = m; // min keeps thin dark strokes
      }
    }
    var hist = histogramOf(small, 1);
    var t = otsuFromHist(hist, small.length);
    var cnt = 0;
    for (i = 0; i < small.length; i++) if (small[i] < t) cnt++;
    if (cnt < 400) return 0;
    var stride = Math.max(1, Math.ceil(cnt / 80000));
    var xs = new Int16Array(Math.ceil(cnt / stride) + 1), ys = new Int16Array(xs.length), n = 0, seen = 0;
    for (y = 0; y < sh; y++) {
      for (x = 0; x < sw; x++) {
        if (small[y * sw + x] < t) {
          if (seen++ % stride === 0) { xs[n] = x; ys[n] = y; n++; }
        }
      }
    }
    function scoreAt(deg) {
      var a = deg * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
      var off = Math.ceil(sw * Math.abs(s)) + 2;
      var bins = new Int32Array(sh + off * 2 + 6);
      for (var k = 0; k < n; k++) bins[Math.round(ys[k] * c - xs[k] * s) + off]++;
      var sc = 0;
      for (var b = 0; b < bins.length; b++) sc += bins[b] * bins[b];
      return sc;
    }
    var best = 0, bestSc = scoreAt(0), base = bestSc, d, sc;
    for (d = -12; d <= 12; d += 1) { sc = scoreAt(d); if (sc > bestSc) { bestSc = sc; best = d; } }
    var center = best;
    for (d = center - 1; d <= center + 1; d += 0.25) { sc = scoreAt(d); if (sc > bestSc) { bestSc = sc; best = d; } }
    if (bestSc < base * 1.04) return 0;
    return best;
  }

  function rotateGray(img, rad, fill) {
    var src = grayToCanvas(img);
    var c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
    var W = Math.ceil(img.w * c + img.h * s), H = Math.ceil(img.w * s + img.h * c);
    var out = newCanvas(W, H), ctx = ctx2d(out);
    ctx.fillStyle = 'rgb(' + fill + ',' + fill + ',' + fill + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.translate(W / 2, H / 2);
    ctx.rotate(rad);
    ctx.drawImage(src, -img.w / 2, -img.h / 2);
    return canvasToGray(out);
  }

  function stretch(img) {
    var g = img.g, total = g.length;
    var hist = histogramOf(g, 1), lo = 0, hi = 255, acc = 0, v;
    for (v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.005) { lo = v; break; } }
    acc = 0;
    for (v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.005) { hi = v; break; } }
    if (hi - lo < 30) return img;
    var out = new Uint8Array(total), k = 255 / (hi - lo);
    for (var i = 0; i < total; i++) {
      var x = (g[i] - lo) * k;
      out[i] = x < 0 ? 0 : x > 255 ? 255 : x;
    }
    return { w: img.w, h: img.h, g: out };
  }

  function sharpen(img, amount) {
    var w = img.w, h = img.h, g = img.g, tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), x, y;
    for (y = 0; y < h; y++) {
      var r = y * w;
      for (x = 0; x < w; x++) {
        var a = g[r + (x > 0 ? x - 1 : 0)], b = g[r + x], c = g[r + (x < w - 1 ? x + 1 : x)];
        tmp[r + x] = (a + b + c) / 3;
      }
    }
    for (y = 0; y < h; y++) {
      var up = (y > 0 ? y - 1 : 0) * w, mid = y * w, dn = (y < h - 1 ? y + 1 : y) * w;
      for (x = 0; x < w; x++) {
        var blur = (tmp[up + x] + tmp[mid + x] + tmp[dn + x]) / 3;
        var v = g[mid + x] + amount * (g[mid + x] - blur);
        out[mid + x] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    return { w: w, h: h, g: out };
  }

  function padGray(img, pad, fill) {
    var W = img.w + pad * 2, H = img.h + pad * 2;
    var out = new Uint8Array(W * H).fill(fill);
    for (var y = 0; y < img.h; y++) out.set(img.g.subarray(y * img.w, (y + 1) * img.w), (y + pad) * W + pad);
    return { w: W, h: H, g: out };
  }

  function binarizeGray(img) {
    var g = img.g, hist = histogramOf(g, 1), t = otsuFromHist(hist, g.length);
    var out = new Uint8Array(g.length);
    for (var i = 0; i < g.length; i++) out[i] = g[i] <= t ? 0 : 255;
    return { w: img.w, h: img.h, g: out };
  }

  /**
   * Full enhancement from the ORIGINAL photo.
   * opts: { width, invert: 'auto' | true | false, deskew }
   */
  function prepare(source, opts) {
    opts = opts || {};
    var targetW = opts.width || Math.min(3000, Math.max(1800, source.width));
    var img = canvasToGray(scaleToWidth(source, targetW));
    var invert = (opts.invert === undefined || opts.invert === 'auto') ? shouldInvert(img) : !!opts.invert;
    if (invert) invertGray(img);
    img = flattenIllumination(img);
    var angle = 0;
    if (opts.deskew !== false) {
      angle = estimateSkew(img);
      if (Math.abs(angle) >= 0.4) img = rotateGray(img, -angle * Math.PI / 180, 235);
      else angle = 0;
    }
    img = stretch(img);
    img = sharpen(img, 0.7);
    img = padGray(img, Math.max(24, Math.round(img.w * 0.02)), 255);
    return { canvas: grayToCanvas(img), gray: img, invert: invert, angle: angle, width: targetW };
  }

  function binaryCanvasOf(prep) { return grayToCanvas(binarizeGray(prep.gray)); }

  /* Back-compat exports ------------------------------------------------- */
  function preprocess(canvas) {
    var source = canvas.__source || canvas;
    var out = prepare(source, {}).canvas;
    out.__source = source; // recognize() rebuilds every variant from the original
    return out;
  }

  global.ImagePreprocessor = {
    loadFileToCanvas: loadFileToCanvas,
    preprocess: preprocess,
    preprocessGrayscale: preprocess,
    steps: {}
  };

  /* ======================================================================
     Text clean-up + conservative spell fix
     ====================================================================== */
  var VOCAB = new Set((
    'ingredients ingredient sugar salt iodised iodized water flour wheat maize corn rice oats oat barley rye millet starch ' +
    'maltodextrin dextrose glucose fructose syrup sucrose lactose jaggery honey molasses sweetener sweeteners oil palm ' +
    'palmolein sunflower soybean soya mustard canola rapeseed coconut groundnut peanut peanuts sesame olive vegetable ' +
    'hydrogenated refined edible ghee butter milk skimmed whey casein cream cheese curd yogurt yoghurt solids powder ' +
    'protein isolate concentrate egg eggs yolk albumen gelatin fish shrimp prawn chicken beef pork meat cocoa chocolate ' +
    'cacao vanilla vanillin coffee tea extract flavour flavouring flavor flavoring natural identical artificial added ' +
    'colour colours color colors caramel annatto turmeric curcumin paprika carotene preservative preservatives antioxidant ' +
    'antioxidants stabilizer stabiliser stabilizers stabilisers emulsifier emulsifiers acidity regulator regulators ' +
    'thickener thickeners raising agent agents anticaking firming humectant enhancer monosodium glutamate disodium ' +
    'inosinate guanylate ribonucleotides sodium potassium calcium magnesium iron zinc benzoate sorbate nitrite nitrate ' +
    'sulphite sulfite metabisulphite bicarbonate carbonate phosphate citrate lactate acetate chloride sulphate sulfate ' +
    'hydroxide citric acid ascorbic lactic malic tartaric phosphoric acetic sorbic benzoic folic niacin riboflavin ' +
    'thiamine pyridoxine cyanocobalamin vitamin vitamins minerals mineral fortified lecithin lecithins pectin xanthan gum ' +
    'guar locust bean arabic carrageenan agar cellulose methylcellulose aspartame sucralose saccharin acesulfame stevia ' +
    'steviol glycosides sorbitol mannitol xylitol erythritol polydextrose glycerol glycerin mono diglycerides glycerides ' +
    'fatty acids esters polysorbate propylene glycol spices spice condiments seasoning onion garlic ginger chilli chili ' +
    'pepper black red green cumin coriander cardamom cinnamon clove cloves nutmeg fenugreek asafoetida curry leaves herbs ' +
    'yeast malt maltose baking soda leavening gluten nuts almond almonds cashew cashews walnut walnuts hazelnut pistachio ' +
    'raisins dates fruit fruits tomato potato potatoes carrot spinach apple mango lemon orange banana peas lentil lentils ' +
    'chickpea chickpeas gram besan maida atta semolina vinegar sauce paste puree juice pulp flakes granules seeds seed ' +
    'kernel bran germ fibre fiber dietary inulin contain contains traces allergen allergens manufactured facility ' +
    'processed produced packed product mixed blend modified hydrolyzed hydrolysed partially wholegrain wholemeal whole ' +
    'enriched bleached unbleached organic permitted class cocoa solid'
  ).split(/\s+/));

  function lev(a, b) {
    var m = a.length, n = b.length, prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  function closestVocab(tok) {
    var L = tok.length, maxD = L <= 7 ? 1 : 2, best = null, bestD = 99, tie = false;
    VOCAB.forEach(function (v) {
      if (Math.abs(v.length - L) > maxD) return;
      var d = lev(tok, v);
      if (d < bestD) { best = v; bestD = d; tie = false; }
      else if (d === bestD && v !== best) tie = true;
    });
    return (best && bestD <= maxD && !tie) ? best : null;
  }

  function matchCase(orig, rep) {
    if (orig === orig.toUpperCase()) return rep.toUpperCase();
    if (orig[0] === orig[0].toUpperCase()) return rep[0].toUpperCase() + rep.slice(1);
    return rep;
  }

  function extractWords(data) {
    if (data && Array.isArray(data.words) && data.words.length) return data.words;
    var out = [];
    ((data && data.blocks) || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (w) { out.push(w); }); });
      });
    });
    return out;
  }

  function cleanText(text, words) {
    var t = String(text || '').replace(/\r/g, '');

    // Join words split by a line-end hyphen only when the result is a known word.
    t = t.replace(/([A-Za-z]{2,})-\n\s*([A-Za-z]{2,})/g, function (m, a, b) {
      return VOCAB.has((a + b).toLowerCase()) ? a + b : a + '-' + b;
    });

    // Symbols that are essentially always OCR noise on a food label.
    t = t.replace(/[|~^_`\\©®™]/g, ' ');

    // Digit/letter confusions inside lowercase words (s0dium, vegetab1e).
    for (var pass = 0; pass < 2; pass++) {
      t = t.replace(/([a-z])0([a-z])/g, '$1o$2').replace(/([a-z])1([a-z])/g, '$1l$2');
    }

    // Drop garbage lines (mostly symbols / too short to be real text).
    t = t.split('\n').map(function (ln) { return ln.replace(/[ \t]+/g, ' ').trim(); })
      .filter(function (ln) {
        if (!ln) return true;
        var alnum = (ln.match(/[A-Za-z0-9]/g) || []).length;
        var nonSpace = ln.replace(/\s/g, '').length;
        return alnum >= 3 && alnum / nonSpace >= 0.5;
      }).join('\n').replace(/\n{3,}/g, '\n\n').trim();

    // Spell-fix only words Tesseract itself was unsure about.
    var fixes = {};
    (words || []).forEach(function (w) {
      var raw = (w.text || '').replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
      if (!raw || (w.confidence || 0) >= 80 || !/^[A-Za-z]{5,}$/.test(raw)) return;
      if (VOCAB.has(raw.toLowerCase()) || fixes[raw]) return;
      var rep = closestVocab(raw.toLowerCase());
      if (rep) fixes[raw] = matchCase(raw, rep);
    });
    Object.keys(fixes).forEach(function (tok) {
      t = t.replace(new RegExp('\\b' + tok + '\\b', 'g'), fixes[tok]);
    });
    return t;
  }

  /* ======================================================================
     Tesseract worker + multi-pass recognition
     ====================================================================== */
  var workerPromise = null;
  var activeLogger = null;
  var queue = Promise.resolve();

  function getWorker() {
    if (!workerPromise) {
      workerPromise = (async function () {
        var opts = Object.assign({
          logger: function (m) { if (activeLogger) activeLogger(m); }
        }, (global.IngredientOCR && global.IngredientOCR.workerOptions) || {});
        var worker = await Tesseract.createWorker('eng', 1, opts); // 1 = LSTM engine only
        await worker.setParameters({
          preserve_interword_spaces: '1',
          user_defined_dpi: '300'
        });
        return worker;
      })().catch(function (e) { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  function toInput(canvas) {
    return typeof canvas.toBuffer === 'function' ? canvas.toBuffer('image/png') : canvas; // toBuffer: node test only
  }

  function analyse(data) {
    var words = extractWords(data), good = 0, total = 0, confSum = 0, confN = 0, hs = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i], t = (w.text || '').trim();
      if (!t) continue;
      total++;
      var conf = typeof w.confidence === 'number' ? w.confidence : 0;
      var letters = (t.match(/[A-Za-z]/g) || []).length;
      if (t.length >= 2 && letters / t.length >= 0.6) {
        confSum += conf; confN++;
        if (conf >= 70) good += t.length;
      }
      if (t.length >= 3 && conf >= 50 && w.bbox) hs.push(w.bbox.y1 - w.bbox.y0);
    }
    hs.sort(function (a, b) { return a - b; });
    return {
      good: good, words: total, meanConf: confN ? confSum / confN : 0,
      medianH: hs.length ? hs[hs.length >> 1] : 0, nH: hs.length
    };
  }

  function better(a, b) {
    return a.stats.good > b.stats.good || (a.stats.good === b.stats.good && a.stats.meanConf > b.stats.meanConf);
  }

  function isGoodEnough(r) {
    return (r.stats.good >= 120 && r.stats.meanConf >= 78) || (r.stats.good >= 60 && r.stats.meanConf >= 90);
  }

  async function ocrPass(worker, canvas, psm, base, span, report) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    activeLogger = function (m) {
      if (m && m.status === 'recognizing text') report(base + span * (m.progress || 0));
    };
    try {
      var res = await worker.recognize(toInput(canvas));
      var data = (res && res.data) || {};
      return { data: data, text: (data.text || '').trim(), stats: analyse(data) };
    } finally {
      activeLogger = null;
    }
  }

  async function runRecognize(input, onProgress) {
    var source = input.__source || input;
    var lastPct = 0;
    function report(p) {
      p = Math.max(lastPct, Math.min(99, Math.round(p)));
      lastPct = p;
      if (typeof onProgress === 'function') onProgress(p);
    }
    report(2);
    var worker = await getWorker();
    report(8);

    var best = null, tried = [], cursor = 8;
    async function attempt(label, canvas, psm, prep, span) {
      var r = await ocrPass(worker, canvas, psm, cursor, span, report);
      cursor += span;
      r.label = label; r.prep = prep; tried.push(label);
      if (!best || better(r, best)) best = r;
      return r;
    }

    // Pass 1: clean grayscale, single-block layout.
    var prep = prepare(source, {});
    var r = await attempt('gray/block', prep.canvas, PSM_BLOCK, prep, 30);

    // Adapt resolution from measured word height (Tesseract is happiest ~30-45px tall words).
    var mh = r.stats.medianH;
    if (r.stats.nH >= 6 && (mh < 26 || mh > 70)) {
      var newW = Math.round(Math.min(4200, Math.max(1200, prep.width * 38 / mh)));
      if (Math.abs(newW - prep.width) / prep.width > 0.15) {
        var prep2 = prepare(source, { width: newW });
        await attempt('rescaled/block', prep2.canvas, PSM_BLOCK, prep2, 28);
      }
    }

    // Still weak? try other layouts / polarity / hard binarization.
    var extras = [
      function () { return ['gray/auto', best.prep.canvas, PSM_AUTO, best.prep]; },
      function () {
        var p = prepare(source, { width: best.prep.width, invert: !best.prep.invert });
        return ['flipped/block', p.canvas, PSM_BLOCK, p];
      },
      function () { return ['binary/block', binaryCanvasOf(best.prep), PSM_BLOCK, best.prep]; }
    ];
    for (var i = 0; i < extras.length && !isGoodEnough(best); i++) {
      var e = extras[i]();
      await attempt(e[0], e[1], e[2], e[3], 12);
    }

    var text = cleanText(best.text, extractWords(best.data));
    global.IngredientOCR.lastResult = {
      passes: tried, winner: best.label, stats: best.stats,
      angle: best.prep.angle, inverted: best.prep.invert, width: best.prep.width
    };
    if (typeof onProgress === 'function') onProgress(100);
    return text;
  }

  /** Runs OCR. Accepts the raw canvas or the one returned by preprocess(). */
  function recognize(input, onProgress) {
    if (typeof Tesseract === 'undefined') return Promise.reject(new Error('OCR_ENGINE_UNAVAILABLE'));
    var job = queue.then(function () { return runRecognize(input, onProgress); });
    queue = job.catch(function () {});
    return job;
  }

  global.IngredientOCR = {
    recognize: recognize,
    workerOptions: {},
    lastResult: null,
    terminate: async function () {
      if (!workerPromise) return;
      var w = await workerPromise; workerPromise = null;
      await w.terminate();
    }
  };
})(window);