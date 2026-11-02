import {describe, expect, test } from "bun:test";
import { scoreTriage } from "./triage.scorer";



describe("Triage Scorer", () => {
  test("should pass when expected and actual categories match", () => {
    const result = scoreTriage("order_status", "order_status");

    expect(result).toEqual({
      passed: true,
      expected: "order_status",
      actual: "order_status",
    });
  });

  test("should fail when expected and actual categories differ", () => {
    const result = scoreTriage("refund", "complaint");

    expect(result).toEqual({
      passed: false,
      expected: "refund",
      actual: "complaint",
    });
  });

  test("should pass when both categories are spam", () => {
    const result = scoreTriage("spam", "spam");

    expect(result).toEqual({
      passed: true,
      expected: "spam",
      actual: "spam",
    });
  });
});