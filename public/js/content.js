// ============================================================
// EDIT THIS FILE to personalize the invitation.
// All text is bilingual: zh = Chinese, en = English.
// Photos go in public/assets/photos/, music in public/assets/music.mp3
// ============================================================

window.INVITE = {
  musicSrc: "assets/music.mp3",

  couple: {
    zhFirst: "黄",
    zhSecond: "陈",
    // full legal names shown in pill & footer — edit here:
    fullZhA: "黄嘉俊",
    fullEnA: "WONG KAR CHUN",
    fullZhB: "陈佩筠",
    fullEnB: "CHAN POOI KUAN",
    tagline: { zh: "【婚礼邀请函】", en: "WELCOME TO OUR WEDDING" },
    dateLabel: "2025.12.07",
    namesLine: { zh: "黄嘉俊 ❤ 陈佩筠", en: "Kar Chun & Pooi Kuan" },
  },

  // keep 2025-12-07 to mirror the original — change if your date differs
  weddingISO: "2025-12-07T06:30:00+08:00",
  lunarLabel: "农历十月十八 06:30",
  weekdayZh: "星期日",

  story: {
    title: { zh: "致亲爱的你们", en: "Dearest" },
    // mirrors original: “我”被慢慢写成了“我们” + poem
    intro: {
      heading: { zh: "“我”被慢慢写成了“我们”", en: "\"I\" slowly became \"We\"" },
      lines: [
        { zh: "以前觉得婚礼是一则官方公告", en: "" },
        { zh: "现在才明白", en: "" },
        { zh: "这是一场为数不多的相聚", en: "" },
        { zh: "{囍}", en: "" },
        { zh: "是千里迢迢的奔赴", en: "" },
        { zh: "是不计得失的支持", en: "" },
        { zh: "诚邀您携家人参加我们的婚礼", en: "" },
      ],
    },
    journey: {
      heading: { zh: "一场崭新的旅程即将开启", en: "A new journey begins" },
      lines: [
        { zh: "我们结婚啦！", en: "We're getting married!" },
        { zh: "诚挚邀请您出席我们的婚礼", en: "" },
        { zh: "见证我们的幸福", en: "" },
      ],
    },
    letter: {
      lines: [
        { zh: "你们是我们成长路上最温暖的人", en: "" },
        { zh: "也是我们人生中最重要的部分", en: "" },
        { zh: "当你收到这封邀请函，", en: "" },
        { zh: "我们已经在倒数着日子", en: "" },
        { zh: "期待着与你们的相见", en: "" },
        { zh: "在我们最重要的这一天", en: "" },
      ],
    },
    closingPoem: [
      { zh: "一起追逐人间理想", en: "" },
      { zh: "一起感受星河滚烫", en: "" },
      { zh: "我们的感情很好概括", en: "" },
      { zh: "未来是你", en: "" },
    ],
  },

  details: {
    venue: {
      nameZh: "婚礼地点 待公布",
      nameEn: "Venue TBA",
      addressZh: "详细地址待公布",
      addressEn: "Address TBA",
      mapsUrl: "https://maps.google.com/?q=Kuala+Lumpur",
    },
    program: [
      { time: "06:30", zh: "迎宾入席", en: "Guests arrive" },
      { time: "11:00", zh: "婚礼仪式", en: "Ceremony" },
      { time: "12:30", zh: "婚宴开席", en: "Banquet" },
    ],
    dressCode: { zh: "着装：喜庆色系", en: "Dress code: festive colors" },
  },

  photos: [
    "assets/photos/photo1.jpg",
    "assets/photos/photo2.jpg",
    "assets/photos/photo3.jpg",
    "assets/photos/photo4.jpg",
    "assets/photos/photo5.jpg",
    "assets/photos/photo6.jpg",
  ],

  rsvpDeadlineISO: "2025-11-30T23:59:59+08:00",

  rsvpText: {
    title: { zh: "敬盼回复", en: "RSVP" },
    deadlineLabel: { zh: "请在十一月三十日前回复", en: "Kindly reply by 30 November" },
    nameLabel: { zh: "姓名", en: "Your name" },
    attendingLabel: { zh: "您会出席吗？", en: "Will you attend?" },
    yes: { zh: "欣然出席", en: "Accept" },
    no: { zh: "遗憾缺席", en: "Decline" },
    guestsLabel: { zh: "出席人数", en: "Guests" },
    phoneLabel: { zh: "电话号码", en: "Phone" },
    instagramLabel: { zh: "Instagram", en: "Instagram" },
    contactHint: { zh: "请至少填写一项", en: "At least one required" },
    messageLabel: { zh: "祝福留言（可选）", en: "Message (optional)" },
    submit: { zh: "提交", en: "Submit" },
    successTitle: { zh: "收到啦！", en: "Thank you!" },
    successBody: {
      zh: "感谢你 / 不远万里 / 为我们祝福 — 婚礼见",
      en: "Thank you for blessing us — see you at the wedding!",
    },
    errorBody: {
      zh: "出了点问题，请稍后再试。",
      en: "Something went wrong. Please try again.",
    },
  },
};
