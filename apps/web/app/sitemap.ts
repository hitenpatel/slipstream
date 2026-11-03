import type { MetadataRoute } from "next";

// Only the public portfolio landing page is exposed to search engines.
// The tracker application (/app), auth (/login, /signup), invite (/join)
// and API routes are excluded via robots.txt and per-route metadata.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://tracker.hiten.dev/",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1.0,
    },
  ];
}
