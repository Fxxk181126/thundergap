// ============================================================
//  雷隙 THUNDERGAP — 配置与数值表（TG.config）
//  所有可调参数集中于此，与 PRD 第 07 节数值表一一对应。
// ============================================================
window.TG = window.TG || {};

TG.config = {
  CITY: 190,             // 城市直径（米）
  GOAL_FRAGMENTS: 8,     // 雷纹碎片总数（八段叙事，不改）
  STORM_DURATION: 300,   // 穹顶闭合倒计时（秒）——试玩轮 215 → 300，首版保证可通关

  PAUSE: {
    lockGraceMs: 1500    // 开局等待指针锁定的宽限，超时按无锁模式开局
  },

  PLAYER: {
    walk: 5.0, sprint: 8.6,
    jump: 7.4, gravity: 23,
    radius: 0.5, accel: 9, turnLerp: 12,
    coyote: 0.10, jumpBuffer: 0.12   // TD-7 手感补丁
  },

  RESONANCE: { max: 100, cost: 25, regen: 7.5 },

  STRIKE: {
    warnDelay: 1.35,
    dmgCenter: 42, dmgEdge: 20,
    centerR: 1.9, hitR: 3.6,
    rangeMin: 6, rangeMax: 22,
    invuln: 0.9, knock: 9, knockUp: 5.2,
    fragSafeR: 8,        // 未拾取碎片 8m 内不落雷（试玩公平性）
    fragSafeRetry: 6     // 采样重试次数
  },

  PULSE: { speed: 42, maxR: 34, revealBand: 4.5, revealTime: 5 },

  FRAGMENT: {
    pickupDist: 2.4, stormRelief: 0.10, heal: 6,   // 拾取改水平距离 2.4m；单片回退 10%
    nearDist: 14, humFalloff: 30
  },

  RAIN:   { count: 14000, area: 110, height: 46 },
  RIPPLE: { count: 340 },
  FOG:    { color: 0x060a14, density: 0.0135 },

  fragLines: [
    '……信号……这里是城西变电站……雨太大了，我听不见回话……',
    '姐，我在广播塔下面。水位已经淹到第二级台阶了。',
    '穹顶在收缩。每次闪电，它就往下压一点。我数过，九十秒一次。',
    '如果你能听见这个频率，说明我的发射器还在工作。',
    '我把坐标编进雷纹里了——跟着闪电走，别跟着路走。',
    '别来找我。……不，还是来吧。我怕黑。',
    '姐，雷声里有东西在答话。你听见了吗？不要回答它。',
    '最后一个频段我留给你。到塔顶，把它发出去。'
  ]
};
