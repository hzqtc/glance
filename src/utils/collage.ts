import type { PhotoItem } from '../types';

export type CollageLayout =
  | 'single'
  | 'single-portrait'
  | 'duo-vertical'
  | 'trio-vertical'
  | 'bento-left'
  | 'bento-right';

export interface CollageFrame {
  key: string;
  layout: CollageLayout;
  items: PhotoItem[];
}

function shuffleArray<T>(arr: T[]): T[] {
  var out = arr.slice();
  for (var i = out.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function getAspect(p: PhotoItem): number {
  if (p.aspect && p.aspect > 0) return p.aspect;
  if (p.width > 0 && p.height > 0) return p.width / p.height;
  return 1.333;
}

function makeFrameKey(layout: CollageLayout, items: PhotoItem[], seq: number): string {
  var ids = '';
  for (var i = 0; i < items.length; i++) {
    ids += (i > 0 ? '_' : '') + items[i].id;
  }
  return layout + '-' + String(seq) + '-' + ids;
}

/**
 * Builds a shuffled sequence of aspect-ratio-aware full-screen collage frames:
 * - Landscape photos (ar >= 1.18): full-bleed `single` OR paired into `bento-left` / `bento-right`
 * - Portrait & square photos (ar < 1.18): `duo-vertical` (2-up), `trio-vertical` (3 tall portraits),
 *   or hero side slot of `bento-left` / `bento-right`
 */
export function buildCollageDeck(photos: PhotoItem[], deckRound: number): CollageFrame[] {
  if (!photos || photos.length === 0) return [];

  var landscapes: PhotoItem[] = [];
  var portraits: PhotoItem[] = [];

  for (var i = 0; i < photos.length; i++) {
    var p = photos[i];
    if (getAspect(p) >= 1.18) {
      landscapes.push(p);
    } else {
      portraits.push(p);
    }
  }

  var allPortraits = portraits.slice();
  landscapes = shuffleArray(landscapes);
  portraits = shuffleArray(portraits);

  var frames: CollageFrame[] = [];
  var seq = deckRound * 1000;
  var bentoFlip = deckRound % 2 === 1;
  var lastLayout: CollageLayout | '' = '';

  while (landscapes.length > 0 || portraits.length > 0) {
    var hasL = landscapes.length;
    var hasP = portraits.length;

    // Mixed pool: alternate naturally between bento, single landscape, and portrait duo
    if (hasP >= 1 && hasL >= 2) {
      var roll = Math.random();
      if (roll < 0.42 && lastLayout !== 'bento-left' && lastLayout !== 'bento-right') {
        var bLayout: CollageLayout = bentoFlip ? 'bento-right' : 'bento-left';
        bentoFlip = !bentoFlip;
        var pHero = portraits.pop() as PhotoItem;
        var lTop = landscapes.pop() as PhotoItem;
        var lBot = landscapes.pop() as PhotoItem;
        // Layout items order: [portraitHero, landscapeTop, landscapeBottom]
        frames.push({
          key: makeFrameKey(bLayout, [pHero, lTop, lBot], ++seq),
          layout: bLayout,
          items: [pHero, lTop, lBot],
        });
        lastLayout = bLayout;
        continue;
      }
      if (roll < 0.72 || hasP < 2) {
        var lOnly = landscapes.pop() as PhotoItem;
        frames.push({
          key: makeFrameKey('single', [lOnly], ++seq),
          layout: 'single',
          items: [lOnly],
        });
        lastLayout = 'single';
        continue;
      }
      var pA = portraits.pop() as PhotoItem;
      var pB = portraits.pop() as PhotoItem;
      frames.push({
        key: makeFrameKey('duo-vertical', [pA, pB], ++seq),
        layout: 'duo-vertical',
        items: [pA, pB],
      });
      lastLayout = 'duo-vertical';
      continue;
    }

    // Mostly/only portraits left
    if (hasP >= 3) {
      var top3Tall =
        getAspect(portraits[hasP - 1]) <= 0.8 &&
        getAspect(portraits[hasP - 2]) <= 0.8 &&
        getAspect(portraits[hasP - 3]) <= 0.8;
      if (top3Tall && lastLayout !== 'trio-vertical' && Math.random() < 0.45) {
        var t1 = portraits.pop() as PhotoItem;
        var t2 = portraits.pop() as PhotoItem;
        var t3 = portraits.pop() as PhotoItem;
        frames.push({
          key: makeFrameKey('trio-vertical', [t1, t2, t3], ++seq),
          layout: 'trio-vertical',
          items: [t1, t2, t3],
        });
        lastLayout = 'trio-vertical';
        continue;
      }
    }

    if (hasP >= 2) {
      var d1 = portraits.pop() as PhotoItem;
      var d2 = portraits.pop() as PhotoItem;
      frames.push({
        key: makeFrameKey('duo-vertical', [d1, d2], ++seq),
        layout: 'duo-vertical',
        items: [d1, d2],
      });
      lastLayout = 'duo-vertical';
      continue;
    }

    if (hasL >= 1) {
      var s1 = landscapes.pop() as PhotoItem;
      frames.push({
        key: makeFrameKey('single', [s1], ++seq),
        layout: 'single',
        items: [s1],
      });
      lastLayout = 'single';
      continue;
    }

    // 1 leftover portrait photo
    if (hasP === 1) {
      var lastP = portraits.pop() as PhotoItem;
      // Pair with another distinct portrait from the album if available so screen stays filled
      var partner: PhotoItem | null = null;
      if (allPortraits.length >= 2) {
        var candidates: PhotoItem[] = [];
        for (var k = 0; k < allPortraits.length; k++) {
          if (allPortraits[k].id !== lastP.id) {
            candidates.push(allPortraits[k]);
          }
        }
        if (candidates.length > 0) {
          partner = candidates[Math.floor(Math.random() * candidates.length)];
        }
      }
      if (partner) {
        frames.push({
          key: makeFrameKey('duo-vertical', [lastP, partner], ++seq),
          layout: 'duo-vertical',
          items: [lastP, partner],
        });
        lastLayout = 'duo-vertical';
      } else {
        frames.push({
          key: makeFrameKey('single-portrait', [lastP], ++seq),
          layout: 'single-portrait',
          items: [lastP],
        });
        lastLayout = 'single-portrait';
      }
    }
  }

  return shuffleArray(frames);
}
