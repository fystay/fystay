import { describe, expect, it } from "vitest";
import { isOptimizableImage } from "./image";

describe("isOptimizableImage", () => {
  it("allows the known Unsplash host", () => {
    expect(isOptimizableImage("https://images.unsplash.com/photo-123")).toBe(true);
  });

  it("rejects an arbitrary unknown host", () => {
    expect(isOptimizableImage("https://evil.example.com/photo.jpg")).toBe(false);
  });

  it("rejects a malformed URL instead of throwing", () => {
    expect(isOptimizableImage("not a url")).toBe(false);
  });

  it("allows the site's own photos, so they're resized for where they're shown", () => {
    expect(isOptimizableImage("/images/destinations/cleveleys.jpg")).toBe(true);
    expect(isOptimizableImage("/videos/hero-blackpool-pier-poster.jpg")).toBe(true);
  });

  it("doesn't point the optimizer at other routes of the app, or local paths with a query", () => {
    expect(isOptimizableImage("/api/listings")).toBe(false);
    expect(isOptimizableImage("//evil.example.com/photo.jpg")).toBe(false);
    expect(isOptimizableImage("/images/photo.jpg?v=1")).toBe(false);
  });

  it("rejects a data: URI (used for seed placeholder art)", () => {
    expect(isOptimizableImage("data:image/svg+xml,<svg></svg>")).toBe(false);
  });
});
