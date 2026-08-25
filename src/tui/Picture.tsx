import { Box, Text } from "ink";
import Image from "ink-picture";
import { IMAGE_CELL_COLS, IMAGE_CELL_ROWS, imagePlaceholder, localImagePath } from "./images.js";
import type { TranscriptRow } from "./layout.js";

type Props = {
  row: TranscriptRow;
  inner: number;
  /** When false, size to the image and skip pane-level flex-end (bubble already aligned). */
  hug?: boolean;
};

/**
 * Kitty when the reserved block is fully on-screen (Ghostty). Half-block if
 * ink-picture reports the placement as partial. Never dumps APC from <Text>.
 */
export function Picture({ row, inner, hug = true }: Props) {
  const src = row.image ? localImagePath(row.image) : undefined;
  const cols = Math.max(8, Math.min(IMAGE_CELL_COLS, inner));
  const alt = row.image?.alt?.trim() || "image";
  const media = src ? (
    <Image
      src={src}
      width={cols}
      height={IMAGE_CELL_ROWS}
      alt={alt}
      objectFit="contain"
      protocol={{ full: "kitty" }}
    />
  ) : (
    <Text dimColor color="yellow" wrap="truncate">
      {row.text || imagePlaceholder(row.image ?? {})}
    </Text>
  );
  return (
    <Box
      width={hug ? inner : cols}
      height={IMAGE_CELL_ROWS}
      justifyContent={hug && row.align === "end" ? "flex-end" : "flex-start"}
      overflow="hidden"
      flexShrink={0}
    >
      {media}
    </Box>
  );
}
