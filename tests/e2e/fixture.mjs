/**
 * Frozen visual fixture.
 *
 * Reproduces the accepted baseline (c2833d2) through the NEW config path:
 * the values below are published-revision shaped, and the renderer reaches
 * them via the bootstrap adapter rather than by importing a hardcoded
 * object. That is precisely what the visual gate has to prove — the
 * screenshots must not care that the data now arrives from D1.
 *
 * Media is deliberately absent. The accepted baseline had no photography
 * or audio supplied (every slot `ready: false`), so the fixture supplies
 * no media URLs and the placeholders render exactly as they did. Adding
 * stock imagery here would change the pixels and invalidate the gate;
 * real R2-backed media is exercised by separate functional tests.
 */

export const DEMO_SLUG = "demo";

export const DEMO_BOOTSTRAP = {
  slug: DEMO_SLUG,
  revisionId: "rev-frozen-fixture",
  isPreview: false,
  mediaUrls: {},
  config: {
    themeId: "cinematic-classic",
    themeVersion: 1,
    couple: {
      groom: { zh: "李天豪", en: "LEE THEAN HOW" },
      bride: { zh: "刘蔼蕴", en: "LAW HAI YEUN" },
    },
    date: {
      iso: "2027-10-09T11:00:00+08:00",
      lunar: "农历九月初十",
      timeLabel: "11:00",
      durationHours: 4,
    },
    copy: {
      cover: { bracket: "【婚礼邀请函】", welcome: "WELCOME TO OUR WEDDING" },
      poem: {
        heading: "“我”被慢慢写成了“我们”",
        lines: ["以前觉得婚礼是一则官方公告", "现在才明白", "这是一场为数不多的相聚"],
        motif: "{囍}",
        after: ["是千里迢迢的奔赴", "是不计得失的支持", "诚邀您携家人参加我们的婚礼"],
      },
      portrait: { brideLabel: "新娘", groomLabel: "新郎" },
      story: {
        heading: "一场崭新的旅程\n即将开启",
        announce: "我们结婚啦！",
        badge: "婚礼邀请函",
        invite: "诚挚邀请您出席我们的婚礼\n见证我们的幸福",
        letter: [
          "你们是我们成长路上最温暖的人",
          "也是我们人生中最重要的部分",
          "当你收到这封邀请函，",
          "我们已经在倒数着日子",
          "期待着与你们的相见",
          "在我们最重要的这一天",
        ],
        caption: "一面湖，一页夏，一丛月亮，一个家",
      },
      time: { heading: "婚礼时间", quote: "I'm so happy I get to be next to you" },
      venue: {
        heading: "婚礼地点",
        tbaName: "地点待公布",
        tbaNote: "确定后将另行通知",
        mapLabel: "查看地图",
        calendarLabel: "加入日历",
      },
      closing: {
        poem: ["一起追逐人间理想", "一起感受星河滚烫", "我们的感情很好概括", "未来是你"],
        thanks: "感谢你 / 不远万里 / 为我们祝福",
        thanksLine2: "婚礼见",
      },
      rsvp: {
        heading: "敬盼回复",
        deadlineLabel: "请在 {date} 前回复",
        name: "姓名",
        attending: "是否出席",
        yes: "欣然出席",
        no: "遗憾缺席",
        guests: "出席人数",
        optionalToggle: "＋ 留下联系方式或祝福",
        optionalToggleOpen: "－ 收起",
        phone: "电话号码",
        instagram: "Instagram",
        contactHint: "电话与 Instagram 至少填写一项",
        message: "祝福留言",
        submit: "提 交",
        submitting: "提交中…",
        successTitle: "收到啦",
        successBody: "感谢你的祝福，婚礼见。",
        errors: {
          name: "请填写姓名",
          contact: "请留下电话或 Instagram，方便我们联系你",
          network: "提交失败，请检查网络后再试一次",
          server: "出了点问题，请稍后再试",
        },
      },
    },
    venue: { tba: true, name: "", address: "", mapsUrl: "" },
    rsvp: { deadlineISO: "2027-09-30T23:59:59+08:00", maxGuests: 12 },
    // Every slot unsupplied, matching the accepted baseline.
    media: {
      hero: { assetId: null },
      portrait: { assetId: null },
      story: { assetId: null },
      landscape: { assetId: null },
      venue: { assetId: null },
      closing: { assetId: null },
    },
    music: { assetId: null, enabled: false, title: "婚礼背景音乐" },
    motion: { driftPxPerSec: 46 },
  },
};
