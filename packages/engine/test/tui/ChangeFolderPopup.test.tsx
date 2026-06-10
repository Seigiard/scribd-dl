import { describe, expect, mock, test } from "bun:test";
import { render } from "ink-testing-library";
import { ChangeFolderPopup } from "../../src/tui/ChangeFolderPopup";

const flush = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

describe("ChangeFolderPopup", () => {
  test("pre-fills value with initial folder", async () => {
    // #given
    const ui = render(<ChangeFolderPopup initial="/tmp/old" onSave={() => {}} onCancel={() => {}} />);

    // #when
    await flush();

    // #then
    expect(ui.lastFrame() ?? "").toContain("/tmp/old");
    ui.unmount();
  });

  test("typing chars appends to value", async () => {
    // #given
    const ui = render(<ChangeFolderPopup initial="/a" onSave={() => {}} onCancel={() => {}} />);
    await flush();

    // #when
    ui.stdin.write("bc");
    await flush();

    // #then
    expect(ui.lastFrame() ?? "").toContain("/abc");
    ui.unmount();
  });

  test("backspace removes last char", async () => {
    // #given
    const ui = render(<ChangeFolderPopup initial="/abc" onSave={() => {}} onCancel={() => {}} />);
    await flush();

    // #when
    ui.stdin.write(""); // backspace
    await flush();

    // #then
    expect(ui.lastFrame() ?? "").toContain("/ab");
    ui.unmount();
  });

  test("Esc calls onCancel", async () => {
    // #given
    const onCancel = mock(() => {});
    const ui = render(<ChangeFolderPopup initial="/a" onSave={() => {}} onCancel={onCancel} />);
    await flush();

    // #when
    ui.stdin.write("\x1b");
    await flush();

    // #then
    expect(onCancel).toHaveBeenCalled();
    ui.unmount();
  });

  test("Tab+Tab to Save, Enter calls onSave with current value", async () => {
    // #given
    const onSave = mock<(p: string) => void>(() => {});
    const ui = render(<ChangeFolderPopup initial="/tmp/new" onSave={onSave} onCancel={() => {}} />);
    await flush();

    // #when — focus order: input → cancel → save
    ui.stdin.write("\t");
    await flush();
    ui.stdin.write("\t");
    await flush();
    ui.stdin.write("\r");
    await flush();

    // #then
    expect(onSave).toHaveBeenCalledWith("/tmp/new");
    ui.unmount();
  });

  test("Tab to Cancel, Enter calls onCancel", async () => {
    // #given
    const onCancel = mock(() => {});
    const ui = render(<ChangeFolderPopup initial="/a" onSave={() => {}} onCancel={onCancel} />);
    await flush();

    // #when
    ui.stdin.write("\t");
    await flush();
    ui.stdin.write("\r");
    await flush();

    // #then
    expect(onCancel).toHaveBeenCalled();
    ui.unmount();
  });
});
