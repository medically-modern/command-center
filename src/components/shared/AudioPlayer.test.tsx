/**
 * The scrubbable player (CLAUDE.md §5.50). The arithmetic is tested in
 * `lib/shared/audioScrub.test.ts`; this pins what a rep actually touches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AudioPlayer } from "./AudioPlayer";

let playSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // jsdom implements no media playback.
  playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const slider = () => screen.getByRole("slider");

describe("AudioPlayer", () => {
  // ⚠️ The call log already knows how long the call was, so the bar is
  // scrubbable the moment it appears — not after the browser reads the file.
  it("is scrubbable straight away from the length the call log recorded", () => {
    render(<AudioPlayer src="blob:one" durationHint={120} autoPlay={false} label="Call recording" />);
    expect(slider()).toHaveAttribute("aria-valuetext", "0:00 of 2:00");
    expect(slider()).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText(/\/ 2:00/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Call recording" })).toBeInTheDocument();
  });

  it("refuses to seek, and says the length is unknown, when nobody knows it", () => {
    render(<AudioPlayer src="blob:one" autoPlay={false} />);
    expect(slider()).toHaveAttribute("aria-disabled", "true");
    expect(slider()).toHaveAttribute("aria-valuetext", "0:00 of --:--");
    expect(screen.getByRole("button", { name: /Forward 15 seconds/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Back 15 seconds/ })).toBeDisabled();
  });

  it("seeks from the keyboard on the focused bar", () => {
    render(<AudioPlayer src="blob:one" durationHint={120} autoPlay={false} />);
    fireEvent.keyDown(slider(), { key: "ArrowRight" });
    expect(slider()).toHaveAttribute("aria-valuetext", "0:05 of 2:00");
    fireEvent.keyDown(slider(), { key: "End" });
    expect(slider()).toHaveAttribute("aria-valuetext", "2:00 of 2:00");
    fireEvent.keyDown(slider(), { key: "Home" });
    expect(slider()).toHaveAttribute("aria-valuetext", "0:00 of 2:00");
  });

  it("jumps forward fifteen seconds", () => {
    render(<AudioPlayer src="blob:one" durationHint={120} autoPlay={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Forward 15 seconds/ }));
    expect(slider()).toHaveAttribute("aria-valuetext", "0:15 of 2:00");
  });

  it("cycles the speed 1× → 1.25× → …", () => {
    render(<AudioPlayer src="blob:one" durationHint={120} autoPlay={false} />);
    const speed = screen.getByRole("button", { name: /Playback speed/ });
    expect(speed).toHaveTextContent("1×");
    fireEvent.click(speed);
    expect(speed).toHaveTextContent("1.25×");
  });

  it("plays on Play, and on Space from the focused bar", () => {
    render(<AudioPlayer src="blob:one" durationHint={120} autoPlay={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(playSpy).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(slider(), { key: " " });
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  // ⚠️ Older engines return nothing from play(); the button must not throw.
  it("survives a play() that returns nothing", () => {
    playSpy.mockImplementation(() => undefined as unknown as Promise<void>);
    render(<AudioPlayer src="blob:one" durationHint={120} autoPlay={false} />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Play" }))).not.toThrow();
  });

  // ⚠️ An archive link dies after five minutes (§5.47). The caller hands a
  // Play button back on this, which fetches a fresh one.
  it("tells the caller when the audio fails", () => {
    const onError = vi.fn();
    const { container } = render(<AudioPlayer src="blob:one" durationHint={120} autoPlay={false} onError={onError} />);
    fireEvent.error(container.querySelector("audio")!);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("starts a NEW recording at the beginning", () => {
    const { rerender } = render(<AudioPlayer src="blob:one" durationHint={120} autoPlay={false} />);
    fireEvent.keyDown(slider(), { key: "End" });
    rerender(<AudioPlayer src="blob:two" durationHint={120} autoPlay={false} />);
    expect(slider()).toHaveAttribute("aria-valuetext", "0:00 of 2:00");
  });
});
