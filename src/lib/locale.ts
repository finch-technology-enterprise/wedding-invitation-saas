/**
 * Invitation-level locale resources (V2 §3.4).
 *
 * Supported guest-system locales: en, zh-CN, zh-TW, ms.
 * User-authored content is never translated; only system copy.
 */

export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW", "ms"] as const;
export type InvitationLocale = (typeof SUPPORTED_LOCALES)[number];

export function normalizeLocale(raw: unknown): InvitationLocale {
  if (typeof raw !== "string") return "zh-CN";
  const v = raw.trim();
  if ((SUPPORTED_LOCALES as readonly string[]).includes(v)) return v as InvitationLocale;
  const lower = v.toLowerCase();
  if (lower === "zh-tw" || lower === "zh_hant" || lower === "zh-hant") return "zh-TW";
  if (lower === "zh-cn" || lower === "zh_hans" || lower === "zh-hans" || lower === "zh") return "zh-CN";
  if (lower === "ms" || lower === "ms-my") return "ms";
  if (lower.startsWith("en")) return "en";
  return "zh-CN";
}

interface LocaleStrings {
  rsvpHeading: string;
  rsvpName: string;
  rsvpAttending: string;
  rsvpYes: string;
  rsvpNo: string;
  rsvpGuests: string;
  rsvpPhone: string;
  rsvpMessage: string;
  rsvpSubmit: string;
  rsvpSubmitting: string;
  rsvpSuccessTitle: string;
  rsvpSuccessBody: string;
  rsvpDeadline: string;
  countdownDays: string;
  countdownHours: string;
  countdownMinutes: string;
  countdownSeconds: string;
  addToCalendar: string;
  viewMap: string;
  shareTitle: string;
  copyLink: string;
  copied: string;
  openInvitation: string;
  attending: string;
  declined: string;
  pending: string;
}

const STRINGS: Record<InvitationLocale, LocaleStrings> = {
  en: {
    rsvpHeading: "Please reply",
    rsvpName: "Name",
    rsvpAttending: "Attending?",
    rsvpYes: "Joyfully accept",
    rsvpNo: "Cannot make it",
    rsvpGuests: "Number of guests",
    rsvpPhone: "Phone",
    rsvpMessage: "A note for us",
    rsvpSubmit: "Send",
    rsvpSubmitting: "Sending…",
    rsvpSuccessTitle: "Thank you",
    rsvpSuccessBody: "We have your reply. See you there.",
    rsvpDeadline: "Kindly reply by {date}",
    countdownDays: "days",
    countdownHours: "hours",
    countdownMinutes: "minutes",
    countdownSeconds: "seconds",
    addToCalendar: "Add to calendar",
    viewMap: "View map",
    shareTitle: "Share this invitation",
    copyLink: "Copy link",
    copied: "Copied",
    openInvitation: "Open invitation",
    attending: "Attending",
    declined: "Declined",
    pending: "Pending",
  },
  "zh-CN": {
    rsvpHeading: "请回复",
    rsvpName: "姓名",
    rsvpAttending: "是否出席？",
    rsvpYes: "欣然接受",
    rsvpNo: "无法出席",
    rsvpGuests: "出席人数",
    rsvpPhone: "电话",
    rsvpMessage: "给我们的留言",
    rsvpSubmit: "发送",
    rsvpSubmitting: "发送中…",
    rsvpSuccessTitle: "谢谢",
    rsvpSuccessBody: "已收到您的回复，期待相见。",
    rsvpDeadline: "请于 {date} 前回复",
    countdownDays: "天",
    countdownHours: "小时",
    countdownMinutes: "分钟",
    countdownSeconds: "秒",
    addToCalendar: "添加到日历",
    viewMap: "查看地图",
    shareTitle: "分享邀请函",
    copyLink: "复制链接",
    copied: "已复制",
    openInvitation: "打开邀请函",
    attending: "出席",
    declined: "婉拒",
    pending: "待定",
  },
  "zh-TW": {
    rsvpHeading: "請回覆",
    rsvpName: "姓名",
    rsvpAttending: "是否出席？",
    rsvpYes: "欣然接受",
    rsvpNo: "無法出席",
    rsvpGuests: "出席人數",
    rsvpPhone: "電話",
    rsvpMessage: "給我們的留言",
    rsvpSubmit: "傳送",
    rsvpSubmitting: "傳送中…",
    rsvpSuccessTitle: "謝謝",
    rsvpSuccessBody: "已收到您的回覆，期待相見。",
    rsvpDeadline: "請於 {date} 前回覆",
    countdownDays: "天",
    countdownHours: "小時",
    countdownMinutes: "分鐘",
    countdownSeconds: "秒",
    addToCalendar: "加入行事曆",
    viewMap: "查看地圖",
    shareTitle: "分享邀請函",
    copyLink: "複製連結",
    copied: "已複製",
    openInvitation: "開啟邀請函",
    attending: "出席",
    declined: "婉拒",
    pending: "待定",
  },
  ms: {
    rsvpHeading: "Sila balas",
    rsvpName: "Nama",
    rsvpAttending: "Hadir?",
    rsvpYes: "Menerima dengan gembira",
    rsvpNo: "Tidak dapat hadir",
    rsvpGuests: "Bilangan tetamu",
    rsvpPhone: "Telefon",
    rsvpMessage: "Pesanan untuk kami",
    rsvpSubmit: "Hantar",
    rsvpSubmitting: "Menghantar…",
    rsvpSuccessTitle: "Terima kasih",
    rsvpSuccessBody: "Balasan anda telah diterima. Jumpa di sana.",
    rsvpDeadline: "Sila balas sebelum {date}",
    countdownDays: "hari",
    countdownHours: "jam",
    countdownMinutes: "minit",
    countdownSeconds: "saat",
    addToCalendar: "Tambah ke kalendar",
    viewMap: "Lihat peta",
    shareTitle: "Kongsi jemputan ini",
    copyLink: "Salin pautan",
    copied: "Disalin",
    openInvitation: "Buka jemputan",
    attending: "Hadir",
    declined: "Tidak hadir",
    pending: "Menunggu",
  },
};

export function stringsFor(locale: InvitationLocale): LocaleStrings {
  return STRINGS[locale];
}

export function htmlLangFor(locale: InvitationLocale): string {
  switch (locale) {
    case "zh-CN":
      return "zh-CN";
    case "zh-TW":
      return "zh-TW";
    case "ms":
      return "ms";
    default:
      return "en";
  }
}

/** Locale-aware date formatting for guest surfaces. Never throws. */
export function formatDateForLocale(iso: string, locale: InvitationLocale, timeZone?: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(htmlLangFor(locale), {
      dateStyle: "full",
      ...(timeZone ? { timeZone } : {}),
    }).format(d);
  } catch {
    return iso;
  }
}
