import { Fraction, parseBigNumberIsh } from "../../src/entity";

describe("Test parseBigNumberIsh", () => {
  it("should works when parse string", () => {
    const result = parseBigNumberIsh("100");
    expect(result.toString(10)).toBe("100");
  });

  it("should works when parse number", () => {
    const result = parseBigNumberIsh(100);
    expect(result.toString(10)).toBe("100");
  });

  it("should revert when parse invalid string", () => {
    expect(() => parseBigNumberIsh("100a")).toThrow(/invalid BigNumberIsh string/);
  });

  it("should revert when parse invalid number", () => {
    expect(() => parseBigNumberIsh(1.1)).toThrow(/underflow/);
    expect(() => parseBigNumberIsh(9007199254740991)).toThrow(/overflow/);
  });
});

describe("Test Fraction", () => {
  const _33_fraction = new Fraction(100, 3);
  const _100_fraction = new Fraction(100);

  it("should works when get quotient", () => {
    expect(_33_fraction.quotient.toString(10)).toBe("33");
    expect(_100_fraction.quotient.toString(10)).toBe("100");
  });

  it("should works when get invert", () => {
    expect(_33_fraction.invert().quotient.toString(10)).toBe("0");
    expect(_100_fraction.invert().quotient.toString(10)).toBe("0");
  });
});
