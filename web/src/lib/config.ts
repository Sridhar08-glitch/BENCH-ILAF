// One place for names and addresses so a rename or a new host is a one-line change.

/** Product name shown in the logo, page titles, metadata and the card footer. */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "BENCH";

/** The Bench logo files (public/brand): black lettering for light surfaces, white lettering for dark ones, both with the three colour dots. */
export const BRAND_WORDMARK = { ink: "/brand/bench-wordmark.png", white: "/brand/bench-wordmark-white.png", width: 318, height: 79 } as const;

/** Full product name and tagline, used in the page description and the landing page. */
export const APP_FULL_NAME = "Business Enhancement Network Cloud Hub";
export const APP_TAGLINE = "Your business. One smart identity.";

/** Company that makes the product (shown in the footer). */
export const COMPANY_NAME = "iLAF Technologies";
/** Short form of the company name, for tight places such as the quiet suffix on a public card. */
export const COMPANY_SHORT_NAME = "iLAF Tech";
export const COMPANY_SITE = "https://ilaf.qa";
/** The company logo (dark lettering on a transparent background) and its size, used in the "by" lockup. */
export const COMPANY_LOGO = { src: "/brand/ilaf-logo.png", width: 551, height: 148 } as const;

/**
 * Short host shown in card addresses. "ilaf.one" is only a placeholder default:
 * set NEXT_PUBLIC_PUBLIC_HOST to the real card domain before launch.
 */
export const PUBLIC_HOST = process.env.NEXT_PUBLIC_PUBLIC_HOST || "ilaf.one";

/** API address used by the browser (public card events, QR images, vCard downloads). */
export const API_PUBLIC_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100/api/v1").replace(/\/+$/, "");

/** API address used by the Next.js server (server rendering and the sign-in proxy). */
export const API_SERVER_URL = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100/api/v1").replace(/\/+$/, "");

/** Public address of this web app. */
export const WEB_URL = (process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3100").replace(/\/+$/, "");
