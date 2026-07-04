import { describe, expect, mock, test } from "bun:test";
import { render } from "ink-testing-library";
import { SettingsPopup } from "../src/tui/SettingsPopup";

const flush = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

const noop = async () => true;

describe("SettingsPopup", () => {
  test("pre-fills both keys as plain text", async () => {
    // #given
    const ui = render(
      <SettingsPopup initialPublicKey="pub123" initialSecretKey="sec456" initialValid={null} onSave={noop} onCancel={() => {}} />,
    );
    await flush();

    // #then
    const frame = ui.lastFrame() ?? "";
    expect(frame).toContain("pub123");
    expect(frame).toContain("sec456");
    ui.unmount();
  });

  test("shows persisted validity on open (valid)", async () => {
    // #given
    const ui = render(<SettingsPopup initialPublicKey="p" initialSecretKey="s" initialValid={true} onSave={noop} onCancel={() => {}} />);
    await flush();

    // #then
    expect(ui.lastFrame() ?? "").toContain("Keys valid");
    ui.unmount();
  });

  test("shows unverified when validity is null", async () => {
    // #given
    const ui = render(<SettingsPopup initialPublicKey="" initialSecretKey="" initialValid={null} onSave={noop} onCancel={() => {}} />);
    await flush();

    // #then
    expect(ui.lastFrame() ?? "").toContain("Not verified yet");
    ui.unmount();
  });

  test("typing appends to the focused (public) field", async () => {
    // #given
    const ui = render(<SettingsPopup initialPublicKey="p" initialSecretKey="" initialValid={null} onSave={noop} onCancel={() => {}} />);
    await flush();

    // #when
    ui.stdin.write("ub");
    await flush();

    // #then
    expect(ui.lastFrame() ?? "").toContain("pub");
    ui.unmount();
  });

  test("Tab×3 to Save + Enter validates a complete pair and stays open (validating→valid)", async () => {
    // #given
    const onSave = mock<(p: string, s: string) => Promise<boolean>>(async () => true);
    const onCancel = mock(() => {});
    const ui = render(
      <SettingsPopup initialPublicKey="pub" initialSecretKey="sec" initialValid={null} onSave={onSave} onCancel={onCancel} />,
    );
    await flush();

    // #when — focus order: public → secret → cancel → save
    ui.stdin.write("\t");
    await flush();
    ui.stdin.write("\t");
    await flush();
    ui.stdin.write("\t");
    await flush();
    ui.stdin.write("\r");
    await flush();

    // #then
    expect(onSave).toHaveBeenCalledWith("pub", "sec");
    expect(onCancel).not.toHaveBeenCalled();
    expect(ui.lastFrame() ?? "").toContain("Keys valid");
    ui.unmount();
  });

  test("Save with both keys empty clears without error and stays open", async () => {
    // #given
    const onSave = mock<(p: string, s: string) => Promise<boolean>>(async () => false);
    const ui = render(<SettingsPopup initialPublicKey="" initialSecretKey="" initialValid={null} onSave={onSave} onCancel={() => {}} />);
    await flush();

    // #when — Tab×3 → Save, Enter
    ui.stdin.write("\t\t\t");
    await flush();
    ui.stdin.write("\r");
    await flush();

    // #then — both-empty is a valid clear operation
    expect(onSave).toHaveBeenCalledWith("", "");
    ui.unmount();
  });

  test("Save is inert when exactly one key is filled", async () => {
    // #given — only the public key filled
    const onSave = mock<(p: string, s: string) => Promise<boolean>>(async () => true);
    const ui = render(
      <SettingsPopup initialPublicKey="only-public" initialSecretKey="" initialValid={null} onSave={onSave} onCancel={() => {}} />,
    );
    await flush();

    // #when — Tab×3 → Save, Enter
    ui.stdin.write("\t\t\t");
    await flush();
    ui.stdin.write("\r");
    await flush();

    // #then — incomplete pair is never validated
    expect(onSave).not.toHaveBeenCalled();
    ui.unmount();
  });

  test("Esc calls onCancel", async () => {
    // #given
    const onCancel = mock(() => {});
    const ui = render(<SettingsPopup initialPublicKey="" initialSecretKey="" initialValid={null} onSave={noop} onCancel={onCancel} />);
    await flush();

    // #when
    ui.stdin.write("\x1b");
    await flush();

    // #then
    expect(onCancel).toHaveBeenCalled();
    ui.unmount();
  });
});
