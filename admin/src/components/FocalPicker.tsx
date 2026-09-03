import { useCallback, useRef } from "react";
import { Box, Text } from "@mantine/core";

/**
 * Focal-point picker.
 *
 * This is NOT a cropper: the original bytes are never re-encoded. The
 * user is choosing the CSS object-position the frozen theme will apply,
 * so the preview must use the slot's real aspect ratio from the theme
 * manifest — otherwise the admin would promise a framing the invitation
 * does not deliver.
 *
 * A crop library was considered and rejected: every maintained one is
 * built to produce cropped output (canvas, blob, or crop rectangle),
 * which is a different operation with a different data model. This is a
 * two-number pointer control, and bending a cropper into it would be more
 * code, not less.
 */
export function FocalPicker({
  src,
  ratio,
  value,
  onChange,
}: {
  src: string;
  /** CSS aspect-ratio string from the manifest, e.g. "825 / 1000". */
  ratio: string;
  value: { x: number; y: number };
  onChange: (next: { x: number; y: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const setFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
      const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
      onChange({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    },
    [onChange]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromEvent(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    setFromEvent(e.clientX, e.clientY);
  };

  // Keyboard control, so the focal point is reachable without a pointer.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    onChange({
      x: Math.min(100, Math.max(0, value.x + move[0])),
      y: Math.min(100, Math.max(0, value.y + move[1])),
    });
  };

  return (
    <div>
      <Box
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="Focal point"
        aria-valuetext={`${value.x}% from left, ${value.y}% from top`}
        aria-valuenow={value.x}
        aria-valuemin={0}
        aria-valuemax={100}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        style={{
          // The slot's real geometry, so what is shown here is what the
          // invitation renders.
          aspectRatio: ratio,
          position: "relative",
          overflow: "hidden",
          borderRadius: 8,
          cursor: "crosshair",
          touchAction: "none",
          border: "1px solid var(--mantine-color-gray-3)",
          background: "var(--mantine-color-gray-1)",
        }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${value.x}% ${value.y}%`,
            display: "block",
            pointerEvents: "none",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: `${value.x}%`,
            top: `${value.y}%`,
            width: 22,
            height: 22,
            marginLeft: -11,
            marginTop: -11,
            borderRadius: "50%",
            border: "2px solid white",
            boxShadow: "0 0 0 1px rgba(0,0,0,.45), 0 1px 4px rgba(0,0,0,.4)",
            pointerEvents: "none",
          }}
        />
      </Box>
      <Text size="xs" c="dimmed" mt={6}>
        Drag or use arrow keys to choose what stays in frame · {value.x}% / {value.y}%
      </Text>
    </div>
  );
}
