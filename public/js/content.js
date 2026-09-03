// ============================================================
//  EDIT THIS FILE to personalise the invitation.
//
//  This is the SINGLE SOURCE OF TRUTH for the wedding.
//  Nothing here should be duplicated in HTML, CSS or other JS.
//
//  `wedding.date` drives:  cover date · Chinese date line · weekday
//                          calendar · countdown · .ics download
//
//  Photography → public/assets/photos/   (see `photos` below)
//  Music       → public/assets/audio/    (see `music` below)
// ============================================================

export const wedding = {
  // ---------------------------------------------------------
  // Couple
  // ---------------------------------------------------------
  couple: {
    groom: { zh: "李天豪", en: "LEE THEAN HOW" },
    bride: { zh: "刘蔼蕴", en: "LAW HAI YEUN" },
  },

  // ---------------------------------------------------------
  // Date & time — ISO 8601 with explicit offset.
  // Everything date-related is derived from this one value.
  // ---------------------------------------------------------
  date: {
    iso: "2027-10-09T11:00:00+08:00",
    // Displayed beneath 婚礼时间. Traditional Chinese lunar date is not
    // computable without a lunar table, so it is authored here.
    // Leave "" to omit the lunar line entirely.
    lunar: "农历九月初十",
    // Ceremony start shown next to the date line.
    timeLabel: "11:00",
    // Duration used when generating the .ics calendar file.
    durationHours: 4,
  },

  // ---------------------------------------------------------
  // Music
  //
  // TO ADD THE SOUNDTRACK:
  //   1. save the file at the `src` path below
  //   2. set `ready: true`
  //
  // While `ready` is false the file is never requested and the control
  // renders in its muted state. Once present, playback is attempted on
  // load (browsers usually block this, in which case the first tap
  // starts it) and the timeline retimes to the track's duration.
  // ---------------------------------------------------------
  music: {
    src: "assets/audio/theme.m4a",
    ready: false,
    title: "婚礼背景音乐",
  },

  // ---------------------------------------------------------
  // Photography slots
  //
  // Each slot has a fixed aspect ratio so the composition holds its
  // shape whether or not the photograph has been supplied yet.
  //
  // `ready` is the switch. While it is false the renderer draws the
  // placeholder and never requests the file, so an unsupplied photo
  // costs zero network traffic and produces no console noise.
  //
  // TO ADD A PHOTOGRAPH:
  //   1. save the file at the `src` path below
  //   2. set `ready: true` for that slot
  // No layout or CSS changes are needed.
  // ---------------------------------------------------------
  photos: {
    hero: { src: "assets/photos/hero.jpg", ratio: "825 / 1000", ready: false, alt: "李天豪与刘蔼蕴的婚纱照" },
    portrait: { src: "assets/photos/portrait.jpg", ratio: "666 / 1000", ready: false, alt: "李天豪与刘蔼蕴合影" },
    story: { src: "assets/photos/story.jpg", ratio: "1 / 1", ready: false, alt: "李天豪与刘蔼蕴的合照" },
    landscape: { src: "assets/photos/landscape.jpg", ratio: "1418 / 1000", ready: false, alt: "李天豪与刘蔼蕴的婚纱外景" },
    venue: { src: "assets/photos/venue.jpg", ratio: "1110 / 1000", ready: false, alt: "婚礼场地" },
    closing: { src: "assets/photos/closing.jpg", ratio: "1 / 1", ready: false, alt: "李天豪与刘蔼蕴" },
  },

  // ---------------------------------------------------------
  // Copy — Chinese is primary. English appears only where the
  // reference uses it: decorative captions and the couple's names.
  // ---------------------------------------------------------
  copy: {
    cover: {
      bracket: "【婚礼邀请函】",
      welcome: "WELCOME TO OUR WEDDING",
    },

    poem: {
      heading: "“我”被慢慢写成了“我们”",
      lines: [
        "以前觉得婚礼是一则官方公告",
        "现在才明白",
        "这是一场为数不多的相聚",
      ],
      motif: "{囍}",
      after: [
        "是千里迢迢的奔赴",
        "是不计得失的支持",
        "诚邀您携家人参加我们的婚礼",
      ],
    },

    portrait: {
      brideLabel: "新娘",
      groomLabel: "新郎",
    },

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

    time: {
      heading: "婚礼时间",
      quote: "I'm so happy I get to be next to you",
    },

    venue: {
      heading: "婚礼地点",
      tbaName: "地点待公布",
      tbaNote: "确定后将另行通知",
      mapLabel: "查看地图",
      calendarLabel: "加入日历",
    },

    closing: {
      poem: [
        "一起追逐人间理想",
        "一起感受星河滚烫",
        "我们的感情很好概括",
        "未来是你",
      ],
      thanks: "感谢你 / 不远万里 / 为我们祝福",
      thanksLine2: "婚礼见",
    },

    rsvp: {
      heading: "敬盼回复",
      // {date} is replaced with rsvp.deadlineISO, so the deadline is
      // stated in exactly one place.
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

  // ---------------------------------------------------------
  // Venue
  //
  // While `tba` is true the venue scene shows a graceful
  // "to be announced" treatment. Fill in name/address and set
  // tba: false when the venue is confirmed.
  // ---------------------------------------------------------
  venue: {
    tba: true,
    name: "",
    address: "",
    mapsUrl: "",
  },

  // ---------------------------------------------------------
  // RSVP
  // ---------------------------------------------------------
  rsvp: {
    deadlineISO: "2027-09-30T23:59:59+08:00",
    maxGuests: 12,
  },
};

export default wedding;
