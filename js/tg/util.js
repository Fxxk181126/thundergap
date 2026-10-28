// ============================================================
//  雷隙 THUNDERGAP — 工具层（TG.util）
//  TD-4：可播种 PRNG。同一 seed 重建出完全相同的世界，
//  seed 随埋点与结算卡输出，用于复现与归因。
// ============================================================
window.TG = window.TG || {};

TG.util = (function () {
  'use strict';

  // mulberry32：15 行、质量足够游戏使用的可播种 PRNG
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    var f = mulberry32(seed);
    return {
      seed: seed >>> 0,
      next: f,
      range: function (a, b) { return a + f() * (b - a); },
      chance: function (p) { return f() < p; },
      pick: function (arr) { return arr[(f() * arr.length) | 0]; }
    };
  }

  return { mulberry32: mulberry32, makeRng: makeRng };
})();
