export const IST_TIME_ZONE = "Asia/Kolkata";

/** Full date + time in IST, e.g. "11 Aug 2026, 3:45 pm IST". Used for audit/log style timestamps. */
export const formatIstDateTime = (value: string | number | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  const formatted = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
  return `${formatted} IST`;
};

/** Time-only in IST, e.g. "3:45 pm IST". */
export const formatIstTime = (value: string | number | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const formatted = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${formatted} IST`;
};

/** Calendar-day label in IST for a plain "YYYY-MM-DD" value, e.g. "Tue, 11 Aug". */
export const formatIstDay = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T00:00:00+05:30`));

/** Whether two instants fall on the same IST calendar day. */
export const isSameIstDay = (a: Date, b: Date) => {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: IST_TIME_ZONE });
  return fmt.format(a) === fmt.format(b);
};

/** Today's IST calendar date as "YYYY-MM-DD", e.g. for date-input default/max values. */
export const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: IST_TIME_ZONE }).format(new Date());
