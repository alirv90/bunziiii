import { describe, it, expect } from "bun:test";
import { add, subtract, multiply, divide, fizzbuzz, factorial, isPrime } from "./index";

describe("math", () => {
  it("adds two numbers", () => {
    expect(add(2, 3)).toBe(5);
    expect(add(-1, 1)).toBe(0);
  });

  it("subtracts two numbers", () => {
    expect(subtract(10, 4)).toBe(6);
    expect(subtract(0, 5)).toBe(-5);
  });

  it("multiplies two numbers", () => {
    expect(multiply(3, 4)).toBe(12);
    expect(multiply(-2, 5)).toBe(-10);
  });

  it("divides two numbers", () => {
    expect(divide(10, 2)).toBe(5);
    expect(divide(7, 2)).toBe(3.5);
  });

  it("throws on division by zero", () => {
    expect(() => divide(5, 0)).toThrow("Division by zero");
  });
});

describe("fizzbuzz", () => {
  it("returns Fizz for multiples of 3", () => {
    expect(fizzbuzz(3)).toBe("Fizz");
    expect(fizzbuzz(9)).toBe("Fizz");
  });

  it("returns Buzz for multiples of 5", () => {
    expect(fizzbuzz(5)).toBe("Buzz");
    expect(fizzbuzz(20)).toBe("Buzz");
  });

  it("returns FizzBuzz for multiples of 15", () => {
    expect(fizzbuzz(15)).toBe("FizzBuzz");
    expect(fizzbuzz(30)).toBe("FizzBuzz");
  });

  it("returns the number as string otherwise", () => {
    expect(fizzbuzz(7)).toBe("7");
    expect(fizzbuzz(1)).toBe("1");
  });
});

describe("factorial", () => {
  it("computes factorial correctly", () => {
    expect(factorial(0)).toBe(1);
    expect(factorial(1)).toBe(1);
    expect(factorial(5)).toBe(120);
    expect(factorial(10)).toBe(3628800);
  });

  it("throws on negative input", () => {
    expect(() => factorial(-1)).toThrow("Negative input");
  });
});

describe("isPrime", () => {
  it("identifies primes", () => {
    expect(isPrime(2)).toBe(true);
    expect(isPrime(3)).toBe(true);
    expect(isPrime(13)).toBe(true);
    expect(isPrime(97)).toBe(true);
  });

  it("rejects non-primes", () => {
    expect(isPrime(0)).toBe(false);
    expect(isPrime(1)).toBe(false);
    expect(isPrime(4)).toBe(false);
    expect(isPrime(100)).toBe(false);
  });
});
