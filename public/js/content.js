// ============================================================
// EDIT THIS FILE to personalize the invitation.
// All text is bilingual: zh = Chinese, en = English.
// Photos go in assets/photos/, music in assets/music.mp3
// ============================================================

window.INVITE = {
  // Music file path (put your mp3 at public/assets/music.mp3)
  musicSrc: "assets/music.mp3",

  couple: {
    zhFirst: "黄",
    zhSecond: "陈",
    enFirst: "Huang",
    enSecond: "Chen",
    tagline: { zh: "我们要结婚啦", en: "We are getting married" },
    namesLine: { zh: "黄先生 ❤ 陈小姐", en: "Mr. Huang & Ms. Chen" },
  },

  // Full ISO datetime of the wedding (with timezone!)
  weddingISO: "2026-11-21T10:00:00+08:00",

  story: {
    title: { zh: "我们的故事", en: "Our Story" },
    paragraphs: [
      {
        zh: "感谢命运让我们相遇，从相识到相爱，每一步都是最好的安排。",
        en: "Fate brought us together, and every step from meeting to falling in love has been a blessing.",
      },
      {
        zh: "在这个特别的日子，我们诚挚地邀请您来见证我们的幸福时刻。",
        en: "On this special day, we sincerely invite you to witness our moment of happiness.",
      },
    ],
  },

  details: {
    venue: {
      nameZh: "喜来登酒店 大宴会厅",
      nameEn: "Sheraton Hotel, Grand Ballroom",
      addressZh: "吉隆坡市中心幸福路 88 号",
      addressEn: "88 Jalan Bahagia, Kuala Lumpur City Centre",
      mapsUrl: "https://maps.google.com/?q=Sheraton+Hotel+Kuala+Lumpur",
    },
    program: [
      { time: "10:00", zh: "宾客入席", en: "Guests arrive" },
      { time: "11:00", zh: "婚礼仪式", en: "Ceremony begins" },
      { time: "12:30", zh: "婚宴开席", en: "Banquet starts" },
    ],
    dressCode: { zh: "着装：喜庆色系（避免白色）", en: "Dress code: festive colors (please avoid white)" },
  },

  // Photo file paths — drop files into public/assets/photos/
  photos: [
    "assets/photos/photo1.jpg",
    "assets/photos/photo2.jpg",
    "assets/photos/photo3.jpg",
    "assets/photos/photo4.jpg",
    "assets/photos/photo5.jpg",
    "assets/photos/photo6.jpg",
  ],

  rsvpDeadlineISO: "2026-10-31T23:59:59+08:00",

  rsvpText: {
    title: { zh: "敬盼回复", en: "RSVP" },
    deadlineLabel: { zh: "请在十月三十一日前回复", en: "Kindly reply by 31 October" },
    nameLabel: { zh: "您的姓名", en: "Your name" },
    attendingLabel: { zh: "您会出席吗？", en: "Will you attend?" },
    yes: { zh: "欣然出席", en: "Joyfully accept" },
    no: { zh: "遗憾缺席", en: "Regretfully decline" },
    guestsLabel: { zh: "出席人数", en: "Number of guests" },
    phoneLabel: { zh: "电话号码", en: "Phone number" },
    instagramLabel: { zh: "Instagram 帐号", en: "Instagram handle" },
    contactHint: { zh: "请至少填写一项，方便我们与您确认", en: "Please provide at least one so we can confirm with you" },
    messageLabel: { zh: "祝福留言（可选）", en: "Your wishes (optional)" },
    submit: { zh: "送出回复", en: "Send RSVP" },
    successTitle: { zh: "收到啦！", en: "Thank you!" },
    successBody: {
      zh: "您的回复已送达，我们非常期待与您共度美好时光。",
      en: "Your reply has been received. We can't wait to celebrate with you.",
    },
    errorBody: {
      zh: "出了点问题，请稍后再试。",
      en: "Something went wrong. Please try again.",
    },
  },
};
