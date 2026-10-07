import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";

describe("Panel", () => {
  it("labels the region with its border title", () => {
    render(
      <Panel title="files">
        <p>body</p>
      </Panel>,
    );
    expect(screen.getByRole("region", { name: "files" })).toBeTruthy();
  });
});
