import { describe, expect, test } from "bun:test";
import { formatReleaseDate } from "./format";

describe("formatReleaseDate", () => {
  test("usa a precisão que o IGDB conhece", () => {
    expect(formatReleaseDate("2027-02-23", "day")).toBe("23/02/2027");
    expect(formatReleaseDate("2027-02-23", null)).toBe("23/02/2027");
    expect(formatReleaseDate("2027-03-31", "month")).toMatch(/^mar\.? de 2027$/);
    expect(formatReleaseDate("2027-09-30", "quarter")).toBe("3º tri. 2027");
    expect(formatReleaseDate("2028-12-31", "year")).toBe("2028");
  });
});
