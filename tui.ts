import { render } from "ink";
import React from "react";
import { App } from "./src/tui/App";

if (import.meta.main) {
  render(React.createElement(App));
}
