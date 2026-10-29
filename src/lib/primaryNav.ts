// The site's top-level pages. The desktop header shows these beside the
// Saved link and the account menu; the account menus don't repeat them.
export const PRIMARY_NAV_LINKS = [{ href: "/about", label: "About" }];
export const HEADER_NAV_LINKS = PRIMARY_NAV_LINKS;

// The phone header's left-hand menu: secondary pages. Account actions live in
// the account menu on the right and Saved sits beside it, so nothing here
// repeats either.
export const SECONDARY_NAV_LINKS = [
  { href: "/about", label: "About FYStay" },
  { href: "/help", label: "Help" },
  { href: "/contact", label: "Contact" },
  { href: "/host", label: "List your property" },
];
