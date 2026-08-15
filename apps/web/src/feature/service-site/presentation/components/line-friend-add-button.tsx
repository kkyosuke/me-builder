const LINE_FRIEND_URL = "https://lin.ee/YezPSYA";
const LINE_FRIEND_BUTTON_IMAGE_URL = "https://scdn.line-apps.com/n/line_add_friends/btn/ja.png";

export function LineFriendAddButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={LINE_FRIEND_URL}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#06c755] ${className}`}
    >
      <img
        src={LINE_FRIEND_BUTTON_IMAGE_URL}
        alt="友だち追加"
        width="116"
        height="36"
        className="border-0"
      />
    </a>
  );
}
