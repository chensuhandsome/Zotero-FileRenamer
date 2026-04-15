/**
 * Corner notifications using Zotero progress windows.
 */

type NotificationKind = "success" | "info" | "warning" | "error";

const ICONS: Record<NotificationKind, string> = {
  success: "chrome://zotero/skin/tick.png",
  info: "chrome://zotero/skin/tick.png",
  warning: "chrome://zotero/skin/warning.png",
  error: "chrome://zotero/skin/cross.png",
};

export function showCornerNotification(
  headline: string,
  lines: string | string[],
  kind: NotificationKind = "info",
  closeTime = 5000,
): void {
  const messages = Array.isArray(lines) ? lines.filter(Boolean) : [lines].filter(Boolean);
  if (messages.length === 0) {
    return;
  }

  const progressWindow = new Zotero.ProgressWindow({ closeOnClick: true });
  progressWindow.changeHeadline(headline);

  const icon = ICONS[kind] ?? ICONS.info;
  for (const message of messages.slice(0, 8)) {
    progressWindow.addLines(message, icon);
  }

  progressWindow.show();
  progressWindow.startCloseTimer(closeTime);
}
