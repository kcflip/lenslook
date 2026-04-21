import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeText } from "./alias.js";

const POST = { id: "abc123", title: "Test post", subreddit: "sonyalpha" };

function analyze(body: string, source: "post" | "comment" = "comment") {
  return analyzeText(body, source, "cmt1", 10, null, null, POST.id, POST.title, POST.subreddit);
}

test("returns null when text matches a known lens", () => {
  const result = analyze("I love my 85GM, best portrait lens");
  assert.equal(result, null);
});

test("returns null when no patterns match", () => {
  const result = analyze("great camera, really happy with it");
  assert.equal(result, null);
});

test("detects brand name", () => {
  const result = analyze("just picked up a Tamron and loving it");
  assert.ok(result);
  assert.equal(result.pattern, "brand");
  assert.ok(result.candidate.toLowerCase().includes("tamron"));
});

test("detects focal range + aperture (highest priority)", () => {
  const result = analyze("the 70-200mm f2.8 is a classic");
  assert.ok(result);
  assert.equal(result.pattern, "focal_range_aperture");
});

test("detects single focal + aperture", () => {
  const result = analyze("shooting with 85mm f1.4 wide open");
  assert.ok(result);
  assert.equal(result.pattern, "focal_single_aperture");
});

test("detects aperture before focal", () => {
  const result = analyze("f1.8 50mm is a great combo");
  assert.ok(result);
  assert.equal(result.pattern, "aperture_focal");
});

test("detects focal range only", () => {
  const result = analyze("the 24-70mm range is so versatile");
  assert.ok(result);
  assert.equal(result.pattern, "focal_range");
});

test("detects single focal only", () => {
  const result = analyze("been shooting 35mm for years");
  assert.ok(result);
  assert.equal(result.pattern, "focal_single");
});

test("detects aperture only as last resort", () => {
  const result = analyze("shooting wide open at f2 all day");
  assert.ok(result);
  assert.equal(result.pattern, "aperture");
});

test("brand takes priority over focal patterns", () => {
  const result = analyze("Sigma makes great 50mm lenses");
  assert.ok(result);
  assert.equal(result.pattern, "brand");
});

test("source field is set correctly for post", () => {
  const result = analyzeText("Viltrox 85mm looks nice", "post", null, null, null, null, POST.id, POST.title, POST.subreddit);
  assert.ok(result);
  assert.equal(result.source, "post");
  assert.equal(result.commentId, null);
  assert.equal(result.commentScore, null);
});

test("lensId and lensName are passed through when provided", () => {
  const result = analyzeText("Viltrox 85mm looks nice", "comment", "cmt1", 5, "sony-fe-85-1.4-gm", "FE 85mm f/1.4 GM", POST.id, POST.title, POST.subreddit);
  assert.ok(result);
  assert.equal(result.lensId, "sony-fe-85-1.4-gm");
  assert.equal(result.lensName, "FE 85mm f/1.4 GM");
});
