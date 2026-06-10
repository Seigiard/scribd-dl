import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { App } from "../src/App";

describe("App smoke", () => {
  test("renders the scribd-dl heading", () => {
    // #given
    render(<App />);

    // #then
    expect(screen.getByRole("heading", { name: /scribd-dl/i })).toBeInTheDocument();
  });
});
